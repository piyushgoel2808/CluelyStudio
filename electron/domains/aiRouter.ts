import { store } from './store';
import { windowManager } from './windowManager';
import { memoryBrain } from './memoryBrain';
import { screenCaptureService } from './screenCapture';
import { companionServer } from './companionServer';
import { transcriptionService } from './transcriptionService';
import {
  AIStreamChunk,
  AIStreamRequest,
  MemoryItem,
  TranscriptSegment,
} from '../../src/types/ipc';

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class AIRouter {
  private activeStreams: Map<string, AbortController> = new Map();

  /**
   * Cancel an in-flight AI stream
   */
  public cancelStream(requestId: string): void {
    const controller = this.activeStreams.get(requestId);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(requestId);
    }
  }

  /**
   * Handle multimodal stream request and route to active AI provider
   */
  public async streamPrompt(request: AIStreamRequest): Promise<void> {
    const state = store.getState();
    const aiConfig = state.aiConfig;
    const provider = aiConfig.activeProvider;
    const model = aiConfig.activeModel;

    // Resolve active mode
    const modeId = request.modeId || state.activeModeId;
    const activeMode = state.modes.find((m) => m.id === modeId) || state.modes[0];

    // Determine trigger source: explicit request property or derived from prompt content
    const userTypedPrompt = request.prompt?.trim() || '';
    const triggerSource: 'typed' | 'voice' =
      request.triggerSource || (userTypedPrompt ? 'typed' : 'voice');

    // Abort any existing in-flight streams to avoid concurrency collisions and conserve VRAM
    for (const ctrl of this.activeStreams.values()) {
      try {
        ctrl.abort();
      } catch {}
    }
    this.activeStreams.clear();

    const controller = new AbortController();
    this.activeStreams.set(request.requestId, controller);

    // STEP 2 & 4: Always await pending transcription promises so in-flight Sherpa-ONNX
    // chunks are completely committed to store before reading transcripts!
    try {
      await transcriptionService.awaitPendingTranscriptions(3000);
    } catch (waitErr) {
      console.warn('[AIRouter] awaitPendingTranscriptions error, continuing:', waitErr);
    }

    // Ensure active session exists so assist events are ALWAYS archived
    const activeSession = store.ensureActiveSession();

    // Retrieve all chronological transcripts
    const stateTranscripts = store.getState().transcripts || [];
    const candidateSegments: TranscriptSegment[] = [
      ...(activeSession?.transcripts || []),
      ...(request.transcript || []),
      ...stateTranscripts,
    ];

    const segmentMap = new Map<string, TranscriptSegment>();
    for (const seg of candidateSegments) {
      if (seg && seg.text && seg.text.trim()) {
        const key = seg.id || `${seg.startTimeMs || seg.timestamp}_${seg.text.slice(0, 25)}`;
        segmentMap.set(key, seg);
      }
    }
    const allSegments = Array.from(segmentMap.values());
    allSegments.sort((a, b) => {
      const timeA = a.timestamp || a.startTimeMs || 0;
      const timeB = b.timestamp || b.startTimeMs || 0;
      return timeA - timeB;
    });

    // STEP 4: Gather the Full Question Without Cutting It Midway
    const cursorTs = store.getQuestionCursorTimestamp();
    let unansweredSegments = allSegments.filter(
      (t) => (t.timestamp || t.startTimeMs || 0) >= cursorTs
    );

    // Contiguous Question Lookback Guard:
    // If the preceding segment ended within 10,000ms (10 seconds) of the start of unansweredSegments,
    // include it too so a long multi-sentence question split across chunks is 100% captured!
    if (unansweredSegments.length > 0) {
      const firstUnanswered = unansweredSegments[0];
      const firstIdx = allSegments.findIndex((s) => s.id === firstUnanswered.id);
      if (firstIdx > 0) {
        let currStartIdx = firstIdx;
        while (currStartIdx > 0) {
          const prevSeg = allSegments[currStartIdx - 1];
          const currSeg = allSegments[currStartIdx];
          const prevEnd = prevSeg.endTimeMs || prevSeg.timestamp || 0;
          const currStart = currSeg.startTimeMs || currSeg.timestamp || 0;
          if (currStart - prevEnd <= 10000 || Math.abs(currStart - (prevSeg.timestamp || 0)) <= 10000) {
            currStartIdx--;
          } else {
            break;
          }
        }
        unansweredSegments = allSegments.slice(currStartIdx);
      }
    }

    // Fallback: If unanswered block is still empty, take the last 8 segments
    if (unansweredSegments.length === 0) {
      unansweredSegments = allSegments.slice(-8);
    }

    // Advance cursor timestamp ONLY after capturing unansweredSegments
    if (triggerSource === 'voice') {
      store.setQuestionCursorTimestamp(Date.now());
    }

    // Derive authentic full question text
    const fullQuestionText =
      triggerSource === 'voice' || !userTypedPrompt
        ? unansweredSegments.map((s) => s.text).join(' ') || 'Live Spoken Question'
        : userTypedPrompt;

    const usedMemories = await memoryBrain.retrieveRelevantMemories(
      userTypedPrompt || fullQuestionText,
      allSegments,
      6
    );

    // Screen vision snapshot if attached or live screen active
    let imageBase64: string | null = null;
    if (request.imageDataUrl) {
      imageBase64 = request.imageDataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
    } else if (state.isLiveScreenActive) {
      try {
        const snap = await screenCaptureService.captureSelfExcludedSnapshot();
        if (snap) {
          imageBase64 = snap.data;
        }
      } catch (err) {
        console.warn('[AIRouter] Screen capture snapshot failed, continuing with audio/text only:', err);
      }
    }

    // Build assembled system instruction & knowledge context
    const systemPrompt = this.buildSystemPrompt(activeMode.contextPrompt, activeMode.files, usedMemories);

    // Build True Multi-Turn History Messages (Last 6 Q&A assist events from activeSession)
    const historyMessages: ChatHistoryMessage[] = [];
    const pastAssists = (activeSession.assistEvents || []).slice(-6);
    for (const ev of pastAssists) {
      if (ev.userPrompt && ev.aiResponse) {
        historyMessages.push({ role: 'user', content: ev.userPrompt });
        historyMessages.push({ role: 'assistant', content: ev.aiResponse });
      }
    }

    // Build Current User Message Content
    const userMessageContent = this.buildUserPrompt(
      userTypedPrompt,
      unansweredSegments,
      allSegments,
      triggerSource
    );

    let accumulatedResponse = '';

    const sendChunk = (delta: string) => {
      accumulatedResponse += delta;
      const chunk: AIStreamChunk = {
        requestId: request.requestId,
        delta,
        done: false,
        usedMemories,
        activeModeName: activeMode.name,
        modelUsed: `${provider}:${model}`,
      };
      windowManager.broadcastToAllWindows('ai:stream-chunk', chunk);
      windowManager.broadcastToAllWindows('ai:chunk', delta);
      companionServer.broadcastToClients('ai:stream-chunk', chunk);
    };

    const sendDone = () => {
      if (accumulatedResponse.trim()) {
        // If response starts with **Question:**, extract the phonetically repaired question for session history title!
        let finalTitle = fullQuestionText;
        const qMatch = accumulatedResponse.match(/^\*\*Question:\*\*\s*(.+?)(\n|$)/i);
        if (qMatch && qMatch[1]?.trim()) {
          finalTitle = qMatch[1].trim();
        }

        store.recordAssistEvent({
          userPrompt: finalTitle,
          aiResponse: accumulatedResponse.trim(),
          modeName: activeMode.name,
          triggerSource,
        });
      }

      const chunk: AIStreamChunk = {
        requestId: request.requestId,
        delta: '',
        done: true,
        usedMemories,
        activeModeName: activeMode.name,
        modelUsed: `${provider}:${model}`,
      };
      windowManager.broadcastToAllWindows('ai:stream-chunk', chunk);
      companionServer.broadcastToClients('ai:stream-chunk', chunk);
      this.activeStreams.delete(request.requestId);
    };

    const sendError = (errMsg: string) => {
      const chunk: AIStreamChunk = {
        requestId: request.requestId,
        delta: '',
        done: true,
        error: errMsg,
        usedMemories,
        activeModeName: activeMode.name,
        modelUsed: `${provider}:${model}`,
      };
      windowManager.broadcastToAllWindows('ai:stream-chunk', chunk);
      companionServer.broadcastToClients('ai:stream-chunk', chunk);
      this.activeStreams.delete(request.requestId);
    };

    try {
      const getOllamaModel = () => {
        if (model && model !== 'default') return model;
        if (aiConfig.activeModel && aiConfig.activeModel !== 'default') return aiConfig.activeModel;
        return 'nemotron-mini';
      };

      if (provider === 'gemini') {
        await this.streamGemini(
          aiConfig.apiKeys.gemini,
          model || 'gemini-2.5-flash',
          systemPrompt,
          historyMessages,
          userMessageContent,
          imageBase64,
          controller.signal,
          sendChunk
        );
      } else if (provider === 'openai') {
        await this.streamOpenAI(
          aiConfig.apiKeys.openai,
          model || 'gpt-4o',
          systemPrompt,
          historyMessages,
          userMessageContent,
          imageBase64,
          controller.signal,
          sendChunk
        );
      } else if (provider === 'anthropic') {
        await this.streamAnthropic(
          aiConfig.apiKeys.anthropic,
          model || 'claude-3-5-sonnet-20241022',
          systemPrompt,
          historyMessages,
          userMessageContent,
          imageBase64,
          controller.signal,
          sendChunk
        );
      } else if (provider === 'groq') {
        await this.streamGroq(
          aiConfig.apiKeys.groq,
          model || 'llama-3.3-70b-versatile',
          systemPrompt,
          historyMessages,
          userMessageContent,
          controller.signal,
          sendChunk
        );
      } else {
        // Default / Offline: Use Local Ollama (nemotron-mini, gemma4:e4b, qwen3-vl, llama3.1, deepseek-r1)
        const targetOllamaModel = getOllamaModel();
        console.log(`[AIRouter] Routing to Local Ollama model: ${targetOllamaModel} (provider=${provider})`);

        await this.streamOllama(
          aiConfig.apiKeys.ollamaUrl || 'http://127.0.0.1:11434',
          targetOllamaModel,
          systemPrompt,
          historyMessages,
          userMessageContent,
          imageBase64,
          controller.signal,
          sendChunk
        );
      }

      sendDone();
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        return;
      }
      console.error('[AIRouter] Streaming failed:', err);
      sendError(err instanceof Error ? err.message : String(err));
    }
  }

  private buildSystemPrompt(
    modeContextPrompt: string,
    files: Array<{ name: string; extractedText: string }>,
    memories: MemoryItem[]
  ): string {
    const parts: string[] = [];

    parts.push(`You are Cluely, an ultra-smart real-time stealth teleprompter and copilot assisting the user live during meetings, interviews, and work sessions.`);
    parts.push(`CRITICAL BEHAVIORAL DIRECTIVES:
1. READ THE ENTIRE LIVE QUESTION & ANSWER COMPLETELY:
- Read the entire live transcript question from start to finish—if it has multiple sentences, parts, or follow-ups, answer EVERY part completely.
- NEVER cut off your answer halfway. Deliver a complete, satisfying, structured response.

2. MULTI-TURN CONVERSATION MEMORY:
- Use the prior conversation turns provided in this session to maintain full context for follow-up questions.
- NEVER repeat or re-answer previous questions from earlier in the session. Build naturally upon what was already discussed.

3. FIRST-PERSON EXPERT PERSONA:
- Answer directly from the candidate/engineer's perspective ("I designed...", "In our architecture...", "We implemented...").
- Deliver the real technical explanation from the active mode instructions, verified codebase files, and session discussion.
- NEVER output evasive counter-questions or generic confirmation requests. Give the direct answer immediately.
- If code is requested, provide clean, idiomatic code with meaningful variable names.

4. MANDATORY TWO-STEP OUTPUT FORMAT FOR LIVE SPEECH ASSIST:
- When answering live spoken speech, you MUST start your response with a single bold header line identifying the phonetically repaired question:
  **Question:** <1-line phonetically corrected question deduced from the speech block>
  followed on the next line by your direct, authoritative first-person answer ready to speak aloud!
- If the user explicitly typed a direct prompt, answer the prompt directly without the Question header.

5. ASR PHONETIC & CONTEXTUAL SPEECH REPAIR:
- Automated speech recognition (ASR) frequently mishears technical terms, acronyms, or accented Hindi/English speech.
  * Examples: "news lens" / "noose lens" -> "NewsLens AI", "be m 25" -> "BM25", "loosination" -> "hallucination", "rag as" -> "RAGAS", "cross in coder" -> "cross-encoder", "artikil chunks" -> "article_chunks_v2 (Qdrant MRL)", "dock her" -> "Docker".
- Silently repair any misheard terms against the Active Mode Ground Truth and answer authoritatively. Never mention transcription errors.`);

    const outputLanguage = store.getState().outputLanguage || 'English';
    parts.push(`6. LANGUAGE REQUIREMENT: Deliver the response in ${outputLanguage}. If the conversation is bilingual (Hinglish / Hindi), ensure the answer feels completely natural for the user to speak aloud.`);

    if (modeContextPrompt) {
      parts.push(`\n### ACTIVE MODE GROUND TRUTH & INSTRUCTIONS:\n${modeContextPrompt}`);
    }

    if (files.length > 0) {
      parts.push(`\n### ATTACHED MODE KNOWLEDGE FILES:`);
      for (const file of files) {
        parts.push(`--- File: ${file.name} ---\n${file.extractedText.slice(0, 35000)}`);
      }
    }

    if (memories.length > 0) {
      parts.push(`\n### PERSONAL MEMORY BRAIN (Facts, Preferences & User Context):`);
      for (const m of memories) {
        parts.push(`• [${m.category.toUpperCase()}] ${m.title}: ${m.content}`);
      }
    }

    return parts.join('\n');
  }

  private buildUserPrompt(
    prompt: string,
    unansweredSegments: TranscriptSegment[],
    allSegments: TranscriptSegment[],
    triggerSource: 'typed' | 'voice'
  ): string {
    const parts: string[] = [];

    // Earlier meeting dialogue for context (up to last 12 segments preceding the unanswered block)
    const unansweredIds = new Set(unansweredSegments.map((s) => s.id));
    const earlierSegments = allSegments
      .filter((s) => !unansweredIds.has(s.id))
      .slice(-12);

    if (earlierSegments.length > 0) {
      parts.push(`### EARLIER MEETING DIALOGUE (Last 12 turns for background context):`);
      for (const seg of earlierSegments) {
        const roleDesc = seg.role === 'me' ? 'Candidate (Me)' : 'Interviewer (Them)';
        parts.push(`[${seg.speakerLabel || roleDesc}]: "${seg.text}"`);
      }
      parts.push(`---\n`);
    }

    if (triggerSource === 'voice' || !prompt.trim()) {
      parts.push(`### COMPLETE LIVE SPOKEN QUESTION / DIALOGUE TO ANSWER NOW:`);
      for (const seg of unansweredSegments) {
        const roleDesc = seg.role === 'me' ? 'Candidate (Me)' : 'Interviewer (Them)';
        parts.push(`[${seg.speakerLabel || roleDesc}]: "${seg.text}"`);
      }
      parts.push(`\nINSTRUCTIONS FOR THIS TURN:
1. Synthesize the overarching technical question from the ENTIRE live spoken dialogue above. If it spans multiple sentences or clauses, answer EVERY part thoroughly.
2. Silently repair any phonetic ASR errors using the Active Mode ground truth and prior turns.
3. Begin your response with:
**Question:** <1-line phonetically corrected question deduced from the speech block>
followed immediately by your authoritative, first-person answer ready to say out loud.`);
    } else {
      parts.push(`### CANDIDATE DIRECTIVE / QUESTION TO ANSWER NOW:\n${prompt.trim()}`);
      if (unansweredSegments.length > 0) {
        parts.push(`\n### ACCOMPANYING LIVE ROOM SPEECH:`);
        for (const seg of unansweredSegments) {
          const roleDesc = seg.role === 'me' ? 'Candidate (Me)' : 'Interviewer (Them)';
          parts.push(`[${seg.speakerLabel || roleDesc}]: "${seg.text}"`);
        }
      }
      parts.push(`\nAddress this directive directly using the Active Mode ground truth and session context.`);
    }

    return parts.join('\n');
  }

  /**
   * Gemini SSE Streaming
   */
  private async streamGemini(
    apiKey: string,
    model: string,
    systemPrompt: string,
    historyMessages: ChatHistoryMessage[],
    userPrompt: string,
    imageBase64: string | null,
    signal: AbortSignal,
    onChunk: (delta: string) => void
  ): Promise<void> {
    if (!apiKey) throw new Error('Gemini API key is required');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const userParts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];
    if (imageBase64) {
      userParts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: imageBase64,
        },
      });
    }
    userParts.push({ text: userPrompt });

    const contents = [
      ...historyMessages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      { role: 'user', parts: userParts },
    ];

    const body = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini error (${res.status}): ${err}`);
    }

    await this.consumeSSE(res, signal, (dataStr) => {
      try {
        const json = JSON.parse(dataStr);
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) onChunk(text);
      } catch {}
    });
  }

  /**
   * OpenAI Chat Completions SSE Streaming
   */
  private async streamOpenAI(
    apiKey: string,
    model: string,
    systemPrompt: string,
    historyMessages: ChatHistoryMessage[],
    userPrompt: string,
    imageBase64: string | null,
    signal: AbortSignal,
    onChunk: (delta: string) => void
  ): Promise<void> {
    if (!apiKey) throw new Error('OpenAI API key is required');

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    if (imageBase64) {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
      });
    }
    userContent.push({ type: 'text', text: userPrompt });

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ];

    const body = {
      model,
      stream: true,
      messages,
      temperature: 0.2,
    };

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI error (${res.status}): ${err}`);
    }

    await this.consumeSSE(res, signal, (dataStr) => {
      if (dataStr.trim() === '[DONE]') return;
      try {
        const json = JSON.parse(dataStr);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch {}
    });
  }

  /**
   * Anthropic Messages SSE Streaming
   */
  private async streamAnthropic(
    apiKey: string,
    model: string,
    systemPrompt: string,
    historyMessages: ChatHistoryMessage[],
    userPrompt: string,
    imageBase64: string | null,
    signal: AbortSignal,
    onChunk: (delta: string) => void
  ): Promise<void> {
    if (!apiKey) throw new Error('Anthropic API key is required');

    const content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [];
    if (imageBase64) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: imageBase64,
        },
      });
    }
    content.push({ type: 'text', text: userPrompt });

    const messages = [
      ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content },
    ];

    const body = {
      model,
      system: systemPrompt,
      stream: true,
      max_tokens: 2048,
      messages,
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic error (${res.status}): ${err}`);
    }

    await this.consumeSSE(res, signal, (dataStr) => {
      try {
        const json = JSON.parse(dataStr);
        if (json.type === 'content_block_delta' && json.delta?.text) {
          onChunk(json.delta.text);
        }
      } catch {}
    });
  }

  /**
   * Groq Chat Completions SSE Streaming
   */
  private async streamGroq(
    apiKey: string,
    model: string,
    systemPrompt: string,
    historyMessages: ChatHistoryMessage[],
    userPrompt: string,
    signal: AbortSignal,
    onChunk: (delta: string) => void
  ): Promise<void> {
    if (!apiKey) throw new Error('Groq API key is required');

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userPrompt },
    ];

    const body = {
      model,
      stream: true,
      messages,
      temperature: 0.2,
    };

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Groq error (${res.status}): ${err}`);
    }

    await this.consumeSSE(res, signal, (dataStr) => {
      if (dataStr.trim() === '[DONE]') return;
      try {
        const json = JSON.parse(dataStr);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch {}
    });
  }

  /**
   * Ollama NDJSON Streaming with True Multi-Turn History
   */
  private async streamOllama(
    baseUrl: string,
    model: string,
    systemPrompt: string,
    historyMessages: ChatHistoryMessage[],
    userPrompt: string,
    imageBase64: string | null,
    signal: AbortSignal,
    onChunk: (delta: string) => void
  ): Promise<void> {
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/chat`;

    let activeModel = model;
    let imagesToSend: string[] | undefined = undefined;

    const isVisionModel = /vision|vl|multimodal|llava/i.test(model);
    if (imageBase64) {
      if (isVisionModel) {
        imagesToSend = [imageBase64];
      } else {
        try {
          const tagsRes = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { signal });
          if (tagsRes.ok) {
            const tagsJson = (await tagsRes.json()) as { models?: Array<{ name: string }> };
            const installed = (tagsJson.models || []).map((m) => m.name.toLowerCase());
            const visionCandidate = installed.find((n) =>
              /qwen3-vl|llama3\.2-vision|llava/i.test(n)
            );
            if (visionCandidate) {
              activeModel = visionCandidate;
              imagesToSend = [imageBase64];
            }
          }
        } catch {}
      }
    }

    const userMessage: { role: string; content: string; images?: string[] } = {
      role: 'user',
      content: userPrompt,
    };
    if (imagesToSend && imagesToSend.length > 0) {
      userMessage.images = imagesToSend;
    }

    const body: Record<string, unknown> = {
      model: activeModel,
      messages: [
        { role: 'system', content: systemPrompt },
        ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
        userMessage,
      ],
      think: false, // Disables internal reasoning buffer so responses stream immediately
      options: {
        temperature: 0.15,
        top_p: 0.85,
        num_predict: 450, // Optimal token limit for lightning-fast teleprompter answers
      },
      stream: true,
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama error (${res.status}): ${err}`);
    }

    if (!res.body) {
      throw new Error('Ollama response body is empty');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          // Only emit actual message content, ignore thinking steps
          if (json.message?.content) {
            let chunkText = json.message.content;
            chunkText = chunkText.replace(/<think>[\s\S]*?<\/think>/gi, '');
            if (chunkText) {
              onChunk(chunkText);
            }
          }
          if (json.done) {
            return;
          }
        } catch {}
      }
    }

    if (buffer.trim()) {
      try {
        const json = JSON.parse(buffer);
        if (json.message?.content) {
          let chunkText = json.message.content;
          chunkText = chunkText.replace(/<think>[\s\S]*?<\/think>/gi, '');
          if (chunkText) {
            onChunk(chunkText);
          }
        }
      } catch {}
    }
  }

  /**
   * Helper to consume Server-Sent Events (SSE) stream
   */
  private async consumeSSE(
    res: Response,
    signal: AbortSignal,
    onData: (data: string) => void
  ): Promise<void> {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      if (signal.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          onData(line.slice(6));
        }
      }
    }

    if (buffer.startsWith('data: ')) {
      onData(buffer.slice(6));
    }
  }
}

export const aiRouter = new AIRouter();
