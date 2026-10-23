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
  SessionAssistEvent,
} from '../../src/types/ipc';

export class AIRouter {
  private activeStreams: Map<string, AbortController> = new Map();
  private lastConsumedTranscriptId: string | null = null;
  private lastConsumedTimestamp: number = 0;

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

    // FIX 1: If this is a voice assist, wait for in-flight ASR transcription tasks to commit to store!
    if (triggerSource === 'voice') {
      try {
        await transcriptionService.waitForPendingTranscriptions(1500);
      } catch (waitErr) {
        console.warn('[AIRouter] waitForPendingTranscriptions error, continuing:', waitErr);
      }
    }

    // Retrieve transcripts: combine activeSession transcripts, request.transcript, and store transcripts
    const stateTranscripts = store.getState().transcripts || [];
    const sessions = store.getState().pastSessions || [];
    const activeSession = sessions.find((s) => s.id === store.getState().currentSessionId) || sessions[0];
    const sessionChat = activeSession?.assistEvents || [];

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
    const combinedTranscripts = Array.from(segmentMap.values());

    // Sort chronologically (oldest to newest)
    combinedTranscripts.sort((a, b) => {
      const timeA = a.timestamp || a.startTimeMs || 0;
      const timeB = b.timestamp || b.startTimeMs || 0;
      return timeA - timeB;
    });

    // FIX 2: Deterministic Spoken Segment Cursor Slicing
    let unansweredSpeechBlock: TranscriptSegment[] = [];

    if (triggerSource === 'voice') {
      if (this.lastConsumedTranscriptId) {
        const lastIdx = combinedTranscripts.findIndex(
          (s) => s.id === this.lastConsumedTranscriptId
        );
        if (lastIdx !== -1) {
          // Check if previous segment ended less than 4 seconds before next segment (overlap buffer)
          const lastSeg = combinedTranscripts[lastIdx];
          const nextSeg = combinedTranscripts[lastIdx + 1];
          const hasOverlap =
            nextSeg &&
            lastSeg &&
            Math.abs((nextSeg.timestamp || 0) - (lastSeg.timestamp || 0)) < 4000;
          const startSliceIdx = hasOverlap ? lastIdx : lastIdx + 1;
          unansweredSpeechBlock = combinedTranscripts.slice(startSliceIdx);
        } else if (this.lastConsumedTimestamp > 0) {
          unansweredSpeechBlock = combinedTranscripts.filter(
            (s) => (s.timestamp || s.startTimeMs || 0) >= this.lastConsumedTimestamp - 4000
          );
        }
      }

      // Fallback: If no cursor or if unanswered block is empty, take the last 10 segments
      if (unansweredSpeechBlock.length === 0) {
        unansweredSpeechBlock = combinedTranscripts.slice(-10);
      }

      // Update cursor immediately at request start so speech spoken during generation is preserved!
      if (unansweredSpeechBlock.length > 0) {
        const lastSegInBlock = unansweredSpeechBlock[unansweredSpeechBlock.length - 1];
        this.lastConsumedTranscriptId = lastSegInBlock.id;
        this.lastConsumedTimestamp =
          lastSegInBlock.timestamp || lastSegInBlock.startTimeMs || Date.now();
      }
    } else {
      // Trigger source is 'typed': do NOT advance lastConsumedTranscriptId!
      unansweredSpeechBlock = combinedTranscripts.slice(-10);
    }

    // Derive a clean question title for recording in session history
    let questionSummary = userTypedPrompt;
    if (triggerSource === 'voice' || !questionSummary) {
      const questionLikeSeg = [...unansweredSpeechBlock]
        .reverse()
        .find((s) => s.text.includes('?') || s.role === 'them');
      if (questionLikeSeg) {
        questionSummary = questionLikeSeg.text;
      } else {
        const lastSeg =
          unansweredSpeechBlock[unansweredSpeechBlock.length - 1] ||
          combinedTranscripts[combinedTranscripts.length - 1];
        questionSummary = lastSeg ? lastSeg.text : 'Live Spoken Question';
      }
    }

    const usedMemories = await memoryBrain.retrieveRelevantMemories(
      userTypedPrompt || questionSummary,
      combinedTranscripts,
      6
    );

    // Resolve screenshot image: only capture screen if attached or live screen is active
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
    const userMessageContent = this.buildUserPrompt(
      userTypedPrompt,
      unansweredSpeechBlock,
      sessionChat,
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
        let finalTitle = questionSummary;
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
      // Helper to determine optimal Ollama model
      const getOllamaModel = () => {
        if (imageBase64) {
          // qwen3-vl is installed locally and handles multimodal vision
          return 'qwen3-vl';
        }
        if (model && model !== 'gemini-2.5-flash' && model !== 'gpt-4o' && model !== 'claude-3-5-sonnet-20241022') {
          return model;
        }
        return 'nemotron-mini';
      };

      const hasGemini = Boolean(aiConfig.apiKeys.gemini?.trim());
      const hasOpenAI = Boolean(aiConfig.apiKeys.openai?.trim());
      const hasAnthropic = Boolean(aiConfig.apiKeys.anthropic?.trim());
      const hasGroq = Boolean(aiConfig.apiKeys.groq?.trim());

      if (provider === 'gemini' && hasGemini) {
        await this.streamGemini(
          aiConfig.apiKeys.gemini,
          model || 'gemini-2.5-flash',
          systemPrompt,
          userMessageContent,
          imageBase64,
          controller.signal,
          sendChunk
        );
      } else if (provider === 'openai' && hasOpenAI) {
        await this.streamOpenAI(
          aiConfig.apiKeys.openai,
          model || 'gpt-4o',
          systemPrompt,
          userMessageContent,
          imageBase64,
          controller.signal,
          sendChunk
        );
      } else if (provider === 'anthropic' && hasAnthropic) {
        await this.streamAnthropic(
          aiConfig.apiKeys.anthropic,
          model || 'claude-3-5-sonnet-20241022',
          systemPrompt,
          userMessageContent,
          imageBase64,
          controller.signal,
          sendChunk
        );
      } else if (provider === 'groq' && hasGroq) {
        await this.streamGroq(
          aiConfig.apiKeys.groq,
          model || 'llama-3.3-70b-versatile',
          systemPrompt,
          userMessageContent,
          controller.signal,
          sendChunk
        );
      } else {
        // Default / Offline: Use Local Ollama (nemotron-mini, qwen3-vl, llama3.1, deepseek-r1)
        const targetOllamaModel = getOllamaModel();
        console.log(`[AIRouter] Routing to Local Ollama model: ${targetOllamaModel} (provider=${provider})`);

        await this.streamOllama(
          aiConfig.apiKeys.ollamaUrl || 'http://127.0.0.1:11434',
          targetOllamaModel,
          systemPrompt,
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
1. NO THINKING PROCESS OR META-CHATTER:
- NEVER output reasoning steps, thinking blocks, <think> tags, or conversational chatter like "Thinking Process:", "Here is what you can say:", "Sure!", or "Let me explain".
- Output ONLY the final, polished answer directly, starting with the very first word.
- SPEED IS ESSENTIAL: The user is in a live conversation and needs instant teleprompter-speed responses.

2. FIRST-PERSON EXPERT PERSONA:
- Answer directly from the user's perspective as the candidate/engineer ("I designed...", "In our architecture...", "We implemented...").
- Answer the actual question or technical topic directly, comprehensively, and authoritatively!
- If the interviewer or speaker asks a question (e.g. about project architecture, NewsLens AI, hallucination handling, evaluation metrics, file paths, or design tradeoffs), deliver the real technical explanation from the mode instructions, files, and session discussion.
- NEVER output evasive counter-questions or generic confirmation requests. Give the direct answer immediately.
- If the user asks for code, programming, or an implementation, provide the clean, correct, working code snippet directly with a 1-sentence explanation.
- If the user asks for a "Recap" or summary, provide a concise 2-3 sentence overview of what was just discussed or seen on screen.
- If the user asks for "Follow-up questions", provide 2-3 sharp, thoughtful questions to bounce back to the meeting participants.

3. TWO-STEP OUTPUT FORMAT FOR SPOKEN SPEECH ASSIST:
- When answering voice assistance requests, you MUST start your response with a single bold header line identifying the repaired question:
  **Question:** <1-line phonetically corrected question deduced from the speech block>
  followed on the next line by your direct, authoritative first-person answer!
- If the user explicitly typed a direct prompt, answer the prompt directly without the Question header.

4. CONTEXTUAL & PHONETIC SPEECH REPAIR (CRITICAL):
- Automated speech recognition (ASR) frequently mishears technical terms, acronyms, or accented Hindi/English speech.
  * Examples: "news lens" / "noose lens" -> "NewsLens AI", "be m 25" / "pm 25" -> "BM25", "loosination" -> "hallucination", "rag as" -> "RAGAS", "cross in coder" -> "cross-encoder", "vector db" -> "Vector Database", "dock her" -> "Docker".
- Use the Mode Instructions, attached project files, and ongoing session history to deduce the real technical terms.
- Silently repair any misheard terms and answer the intended question authoritatively. Never mention transcription errors or ask clarifying questions about misheard terms.`);

    const outputLanguage = store.getState().outputLanguage || 'English';
    parts.push(`5. LANGUAGE REQUIREMENT: Deliver the response in ${outputLanguage}. If the conversation is bilingual (Hinglish / Hindi), ensure the answer feels completely natural for the user to speak aloud.`);

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
    unansweredSpeechBlock: TranscriptSegment[],
    sessionChat: SessionAssistEvent[] = [],
    triggerSource: 'typed' | 'voice' = 'voice'
  ): string {
    const parts: string[] = [];

    if (triggerSource === 'voice') {
      // FIX 3: Enclose within <unanswered_live_speech_since_last_question>
      parts.push(`<unanswered_live_speech_since_last_question>`);
      for (const seg of unansweredSpeechBlock) {
        const roleDesc = seg.role === 'me' ? 'Candidate (Me)' : 'Interviewer (Them)';
        parts.push(`[${seg.speakerLabel || roleDesc} - ${roleDesc}]: "${seg.text}"`);
      }
      parts.push(`</unanswered_live_speech_since_last_question>\n`);

      parts.push(`### MANDATORY PHONETIC SPEECH REPAIR & QUESTION SYNTHESIS:
1. DIALOGUE QUESTION SYNTHESIS:
- Carefully analyze the full <unanswered_live_speech_since_last_question> block above spoken since the last ended question.
- Synthesize the overarching technical question, challenge, or topic being evaluated across all conversational turns.
- If the candidate ([Candidate (Me)]) spoke last or repeated/clarified the question, or if the interviewer spoke across multiple sentences, synthesize the complete question from the entire dialogue.
- Ignore conversational filler like "thank you", "yeah", "okay", or trailing half-phrases.

2. ASR PHONETIC & CONTEXTUAL ERROR REPAIR:
- Real-time speech recognition often mishears technical terms, project names, and accented words.
- Cross-reference every phonetically ambiguous word against:
  * Active Mode Ground Truth (NewsLens-AI, Qdrant, IBM Docling, Qwen3-VL, RAGAS, BM25, Cross-Encoder, etc.)
  * Attached Mode Files
  * Prior Session Q&A Topics (see reference below)
  * Personal Memory Brain
- Silently deduce and repair what was intended (e.g., "noose lens" -> "NewsLens AI", "loosination" -> "hallucination", "be m 25" -> "BM25", "rag as" -> "RAGAS", "cross in coder" -> "cross-encoder").

3. MANDATORY OUTPUT FORMAT:
- You MUST begin your response with a single bold header line identifying the phonetically repaired question:
  **Question:** <1-line phonetically corrected question deduced from the speech block>
- Immediately followed on the next line by your direct, authoritative first-person answer ready to speak aloud in the interview!
- Provide concrete codebase file paths, evaluation metrics, step-by-step instructions, and clean code as required by the mode.`);
    } else {
      // Trigger source is 'typed'
      parts.push(`### CANDIDATE DIRECTIVE:\n${prompt}\n(Address this directive directly using the Active Mode ground truth and session context.)`);

      if (unansweredSpeechBlock.length > 0) {
        parts.push(`\n### RECENT CONVERSATION CONTEXT (For reference):`);
        for (const seg of unansweredSpeechBlock) {
          const roleDesc = seg.role === 'me' ? 'Candidate (Me)' : 'Interviewer (Them)';
          parts.push(`[${seg.speakerLabel || roleDesc} - ${roleDesc}]: "${seg.text}"`);
        }
        parts.push(`---\n`);
      }
    }

    // Previous Session History formatted as compact 1-line topic summaries at the bottom
    if (sessionChat && sessionChat.length > 0) {
      parts.push(`\n### PRIOR SESSION TURNS (For continuity & phonetic reference only - DO NOT RE-ANSWER):`);
      const recentChat = sessionChat.slice(-5);
      for (const turn of recentChat) {
        const topic = turn.userPrompt.slice(0, 60);
        const snippet = turn.aiResponse.replace(/\s+/g, ' ').slice(0, 100);
        parts.push(`• [Prior Turn: "${topic}" -> "${snippet}..."]`);
      }
      parts.push(`---\n`);
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
    userPrompt: string,
    imageBase64: string | null,
    signal: AbortSignal,
    onChunk: (delta: string) => void
  ): Promise<void> {
    if (!apiKey) throw new Error('Gemini API key is required');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];
    if (imageBase64) {
      parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: imageBase64,
        },
      });
    }
    parts.push({ text: userPrompt });

    const body = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [{ role: 'user', parts }],
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
      } catch {
        // partial json ignored
      }
    });
  }

  /**
   * OpenAI Chat Completions SSE Streaming
   */
  private async streamOpenAI(
    apiKey: string,
    model: string,
    systemPrompt: string,
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

    const body = {
      model,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
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

    const body = {
      model,
      system: systemPrompt,
      stream: true,
      max_tokens: 2048,
      messages: [{ role: 'user', content }],
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
    userPrompt: string,
    signal: AbortSignal,
    onChunk: (delta: string) => void
  ): Promise<void> {
    if (!apiKey) throw new Error('Groq API key is required');

    const body = {
      model,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
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
   * Ollama NDJSON Streaming
   */
  private async streamOllama(
    baseUrl: string,
    model: string,
    systemPrompt: string,
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
        // Model is text-only (e.g. gemma4:e4b, nemotron-mini, llama3.1, deepseek-r1).
        // Check if qwen3-vl or another vision model is installed for multimodal requests.
        // If not, omit images to prevent Ollama from failing with HTTP 400!
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
        } catch {
          // Keep text-only model and omit images so text prompt still succeeds
        }
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

    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let inThinkTag = false;

    while (true) {
      if (signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed);
          // If chunk is reasoning/thinking tokens, suppress it from output
          if (json.message?.thinking) {
            continue;
          }

          let rawChunk = json.message?.content ?? json.response ?? '';
          if (!rawChunk) continue;

          // Strip <think>...</think> tags if present
          if (rawChunk.includes('<think>')) {
            inThinkTag = true;
            rawChunk = rawChunk.split('<think>')[0];
          }
          if (inThinkTag) {
            if (rawChunk.includes('</think>')) {
              rawChunk = rawChunk.split('</think>')[1] || '';
              inThinkTag = false;
            } else {
              rawChunk = '';
            }
          }

          if (rawChunk) {
            onChunk(rawChunk);
          }
        } catch {}
      }
    }
  }

  /**
   * Helper to consume standard text/event-stream responses
   */
  private async consumeSSE(
    res: Response,
    signal: AbortSignal,
    onData: (data: string) => void
  ): Promise<void> {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const dataContent = trimmed.slice(5).trim();
          onData(dataContent);
        }
      }
    }
  }
}

export const aiRouter = new AIRouter();
