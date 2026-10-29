import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import {
  AppState,
  CluelyMode,
  ShortcutAction,
  AIProviderConfig,
  NvidiaSpeechConfig,
  TranscriptSegment,
  MeetingSession,
  SessionAssistEvent,
} from '../../src/types/ipc';

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  toggleVisibility: 'CommandOrControl+\\',
  askCluely: 'CommandOrControl+Enter',
  newChat: 'CommandOrControl+R',
  openSettings: 'CommandOrControl+,',
  toggleSession: 'CommandOrControl+Shift+\\',
  moveUp: 'CommandOrControl+Up',
  moveDown: 'CommandOrControl+Down',
  moveLeft: 'CommandOrControl+Left',
  moveRight: 'CommandOrControl+Right',
  scrollUp: 'CommandOrControl+Shift+Up',
  scrollDown: 'CommandOrControl+Shift+Down',
};

export const DEFAULT_NVIDIA_SPEECH_CONFIG: NvidiaSpeechConfig = {
  nimApiKey: '',
  nimEndpointUrl: 'https://integrate.api.nvidia.com/v1/audio/transcriptions',
  localParakeetUrl: 'http://127.0.0.1:50051/v1/audio/transcriptions',
  parakeetModelId: 'nvidia/parakeet-tdt-0.6b-v2',
  nemotronModelId: 'nvidia/nemotron-speech-streaming-en-0.6b',
  enableMultiTalker: true,
  handleCrossTalk: true,
  latencyProfile: 'balanced',
};

export const DEFAULT_AI_CONFIG: AIProviderConfig = {
  activeProvider: 'ollama',
  activeModel: 'gemma4:e4b',
  embeddingModel: 'gemma2:2b',
  voiceProvider: 'nvidia-parakeet-tdt',
  apiKeys: {
    ollamaUrl: 'http://127.0.0.1:11434',
  },
  nvidiaSpeech: DEFAULT_NVIDIA_SPEECH_CONFIG,
};

const LEGACY_MOCK_SESSION_IDS = new Set([
  'sess_1',
  'sess_2',
  'sess_3',
  'sess_4',
  'sess_5',
  'sess_6',
  'sess_7',
]);

export const DEFAULT_MODES: CluelyMode[] = [
  {
    id: 'general',
    name: 'General Copilot',
    category: 'general',
    icon: 'compass',
    contextPrompt:
      'You are Cluely, a real-time meeting and desktop copilot. Provide direct, factual, well-structured answers grounded strictly in the live conversation, screen context, attached documents, and personal memory vault. Never invent facts, project names, or credentials.',
    files: [],
  },
  {
    id: 'interview',
    name: 'Technical & Role Interview',
    category: 'work',
    icon: 'briefcase',
    contextPrompt: `I am a candidate in a live interview. Help me deliver clear, confident, first-person answers across technical, architectural, product, and follow-up questions.

STRICT GROUNDING RULES:
1. Rely strictly on attached files (resume, portfolio, codebase docs), Personal Memory Vault, and the current session transcript.
2. NEVER fabricate project names, company names, metrics, or file paths that are not present in my attached files or memories.
3. Structure technical answers with: (a) Direct 1-sentence core answer, (b) Key architectural mechanism & trade-offs, and (c) Concrete real-world impact or complexity.
4. Keep sentences natural and concise so I can speak them aloud effortlessly.`,
    files: [],
  },
  {
    id: 'gen-ai',
    name: 'AI & LLM Engineering',
    category: 'work',
    icon: 'sparkles',
    contextPrompt: `I am in an AI / ML / LLM Systems Engineering interview or technical review. Answer from a first-person principal AI engineer perspective.

KEY FOCUS AREAS:
1. RAG & Vector Databases: Hybrid retrieval (dense embeddings + BM25 lexical search + Reciprocal Rank Fusion), cross-encoder reranking, chunking strategies, and context window optimization.
2. Local & Edge LLM Inference: Quantization (INT4/INT8/GGUF/AWQ), KV-cache management, speculative decoding, and multimodal vision-language pipelines (Gemma 4 e4b / 12b, Llama, Qwen-VL).
3. Fine-Tuning & Alignment: LoRA / QLoRA adapters, DPO/RLHF, synthetic dataset curation, and evaluation benchmarks (Faithfulness, Recall@K, NDCG).
4. Ground answers strictly in my attached project files and memory vault—never hallucinate unverified project names or paths.`,
    files: [],
  },
  {
    id: 'coding-interview',
    name: 'Coding & Algorithms',
    category: 'work',
    icon: 'code',
    contextPrompt:
      'I am in a live coding interview. Inspect the problem statement, IDE code, or terminal on my screen or spoken in audio. Provide: 1) A 2-sentence intuition of the optimal algorithm, 2) Exact Time & Space Complexity (Big-O), 3) Clean, bug-free production code in the active language, and 4) Key edge cases to mention aloud.',
    files: [],
  },
  {
    id: 'system-design',
    name: 'System Design',
    category: 'work',
    icon: 'layers',
    contextPrompt:
      'I am in a distributed systems design interview. Guide me through: 1) Functional & non-functional requirements (latency, throughput, availability), 2) Back-of-the-envelope capacity estimation, 3) API & data model schema, 4) High-level architecture (load balancing, caching, sharding, queues), and 5) Bottlenecks & failure recovery trade-offs.',
    files: [],
  },
  {
    id: 'behavioral-interview',
    name: 'Behavioral (STAR)',
    category: 'work',
    icon: 'user-check',
    contextPrompt:
      'I am in a behavioral or leadership interview. Shape my answers using the STAR framework (Situation, Task, Action, Result) grounded strictly in my attached resume and Personal Memory Vault. Keep the tone conversational, ownership-focused, and easy to speak aloud.',
    files: [],
  },
  {
    id: 'sales',
    name: 'Sales & Discovery',
    category: 'work',
    icon: 'dollar-sign',
    contextPrompt:
      'I am on a customer discovery or enterprise sales call. Help me address objections concisely, surface high-leverage discovery questions, and connect buyer pain points directly to our product capabilities.',
    files: [],
  },
  {
    id: 'team-meet',
    name: 'Team Standup & Sync',
    category: 'work',
    icon: 'users',
    contextPrompt:
      'I am in an internal engineering or product sync. Track key decisions, surface action items with owners, clarify technical blockers, and draft crisp talking points.',
    files: [],
  },
];

export const DEFAULT_STATE: AppState = {
  undetectability: true,
  overlayOpacity: 0.92,
  launchAtLogin: false,
  transcriptionLanguage: 'English (recommended)',
  outputLanguage: 'English',
  selectedMicDeviceId: 'default',
  meetingEnvironment: 'online',
  isSessionActive: true,
  isLiveScreenActive: false,
  selectedScreenSourceId: null,
  isOverlayVisible: true,
  overlayExpanded: false,
  overlayDrawerView: 'none',
  activeModeId: 'general',
  modes: DEFAULT_MODES,
  shortcuts: DEFAULT_SHORTCUTS,
  aiConfig: DEFAULT_AI_CONFIG,
  personalMemories: [],
  voiceProfiles: [],
  transcripts: [],
  pastSessions: [],
  currentSessionId: null,
};

type StateListener = (state: AppState) => void;

export class DomainStore {
  private state: AppState;
  private filePath: string;
  private listeners: Set<StateListener> = new Set();
  private isSaving: boolean = false;
  private pendingSave: boolean = false;
  private activeSessionId: string | null = null;
  private questionCursorTimestamp: number = 0;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'cluely-studio-state.json');
    this.state = this.loadInitialState();
    this.activeSessionId = this.state.currentSessionId || null;
    this.questionCursorTimestamp = Date.now() - 5000;
  }

  public getActiveSessionId(): string | null {
    return this.activeSessionId || this.state.currentSessionId || null;
  }

  public getQuestionCursorTimestamp(): number {
    return this.questionCursorTimestamp;
  }

  public setQuestionCursorTimestamp(ts: number): void {
    this.questionCursorTimestamp = ts;
  }

  public startSession(customTitle?: string): MeetingSession {
    const sessionId = `sess_${Date.now()}`;
    const newSession: MeetingSession = {
      id: sessionId,
      title: customTitle || `Meeting Session — ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      startTime: Date.now(),
      durationSeconds: 0,
      status: 'active',
      transcripts: [],
      assistEvents: [],
      notes: '',
      actionItems: [],
      keyDecisions: [],
    };
    this.activeSessionId = sessionId;
    this.questionCursorTimestamp = Date.now() - 1000;

    const currentPast = Array.isArray(this.state.pastSessions) ? this.state.pastSessions : [];
    const sessions = [newSession, ...currentPast.map((s) => (s.status === 'active' ? { ...s, status: 'completed' as const } : s))];
    this.patchState({
      isSessionActive: true,
      currentSessionId: sessionId,
      transcripts: [],
      pastSessions: sessions,
    });
    return newSession;
  }

  public stopSession(): MeetingSession | null {
    const currentId = this.getActiveSessionId();
    const sessions = [...(this.state.pastSessions || [])];
    const activeSession = sessions.find((s) => s.id === currentId);
    if (activeSession) {
      activeSession.status = 'completed';
      activeSession.endTime = Date.now();
      activeSession.durationSeconds = Math.max(1, Math.round((Date.now() - activeSession.startTime) / 1000));
    }
    this.patchState({
      isSessionActive: false,
      pastSessions: sessions,
    });
    return activeSession || null;
  }

  public deleteSession(sessionId: string): boolean {
    const sessions = (this.state.pastSessions || []).filter((s) => s.id !== sessionId);
    const nextCurrentId = this.state.currentSessionId === sessionId ? (sessions[0]?.id || null) : this.state.currentSessionId;
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = nextCurrentId;
    }
    this.patchState({
      pastSessions: sessions,
      currentSessionId: nextCurrentId,
    });
    return true;
  }

  public updateSessionNotes(
    sessionId: string,
    notes: string,
    title?: string,
    summary?: string,
    actionItems?: string[],
    keyDecisions?: string[]
  ): MeetingSession | null {
    const sessions = [...(this.state.pastSessions || [])];
    const idx = sessions.findIndex((s) => s.id === sessionId);
    if (idx === -1) return null;

    const updated: MeetingSession = {
      ...sessions[idx],
      notes,
      ...(title !== undefined ? { title } : {}),
      ...(summary !== undefined ? { summary } : {}),
      ...(actionItems !== undefined ? { actionItems } : {}),
      ...(keyDecisions !== undefined ? { keyDecisions } : {}),
    };
    sessions[idx] = updated;
    this.patchState({ pastSessions: sessions });
    return updated;
  }

  public ensureActiveSession(): MeetingSession {
    const sessions = [...(this.state.pastSessions || [])];
    let active = sessions.find((s) => s.id === this.getActiveSessionId());
    if (!active || active.status === 'completed') {
      active = {
        id: `sess_${Date.now()}`,
        title: `Meeting Session — ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        startTime: Date.now(),
        durationSeconds: 0,
        status: 'active',
        transcripts: [],
        assistEvents: [],
        notes: '',
        actionItems: [],
        keyDecisions: [],
      };
      sessions.unshift(active);
      this.activeSessionId = active.id;
      this.patchState({
        currentSessionId: active.id,
        pastSessions: sessions,
      });
    }
    return active;
  }

  public clearCurrentSessionChat(): void {
    const currentId = this.getActiveSessionId();
    const sessions = [...(this.state.pastSessions || [])];
    const activeSession = sessions.find((s) => s.id === currentId);
    if (activeSession) {
      activeSession.assistEvents = [];
    }
    this.questionCursorTimestamp = Date.now();
    this.patchState({
      transcripts: [],
      pastSessions: sessions,
    });
  }

  private loadInitialState(): AppState {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return this.mergeWithDefaults(parsed);
      }
    } catch (error) {
      console.error('[Store] Failed to load persisted state, using defaults:', error);
    }
    const initial = { ...DEFAULT_STATE };
    this.persistSync(initial);
    return initial;
  }

  private mergeWithDefaults(loaded: Partial<AppState>): AppState {
    const mergedShortcuts = {
      ...DEFAULT_SHORTCUTS,
      ...(loaded.shortcuts || {}),
    };

    const mergedNvidiaSpeech: NvidiaSpeechConfig = {
      ...DEFAULT_NVIDIA_SPEECH_CONFIG,
      ...(loaded.aiConfig?.nvidiaSpeech || {}),
    };

    const mergedAIConfig: AIProviderConfig = {
      ...DEFAULT_AI_CONFIG,
      ...(loaded.aiConfig || {}),
      embeddingModel: loaded.aiConfig?.embeddingModel || DEFAULT_AI_CONFIG.embeddingModel,
      apiKeys: {
        ...DEFAULT_AI_CONFIG.apiKeys,
        ...(loaded.aiConfig?.apiKeys || {}),
      },
      nvidiaSpeech: mergedNvidiaSpeech,
    };

    mergedAIConfig.activeProvider = 'ollama';
    if (!mergedAIConfig.activeModel) {
      mergedAIConfig.activeModel = 'gemma4:e4b';
    }

    if (
      !mergedAIConfig.voiceProvider ||
      (mergedAIConfig.voiceProvider as string) === 'gemini-native' ||
      (mergedAIConfig.voiceProvider as string) === 'groq-whisper' ||
      (mergedAIConfig.voiceProvider as string) === 'deepgram-nova3'
    ) {
      mergedAIConfig.voiceProvider = 'nvidia-parakeet-tdt';
    }

    // Merge modes and sanitize any legacy hardcoded NewsLens-AI prompt
    const existingModes = Array.isArray(loaded.modes) ? loaded.modes : [];
    const modeMap = new Map<string, CluelyMode>();
    for (const defaultMode of DEFAULT_MODES) {
      modeMap.set(defaultMode.id, defaultMode);
    }
    for (const mode of existingModes) {
      const def = modeMap.get(mode.id);
      const hasLegacyHallucination =
        mode.contextPrompt && mode.contextPrompt.includes('NewsLens-AI');
      if (def && (!mode.isCustom || hasLegacyHallucination)) {
        modeMap.set(mode.id, {
          ...def,
          files: Array.isArray(mode.files) ? mode.files : [],
        });
      } else {
        modeMap.set(mode.id, mode);
      }
    }

    // Filter out stale transcripts (> 2 hours old) from active overlay buffer
    const now = Date.now();
    const freshTranscripts = (Array.isArray(loaded.transcripts) ? loaded.transcripts : []).filter(
      (t) => t.timestamp && now - t.timestamp < 2 * 60 * 60 * 1000
    );

    // Strip out hardcoded mock sessions (sess_1..sess_7) so only real user sessions remain
    const realSessions = (Array.isArray(loaded.pastSessions) ? loaded.pastSessions : []).filter(
      (s) => s && s.id && !LEGACY_MOCK_SESSION_IDS.has(s.id)
    );

    return {
      undetectability: loaded.undetectability ?? DEFAULT_STATE.undetectability,
      overlayOpacity:
        typeof loaded.overlayOpacity === 'number'
          ? Math.max(0.2, Math.min(1.0, loaded.overlayOpacity))
          : DEFAULT_STATE.overlayOpacity,
      launchAtLogin: loaded.launchAtLogin ?? DEFAULT_STATE.launchAtLogin,
      transcriptionLanguage: loaded.transcriptionLanguage ?? DEFAULT_STATE.transcriptionLanguage,
      outputLanguage: loaded.outputLanguage ?? DEFAULT_STATE.outputLanguage,
      selectedMicDeviceId: loaded.selectedMicDeviceId ?? DEFAULT_STATE.selectedMicDeviceId,
      meetingEnvironment: loaded.meetingEnvironment ?? 'online',
      isSessionActive: true,
      isLiveScreenActive: false,
      selectedScreenSourceId: loaded.selectedScreenSourceId ?? DEFAULT_STATE.selectedScreenSourceId,
      isOverlayVisible: true,
      overlayExpanded: loaded.overlayExpanded ?? DEFAULT_STATE.overlayExpanded,
      overlayDrawerView: loaded.overlayDrawerView ?? DEFAULT_STATE.overlayDrawerView,
      activeModeId: loaded.activeModeId ?? DEFAULT_STATE.activeModeId,
      modes: Array.from(modeMap.values()),
      shortcuts: mergedShortcuts,
      aiConfig: mergedAIConfig,
      personalMemories: Array.isArray(loaded.personalMemories) ? loaded.personalMemories : [],
      voiceProfiles: Array.isArray(loaded.voiceProfiles) ? loaded.voiceProfiles : [],
      transcripts: freshTranscripts,
      pastSessions: realSessions,
      currentSessionId:
        loaded.currentSessionId && !LEGACY_MOCK_SESSION_IDS.has(loaded.currentSessionId)
          ? loaded.currentSessionId
          : realSessions[0]?.id || null,
    };
  }

  public recordAssistEvent(event: {
    userPrompt: string;
    aiResponse: string;
    modeName?: string;
    triggerSource?: 'typed' | 'voice';
  }): void {
    const activeSession = this.ensureActiveSession();
    const elapsedMs = Math.max(0, Date.now() - activeSession.startTime);
    const totalSec = Math.floor(elapsedMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const formattedOffset = `${mins}:${secs.toString().padStart(2, '0')}`;

    const newAssistEvent: SessionAssistEvent = {
      id: `assist_${Date.now()}`,
      timestamp: Date.now(),
      offsetSeconds: totalSec,
      formattedOffset,
      userPrompt: event.userPrompt,
      aiResponse: event.aiResponse,
      modeName: event.modeName,
      triggerSource: event.triggerSource,
    };

    activeSession.assistEvents.push(newAssistEvent);
    if (
      activeSession.title.startsWith('Meeting Session') &&
      event.userPrompt &&
      event.userPrompt !== 'Assist' &&
      event.userPrompt !== 'Live Spoken Question'
    ) {
      activeSession.title = event.userPrompt.slice(0, 48);
    }

    const sessions = [...(this.state.pastSessions || [])];
    const idx = sessions.findIndex((s) => s.id === activeSession.id);
    if (idx !== -1) {
      sessions[idx] = activeSession;
    } else {
      sessions.unshift(activeSession);
    }
    this.patchState({ pastSessions: sessions });
  }

  public addTranscriptSegment(segment: TranscriptSegment): void {
    if (segment.isPartial) return;
    const current = this.state.transcripts || [];
    const exists = current.some((s) => s.id === segment.id);
    if (!exists) {
      const updated = [segment, ...current].slice(0, 500);

      const sessions = [...(this.state.pastSessions || [])];
      let activeSession = sessions.find((s) => s.id === this.getActiveSessionId());
      if (!activeSession && this.state.isSessionActive) {
        activeSession = this.ensureActiveSession();
      }

      if (activeSession) {
        activeSession.transcripts.push(segment);
        activeSession.durationSeconds = Math.max(1, Math.round((Date.now() - activeSession.startTime) / 1000));
        if (
          activeSession.title.startsWith('Meeting Session') &&
          activeSession.transcripts.length >= 2
        ) {
          const firstSnippet = activeSession.transcripts[0].text.slice(0, 42).trim();
          if (firstSnippet.length > 6) {
            activeSession.title = `${firstSnippet}...`;
          }
        }
        const sIdx = sessions.findIndex((s) => s.id === activeSession.id);
        if (sIdx !== -1) {
          sessions[sIdx] = activeSession;
        }
      }

      this.patchState({
        transcripts: updated,
        pastSessions: sessions,
        currentSessionId: activeSession ? activeSession.id : this.state.currentSessionId,
      });

      try {
        const transcriptsDir = path.join(app.getPath('userData'), 'transcripts');
        if (!fs.existsSync(transcriptsDir)) {
          fs.mkdirSync(transcriptsDir, { recursive: true});
        }
        const todayStr = new Date().toISOString().slice(0, 10);
        const logFile = path.join(transcriptsDir, `transcript-${todayStr}.jsonl`);
        fs.appendFileSync(logFile, JSON.stringify(segment) + '\n', 'utf-8');
      } catch (err) {
        console.error('[Store] Failed to write transcript log:', err);
      }
    }
  }

  public getState(): AppState {
    return { ...this.state };
  }

  public patchState(delta: Partial<AppState>): AppState {
    const nextState: AppState = {
      ...this.state,
      ...delta,
      shortcuts: delta.shortcuts ? { ...this.state.shortcuts, ...delta.shortcuts } : this.state.shortcuts,
      aiConfig: delta.aiConfig
        ? {
            ...this.state.aiConfig,
            ...delta.aiConfig,
            apiKeys: delta.aiConfig.apiKeys
              ? { ...this.state.aiConfig.apiKeys, ...delta.aiConfig.apiKeys }
              : this.state.aiConfig.apiKeys,
            nvidiaSpeech: delta.aiConfig.nvidiaSpeech
              ? { ...this.state.aiConfig.nvidiaSpeech, ...delta.aiConfig.nvidiaSpeech }
              : this.state.aiConfig.nvidiaSpeech,
          }
        : this.state.aiConfig,
    };

    this.state = nextState;
    this.scheduleSave();
    this.notifyListeners();
    return this.getState();
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const currentState = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(currentState);
      } catch (err) {
        console.error('[Store] Error in state listener:', err);
      }
    }
  }

  private scheduleSave(): void {
    if (this.isSaving) {
      this.pendingSave = true;
      return;
    }
    this.isSaving = true;

    const dataToSave = JSON.stringify(this.state, null, 2);
    const tempFile = `${this.filePath}.tmp`;

    fs.promises
      .writeFile(tempFile, dataToSave, 'utf-8')
      .then(() => fs.promises.rename(tempFile, this.filePath))
      .catch((error) => {
        console.error('[Store] Atomic write failed:', error);
      })
      .finally(() => {
        this.isSaving = false;
        if (this.pendingSave) {
          this.pendingSave = false;
          this.scheduleSave();
        }
      });
  }

  private persistSync(stateToSave: AppState): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(stateToSave, null, 2), 'utf-8');
    } catch (error) {
      console.error('[Store] Initial synchronous write failed:', error);
    }
  }
}

export const store = new DomainStore();
