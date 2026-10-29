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
  private cachedInstalledModels: string[] = [];
  private lastTagsFetchMs: number = 0;

  public cancelStream(requestId: string): void {
    const controller = this.activeStreams.get(requestId);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(requestId);
    }
  }

  /**
   * Pre-warms and pins the active local Ollama model in unified GPU memory (`keep_alive: -1`)
   * so that live meeting questions stream in 2-3 seconds with zero disk cold-start!
   */
  public async prewarmLocalModel(): Promise<void> {
    const state = store.getState();
    if (state.aiConfig.activeProvider !== 'ollama') return;
    const baseUrl = (state.aiConfig.apiKeys.ollamaUrl || 'http://127.0.0.1:11434').replace(
      /\/+$/,
      ''
    );

    try {
      const targetModel = await this.resolveFastOllamaModel(
        baseUrl,
        state.aiConfig.activeModel || 'gemma4:e4b'
      );
      await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: 'user', content: 'hi' }],
          think: false,
          keep_alive: -1,
          options: { num_ctx: 2048, num_predict: 1 },
          stream: false,
        }),
      });
      console.log(`[AIRouter] Pre-warmed & pinned '${targetModel}' in GPU memory (keep_alive=-1)`);
    } catch {
      // Ollama may not be running yet
    }
  }

  private async resolveFastOllamaModel(
    cleanBase: string,
    requestedModel: string,
    signal?: AbortSignal
  ): Promise<string> {
    const now = Date.now();
    if (this.cachedInstalledModels.length === 0 || now - this.lastTagsFetchMs > 30000) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 600);
        const tagsRes = await fetch(`${cleanBase}/api/tags`, {
          signal: signal || controller.signal,
        });
        clearTimeout(t);
        if (tagsRes.ok) {
          const tagsJson = (await tagsRes.json()) as { models?: Array<{ name: string }> };
          this.cachedInstalledModels = (tagsJson.models || []).map((m) => m.name);
          this.lastTagsFetchMs = now;
        }
      } catch {}
    }

    if (this.cachedInstalledModels.length > 0) {
      const exactOrPrefix = this.cachedInstalledModels.find(
        (m) =>
          m.toLowerCase() === requestedModel.toLowerCase() ||
          m.toLowerCase().startsWith(requestedModel.toLowerCase())
      );
      if (exactOrPrefix) return exactOrPrefix;

      const fallbackOrder = [
        'cluely-gemma4',
        'gemma4:e4b',
        'gemma4:12b',
        'gemma4',
        'gemma3',
        'nemotron-mini',
        'qwen3-vl',
        'llama3',
      ];
      for (const pref of fallbackOrder) {
        const match = this.cachedInstalledModels.find((m) => m.toLowerCase().includes(pref));
        if (match) return match;
      }
    }

    return requestedModel || 'gemma4:e4b';
  }

  public async streamPrompt(request: AIStreamRequest): Promise<void> {
    const state = store.getState();
    const aiConfig = state.aiConfig;
    const provider = aiConfig.activeProvider;
    const model = aiConfig.activeModel;

    const modeId = request.modeId || state.activeModeId;
    const activeMode = state.modes.find((m) => m.id === modeId) || state.modes[0];

    const userTypedPrompt = request.prompt?.trim() || '';
    const triggerSource: 'typed' | 'voice' =
      request.triggerSource || (userTypedPrompt ? 'typed' : 'voice');

    for (const ctrl of this.activeStreams.values()) {
      try {
        ctrl.abort();
      } catch {}
    }
    this.activeStreams.clear();

    const controller = new AbortController();
    this.activeStreams.set(request.requestId, controller);

    // Wait up to 900ms for any in-flight Sherpa-ONNX chunk (~150ms decode time)
    try {
      await transcriptionService.awaitPendingTranscriptions(900);
    } catch {}

    const activeSession = store.ensureActiveSession();

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

    const cursorTs = store.getQuestionCursorTimestamp();
    let unansweredSegments = allSegments.filter(
      (t) => (t.timestamp || t.startTimeMs || 0) >= cursorTs
    );

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
          if (
            currStart - prevEnd <= 10000 ||
            Math.abs(currStart - (prevSeg.timestamp || 0)) <= 10000
          ) {
            currStartIdx--;
          } else {
            break;
          }
        }
        unansweredSegments = allSegments.slice(currStartIdx);
      }
    }

    if (unansweredSegments.length === 0) {
      unansweredSegments = allSegments.slice(-6);
    }

    if (triggerSource === 'voice') {
      store.setQuestionCursorTimestamp(Date.now());
    }

    const fullQuestionText =
      triggerSource === 'voice' || !userTypedPrompt
        ? unansweredSegments.map((s) => s.text).join(' ') || 'Live Spoken Question'
        : userTypedPrompt;

    // <1ms in-memory Hybrid Vector + BM25 retrieval (zero network or model-swap latency!)
    const [usedMemories, relevantFileChunks] = await Promise.all([
      memoryBrain.retrieveRelevantMemories(
        userTypedPrompt || fullQuestionText,
        allSegments,
        4
      ),
      memoryBrain.retrieveRelevantFileChunks(
        userTypedPrompt || fullQuestionText,
        activeMode.files || [],
        4
      ),
    ]);

    let imageBase64: string | null = null;
    if (request.imageDataUrl) {
      imageBase64 = request.imageDataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
    } else if (state.isLiveScreenActive) {
      try {
        const snap = await screenCaptureService.captureSelfExcludedSnapshot();
        if (snap) {
          imageBase64 = snap.data;
        }
      } catch {}
    }

    const systemPrompt = this.buildSystemPrompt(
      activeMode.contextPrompt,
      relevantFileChunks,
      usedMemories,
      activeSession.notes
    );

    // Keep last 4 Q&A turns for multi-turn continuity while keeping prefill <150ms
    const historyMessages: ChatHistoryMessage[] = [];
    const pastAssists = (activeSession.assistEvents || []).slice(-4);
    for (const ev of pastAssists) {
      if (ev.userPrompt && ev.aiResponse) {
        historyMessages.push({ role: 'user', content: ev.userPrompt });
        historyMessages.push({ role: 'assistant', content: ev.aiResponse });
      }
    }

    const userMessageContent = this.buildUserPrompt(
      userTypedPrompt,
      unansweredSegments,
      allSegments,
      triggerSource,
      Boolean(imageBase64)
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
        return 'gemma4:e4b';
      };

      const targetOllamaModel = getOllamaModel();
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
    fileChunks: Array<{ fileName: string; text: string; score: number }>,
    memories: MemoryItem[],
    sessionNotes?: string
  ): string {
    const outputLanguage = store.getState().outputLanguage || 'English';
    const parts: string[] = [];

    parts.push(
      `You are Cluely, an ultra-fast 2-second real-time teleprompter copilot.
SPEED & QUICK-THINKING RULES (CRITICAL):
1. INSTANT 2-3 SECOND ANSWERS: Skip deep deliberation, long intros, and filler. Output the direct, speakable first-person answer ("I...", "We...") immediately on token #1.
2. CONCISE & PUNCHY: Deliver 3-4 crisp bullet points (max 80-110 words for spoken questions, or clean code + 1-line complexity for coding) so the user can read and speak it in 2 seconds.
3. VOICE QUESTION FORMAT: For spoken dialogue, start with:
**Question:** <1-line clear question asked>
followed immediately by the bulleted first-person answer.
4. ZERO HALLUCINATION: Rely strictly on the live transcript, screen image, Mode instructions, Vector DB chunks, and Memory Vault. Language: ${outputLanguage}.`
    );

    if (modeContextPrompt) {
      parts.push(`\nMODE: ${modeContextPrompt.slice(0, 1200)}`);
    }

    if (sessionNotes && sessionNotes.trim()) {
      parts.push(`\nNOTES: ${sessionNotes.trim().slice(0, 800)}`);
    }

    if (fileChunks.length > 0) {
      parts.push(`\nVECTOR RAG CHUNKS:`);
      for (const chunk of fileChunks) {
        parts.push(`[${chunk.fileName}]: ${chunk.text.slice(0, 700)}`);
      }
    }

    if (memories.length > 0) {
      parts.push(`\nUSER MEMORIES:`);
      for (const m of memories) {
        parts.push(`• ${m.title}: ${m.content}`);
      }
    }

    return parts.join('\n');
  }

  private buildUserPrompt(
    prompt: string,
    unansweredSegments: TranscriptSegment[],
    allSegments: TranscriptSegment[],
    triggerSource: 'typed' | 'voice',
    hasScreenImage: boolean
  ): string {
    const parts: string[] = [];

    const unansweredIds = new Set(unansweredSegments.map((s) => s.id));
    const earlierSegments = allSegments
      .filter((s) => !unansweredIds.has(s.id))
      .slice(-6);

    if (earlierSegments.length > 0) {
      parts.push(`RECENT CONTEXT:`);
      for (const seg of earlierSegments) {
        const roleDesc = seg.role === 'me' ? 'Me' : 'Them';
        parts.push(`[${seg.speakerLabel || roleDesc}]: "${seg.text}"`);
      }
    }

    if (triggerSource === 'voice' || !prompt.trim()) {
      if (unansweredSegments.length > 0) {
        parts.push(`LIVE SPOKEN QUESTION TO ANSWER NOW (IN 2-3 SECONDS):`);
        for (const seg of unansweredSegments) {
          const roleDesc = seg.role === 'me' ? 'Me' : 'Them';
          parts.push(`[${seg.speakerLabel || roleDesc}]: "${seg.text}"`);
        }
        parts.push(
          `\nOutput:\n**Question:** <1-line question>\nFollowed immediately by 3-4 concise, speakable first-person bullet points.`
        );
      } else if (hasScreenImage) {
        parts.push(
          `Analyze the problem or code on screen and give the immediate solution + complexity.`
        );
      } else {
        parts.push(
          `No recent speech detected yet. Give a 1-sentence readiness confirmation.`
        );
      }
    } else {
      parts.push(`DIRECT QUESTION (ANSWER IN 2-3 SECONDS):\n${prompt.trim()}`);
      if (unansweredSegments.length > 0) {
        parts.push(`LIVE SPEECH:`);
        for (const seg of unansweredSegments) {
          const roleDesc = seg.role === 'me' ? 'Me' : 'Them';
          parts.push(`[${seg.speakerLabel || roleDesc}]: "${seg.text}"`);
        }
      }
    }

    return parts.join('\n');
  }

  /**
   * Ultra-Fast 2-3 Second Local Ollama Streaming (`think: false`, `keep_alive: -1`, `num_ctx: 2048`)
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
    const cleanBase = baseUrl.replace(/\/+$/, '');
    const endpoint = `${cleanBase}/api/chat`;

    let activeModel = await this.resolveFastOllamaModel(cleanBase, model, signal);
    let imagesToSend: string[] | undefined = undefined;

    const isVisionCapable = /gemma4|gemma-4|cluely-gemma4|vision|vl|multimodal|llava|gemma3/i.test(
      activeModel
    );

    if (imageBase64) {
      if (isVisionCapable) {
        imagesToSend = [imageBase64];
      } else if (this.cachedInstalledModels.length > 0) {
        const visionFallback = this.cachedInstalledModels.find((n) =>
          /gemma4|qwen3-vl|llama3\.2-vision|llava/i.test(n)
        );
        if (visionFallback) {
          activeModel = visionFallback;
          imagesToSend = [imageBase64];
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
        ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
        userMessage,
      ],
      think: false, // Completely skips deep-thinking buffer for immediate token #1 streaming
      keep_alive: -1, // Keeps model permanently pinned in GPU VRAM
      options: {
        temperature: 0.1,
        top_k: 20,
        top_p: 0.85,
        repeat_penalty: 1.12,
        num_ctx: 2048, // Compact context window for sub-150ms prompt prefill
        num_predict: 280, // Finishes complete teleprompter answer in 2-3 seconds
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
      throw new Error(
        `Ollama error (${res.status}) with model '${activeModel}': ${err}. Ensure Ollama is running and '${model}' is pulled.`
      );
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
          if (json.message?.content) {
            const chunkText = json.message.content.replace(/<think>[\s\S]*?<\/think>/gi, '');
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
          const chunkText = json.message.content.replace(/<think>[\s\S]*?<\/think>/gi, '');
          if (chunkText) {
            onChunk(chunkText);
          }
        }
      } catch {}
    }
  }
}

export const aiRouter = new AIRouter();
