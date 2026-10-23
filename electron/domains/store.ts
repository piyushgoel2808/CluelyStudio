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
  activeModel: 'nemotron-mini',
  voiceProvider: 'nvidia-parakeet-tdt',
  apiKeys: {
    gemini: '',
    openai: '',
    anthropic: '',
    groq: '',
    deepgram: '',
    ollamaUrl: 'http://127.0.0.1:11434',
  },
  nvidiaSpeech: DEFAULT_NVIDIA_SPEECH_CONFIG,
};

export const DEFAULT_MODES: CluelyMode[] = [
  {
    id: 'general',
    name: 'General',
    category: 'general',
    icon: 'compass',
    contextPrompt:
      'You are Cluely, a high-intelligence, concise copilot. Provide direct, actionable, accurate answers. Keep responses well-structured and brief.',
    files: [],
  },
  {
    id: 'interview',
    name: 'Interview',
    category: 'work',
    icon: 'briefcase',
    contextPrompt: `I am a candidate in a job interview. Help me perform well across behavioral, technical, product, role-fit, and follow-up questions.

Use the job description, resume, notes, and any attached files as ground truth when available. Do not fabricate experience, credentials, companies, numbers, or project details. If context is missing, give me an answer structure that I can quickly fill in.

For behavioral questions, help me choose a strong example and shape it with situation, task, action, and result. For technical or role-specific questions, explain the concept clearly, state tradeoffs, and answer at the right depth for an interview.

When the interviewer asks something vague, infer what they are evaluating and give me a direct answer that addresses that signal. Keep answers confident but not arrogant, polished but not robotic.

If I get stuck, help me recover: ask a clarifying question, state a reasonable assumption, think aloud, and move toward a useful answer. Also suggest thoughtful questions I can ask about the role, team, success criteria, product, and company.

Make responses concise enough to say out loud in the moment unless I explicitly ask for a deeper explanation.`,
    files: [],
  },
  {
    id: 'gen-ai',
    name: 'Gen AI',
    category: 'work',
    icon: 'sparkles',
    contextPrompt: `I am in a Gen AI interview. Answer every question authoritatively as the lead engineer and architect of NewsLens-AI.

PROJECT OVERVIEW (NewsLens-AI):
NewsLens-AI is an enterprise-grade Broadsheet Intelligence & Agentic RAG Platform that transforms scanned multi-column newspaper archives into structured, searchable intelligence with 2D spatial bounding box citations and cross-publication story trajectories.

EXACT CODEBASE FILE PATHS & RESPONSIBILITIES:
- Dual-Mode Neural Layout Parsing & OCR:
  * backend/app/ingestion/parsers/docling.py: IBM Docling with DocLayNet for 2D spatial layout segmentation. Supports local containerized Docling or IBM Cloud Docling SaaS API.
  * backend/app/ingestion/layout/segmenter.py: 2D spatial column sorting, multi-line headline coalescing, and inline byline extraction ('BY <NAME>') without column bleeding.
  * backend/app/ingestion/parsers/vlm.py: Qwen3-VL (qwen3-vl:latest) multimodal extraction isolating editorial photos, paired multi-column captions, and infographic data tables.
- Dual Collection Vector Storage & Database:
  * backend/app/storage/qdrant.py: Qdrant dual-collection architecture routing 768d Matryoshka MRL embeddings (gemini-embedding-001) to 'article_chunks_v2' and 1024d embeddings (BAAI/bge-m3) to 'article_chunks'.
  * backend/app/storage/mysql.py: MySQL 8 system of record with 17 normalized tables and FULLTEXT index for lexical matching.
  * backend/app/storage/minio.py: S3-compatible MinIO object storage storing 300 DPI page scans and cropped visual assets.
  * backend/app/storage/redis.py: Redis 7 caching narrative trajectories and distributed locks.
- Two-Stage Hybrid Retrieval & Reranking:
  * backend/app/retrieval/hybrid.py: Stage 1 Reciprocal Rank Fusion (RRF) combining Qdrant dense vector search with MySQL FULLTEXT sparse retrieval (candidates N=75).
  * backend/app/retrieval/reranker.py: Stage 2 Cross-Encoder neural reranking (cross-encoder/ms-marco-MiniLM-L-6-v2) with adaptive candidate pool capping (K=8..16) and macOS CPU optimization.
  * backend/app/retrieval/web.py: Multi-tier live internet search cascading across NewsData.io, Serper, and Tavily.
- Autonomous Agentic Reasoning (LangGraph & CRAG):
  * backend/app/agent/planner.py: Autonomous LangGraph dynamic query planner with Chain-of-Thought grounded in live schema metadata.
  * backend/app/agent/graph.py: LangGraph state machine with adaptive replanning and recovery nodes.
  * backend/app/agent/evaluator.py: Corrective RAG (CRAG) reflexive evaluator scoring retrieval confidence and diagnosing gaps.
  * backend/app/agent/tool_maker.py & backend/app/agent/sandbox.py: Dynamic Python/SQL tool synthesis audited by ToolCritic (5 dimensions: SASC, SRF, REH, DSF, RPS) executed in an isolated AST subprocess sandbox.
  * backend/app/agent/synthesizer.py: Compiles AnswerBlueprint into structured, citation-grounded editorial briefings.
- Evaluation, Hallucination Mitigations & Contamination:
  * backend/app/evaluation/metrics.py: Computes Recall@K, Precision@K, MRR, NDCG@K, Faithfulness, Citation Precision/Recall, and Multi-Newspaper Coverage F1.
  * backend/tests/test_cross_date_contamination.py: Strict anti-leakage suite preventing cross-turn date and publication context contamination.
  * backend/app/api/query.py: extract_active_issue_from_history() enforcing strict temporal filtering to prevent cutoff hallucinations on previous dates.
- Frontend Interactive Canvas:
  * frontend-v2/src/App.tsx & frontend/src/components/ModelSettingsStudio.jsx: React 18 + Vite SPA with 300 DPI scan reader, spatial bounding box pulse overlays, visual asset inspector, and hot-swappable model studio.

WHEN ANSWERING IN INTERVIEWS:
1. Always state the exact relative file path from the codebase when asked where a component lives.
2. Explain the architectural trade-offs: why dual Qdrant collections (MRL 768d vs 1024d), why two-stage RRF + Cross-Encoder reranking (sub-second latency vs full reranking), why IBM Docling + Qwen-VL (table understanding + multi-column broadsheet reading order).
3. If asked to perform something or solve a problem, give concrete step-by-step instructions.
4. When code is requested, provide clean, idiomatic Python or React/TypeScript code with meaningful variable names.
5. Keep answers short, sharp, and easy to speak out loud in an interview.`,
    files: [],
  },
  {
    id: 'behavioral-interview',
    name: 'Behavioral Interview',
    category: 'work',
    icon: 'user-check',
    contextPrompt:
      'I am in a behavioral interview. Help me answer questions in a confident, natural way that sounds like a real person speaking, not a scripted essay.\n\nUse the STAR structure when it helps: situation, task, action, result. Keep the answer focused on one specific story, make the action I personally took very clear, and tie the result back to the competency the interviewer is testing.\n\nIf my resume, job description, notes, or other files are attached, use them as the source of truth for my background. Do not invent credentials, employers, metrics, or projects that are not supported by context. If a detail is missing, give me a safe framework to fill in.',
    files: [],
  },
  {
    id: 'coding-interview',
    name: 'Coding Interview',
    category: 'work',
    icon: 'code',
    contextPrompt:
      'I am in a technical coding interview. Analyze any problem description, code editor, or terminal visible on my screen or discussed in audio. Provide: 1) A 2-sentence intuition of the optimal approach, 2) Exact Time & Space Complexity, 3) Clean, bug-free production code in the language shown on screen, and 4) Edge cases to mention aloud.',
    files: [],
  },
  {
    id: 'system-design',
    name: 'System Design',
    category: 'work',
    icon: 'layers',
    contextPrompt:
      'When the interviewer asks a broad question, identify the underlying signal first, such as ownership, conflict, ambiguity, leadership, failure, learning, collaboration, or impact. Then suggest a concise answer that directly addresses that signal.\n\nWhen I need a follow-up, help me ask thoughtful questions about expectations, team culture, success criteria, growth, and the role. Keep responses interview-ready, concise, and easy to say out loud.',
    files: [],
  },
  {
    id: 'case-interview',
    name: 'Case Interview',
    category: 'work',
    icon: 'trending-up',
    contextPrompt:
      'I am in a management consulting or business case interview. Help me break down ambiguous business problems into MECE (Mutually Exclusive, Collectively Exhaustive) frameworks. Provide quantitative sanity checks, hypothesis-driven structures, and strategic recommendations.',
    files: [],
  },
  {
    id: 'recruiter-screen',
    name: 'Recruiter Screen',
    category: 'work',
    icon: 'phone-call',
    contextPrompt:
      'I am on an initial recruiter phone screen. Help me articulate my compensation expectations, timeline, visa status, motivation for the role, and high-level background in an enthusiastic, professional, and crisp manner.',
    files: [],
  },
  {
    id: 'sales',
    name: 'Sales',
    category: 'work',
    icon: 'dollar-sign',
    contextPrompt:
      'I am leading or participating in a customer sales or discovery call. Help me handle objections smoothly, identify buyer pain points, ask high-leverage discovery questions, and present crisp value propositions matching customer needs.',
    files: [],
  },
  {
    id: 'team-meet',
    name: 'Team Meet',
    category: 'work',
    icon: 'users',
    contextPrompt:
      'I am in an internal team meeting or sync. Summarize discussion points, detect action items with owners, suggest constructive talking points, and clarify technical blockers.',
    files: [],
  },
  {
    id: 'lecture',
    name: 'Lecture',
    category: 'other',
    icon: 'book-open',
    contextPrompt:
      'I am attending a technical lecture or presentation. Capture core definitions, break down complex concepts into simple mental models, highlight key takeaways, and note potential follow-up questions.',
    files: [],
  },
  {
    id: 'recruiting',
    name: 'Recruiting',
    category: 'work',
    icon: 'user-plus',
    contextPrompt:
      'I am an interviewer conducting an interview with a candidate. Help me evaluate candidate responses against role competencies, suggest insightful follow-up questions to probe depth, and take structured evaluation notes.',
    files: [],
  },
];

export const DEFAULT_PAST_SESSIONS: MeetingSession[] = [
  {
    id: 'sess_1',
    title: 'Monday Follow-Up Review Call',
    startTime: new Date('2026-09-19T14:35:00').getTime(),
    endTime: new Date('2026-09-19T15:55:00').getTime(),
    durationSeconds: 4800,
    status: 'completed',
    transcripts: [
      { id: 't1', speakerId: 'me', speakerLabel: 'ME', role: 'me', text: 'Let’s walk through the architecture updates from this week.', startTimeMs: 2000, endTimeMs: 5000, timestamp: 1726738502000, formattedTimestamp: '[00:02 - 00:05]', speakerColor: '#22c55e' },
      { id: 't2', speakerId: 'them', speakerLabel: 'THEM', role: 'them', text: 'Sounds good, specifically how we optimized offline transcription.', startTimeMs: 6000, endTimeMs: 10000, timestamp: 1726738506000, formattedTimestamp: '[00:06 - 00:10]', speakerColor: '#38bdf8' },
    ],
    assistEvents: [
      {
        id: 'a1',
        timestamp: new Date('2026-09-19T14:40:00').getTime(),
        offsetSeconds: 5,
        formattedOffset: '0:05',
        userPrompt: 'What should I say?',
        aiResponse: '“We decoupled the audio capture from transcription using a ring buffer, dropping p95 latency down to 240ms on Apple Silicon.”',
        modeName: 'Interview',
      }
    ],
    summary: 'Reviewed offline transcription pipeline improvements and latency benchmarks.'
  },
  {
    id: 'sess_2',
    title: 'News Lens AI Demo',
    startTime: new Date('2026-09-16T11:02:00').getTime(),
    endTime: new Date('2026-09-16T11:59:00').getTime(),
    durationSeconds: 3420,
    status: 'completed',
    transcripts: [
      { id: 't3', speakerId: 'me', speakerLabel: 'ME', role: 'me', text: 'Here is the demonstration of NewsLens AI processing multimodal feeds.', startTimeMs: 2000, endTimeMs: 6000, timestamp: 1726466522000, formattedTimestamp: '[00:02 - 00:06]', speakerColor: '#22c55e' },
    ],
    assistEvents: [],
  },
  {
    id: 'sess_3',
    title: 'Brief Closing Remarks',
    startTime: new Date('2026-09-16T10:10:00').getTime(),
    endTime: new Date('2026-09-16T10:26:00').getTime(),
    durationSeconds: 960,
    status: 'completed',
    transcripts: [],
    assistEvents: [],
  },
  {
    id: 'sess_4',
    title: 'Untitled session',
    startTime: new Date('2026-09-15T20:49:00').getTime(),
    endTime: new Date('2026-09-15T21:11:00').getTime(),
    durationSeconds: 1320,
    status: 'completed',
    transcripts: [],
    assistEvents: [],
  },
  {
    id: 'sess_5',
    title: 'Planner and Executor Review',
    startTime: new Date('2026-09-15T20:23:00').getTime(),
    endTime: new Date('2026-09-15T20:38:00').getTime(),
    durationSeconds: 900,
    status: 'completed',
    transcripts: [],
    assistEvents: [],
  },
  {
    id: 'sess_6',
    title: 'NewsLens Retrieval & Chunking',
    startTime: new Date('2026-09-15T18:48:00').getTime(),
    endTime: new Date('2026-09-15T19:04:00').getTime(),
    durationSeconds: 960,
    status: 'completed',
    transcripts: [],
    assistEvents: [],
  },
  {
    id: 'sess_7',
    title: 'NewsLens Query Planner Overview',
    startTime: new Date('2026-09-12T16:46:00').getTime(),
    endTime: new Date('2026-09-12T19:11:00').getTime(),
    durationSeconds: 8700,
    status: 'completed',
    transcripts: [
      { id: 'u1', speakerId: 'me', speakerLabel: 'ME', role: 'me', text: 'I mean, I think it\'s a problem.', startTimeMs: 2000, endTimeMs: 4000, timestamp: 1726142162000, formattedTimestamp: '[00:02 - 00:04]', speakerColor: '#22c55e' },
      { id: 'u2', speakerId: 'me', speakerLabel: 'ME', role: 'me', text: 'and you can tell about hallucinations.', startTimeMs: 4000, endTimeMs: 7000, timestamp: 1726142164000, formattedTimestamp: '[00:04 - 00:07]', speakerColor: '#22c55e' },
      { id: 'u3', speakerId: 'me', speakerLabel: 'ME', role: 'me', text: 'Your project is again and again taking previous dates.', startTimeMs: 7000, endTimeMs: 10500, timestamp: 1726142167000, formattedTimestamp: '[00:07 - 00:10]', speakerColor: '#22c55e' },
      { id: 'u4', speakerId: 'me', speakerLabel: 'ME', role: 'me', text: 'So, how will you think you handle it?', startTimeMs: 11000, endTimeMs: 14000, timestamp: 1726142171000, formattedTimestamp: '[00:11 - 00:14]', speakerColor: '#22c55e' },
      { id: 'u5', speakerId: 'me', speakerLabel: 'ME', role: 'me', text: 'Thank you.', startTimeMs: 15000, endTimeMs: 17000, timestamp: 1726142175000, formattedTimestamp: '[00:15 - 00:17]', speakerColor: '#22c55e' },
      { id: 'u6', speakerId: 'me', speakerLabel: 'ME', role: 'me', text: 'Thank you.', startTimeMs: 24000, endTimeMs: 26000, timestamp: 1726142184000, formattedTimestamp: '[00:24 - 00:26]', speakerColor: '#22c55e' },
      { id: 'u7', speakerId: 'me', speakerLabel: 'ME', role: 'me', text: 'Thank you.', startTimeMs: 37000, endTimeMs: 39000, timestamp: 1726142197000, formattedTimestamp: '[00:37 - 00:39]', speakerColor: '#22c55e' },
      { id: 'u8', speakerId: 'me', speakerLabel: 'ME', role: 'me', text: 'Okay, and what other topics you are taking?', startTimeMs: 40000, endTimeMs: 43500, timestamp: 1726142200000, formattedTimestamp: '[00:40 - 00:43]', speakerColor: '#22c55e' },
    ],
    assistEvents: [
      {
        id: 'as1',
        timestamp: new Date('2026-09-12T16:47:00').getTime(),
        offsetSeconds: 14,
        formattedOffset: '0:14',
        userPrompt: 'How will you handle hallucinations and date drifting in NewsLens?',
        aiResponse: '“We handle date drifting by enforcing temporal metadata filters before hybrid BM25 and vector search, coupled with a cross-encoder reranker to verify factual grounding.”',
        modeName: 'Gen AI',
      }
    ],
    summary: 'Discussion regarding NewsLens query planning, hallucination mitigation, and temporal retrieval chunking.'
  }
];

export const DEFAULT_STATE: AppState = {
  undetectability: true,
  launchAtLogin: false,
  transcriptionLanguage: 'English (recommended)',
  outputLanguage: 'English',
  selectedMicDeviceId: 'default',
  meetingEnvironment: 'online',
  isSessionActive: true, // Default to true so live meeting audio capture and transcription start immediately
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
  pastSessions: DEFAULT_PAST_SESSIONS,
  currentSessionId: null,
};

type StateListener = (state: AppState) => void;

export class DomainStore {
  private state: AppState;
  private filePath: string;
  private listeners: Set<StateListener> = new Set();
  private isSaving: boolean = false;
  private pendingSave: boolean = false;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'cluely-studio-state.json');
    this.state = this.loadInitialState();
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
      apiKeys: {
        ...DEFAULT_AI_CONFIG.apiKeys,
        ...(loaded.aiConfig?.apiKeys || {}),
      },
      nvidiaSpeech: mergedNvidiaSpeech,
    };

    // Auto-fallback: if user has no Gemini/OpenAI key configured, default to local Ollama
    if (mergedAIConfig.activeProvider === 'gemini' && !mergedAIConfig.apiKeys.gemini) {
      mergedAIConfig.activeProvider = 'ollama';
      mergedAIConfig.activeModel = 'nemotron-mini';
    }

    // Auto-fallback: if user has no Cloud NIM key or Gemini key, default to local Parakeet-TDT (100% offline & fast)
    if (
      !mergedAIConfig.voiceProvider ||
      (mergedAIConfig.voiceProvider === 'nvidia-hybrid' && !mergedAIConfig.nvidiaSpeech.nimApiKey) ||
      (mergedAIConfig.voiceProvider === 'gemini-native' && !mergedAIConfig.apiKeys.gemini)
    ) {
      mergedAIConfig.voiceProvider = 'nvidia-parakeet-tdt';
    }

    // Ensure all default modes exist
    const existingModes = Array.isArray(loaded.modes) ? loaded.modes : [];
    const modeMap = new Map<string, CluelyMode>();
    for (const defaultMode of DEFAULT_MODES) {
      modeMap.set(defaultMode.id, defaultMode);
    }
    for (const mode of existingModes) {
      if (mode.id === 'interview' || mode.id === 'gen-ai') {
        const def = modeMap.get(mode.id);
        modeMap.set(mode.id, {
          ...mode,
          name: def?.name || mode.name,
          contextPrompt: def?.contextPrompt || mode.contextPrompt,
        });
      } else {
        modeMap.set(mode.id, mode);
      }
    }

    // Filter out stale transcripts from previous days to keep current session fresh
    const now = Date.now();
    const freshTranscripts = (Array.isArray(loaded.transcripts) ? loaded.transcripts : []).filter(
      (t) => t.timestamp && now - t.timestamp < 15 * 60 * 1000
    );

    return {
      undetectability: loaded.undetectability ?? DEFAULT_STATE.undetectability,
      launchAtLogin: loaded.launchAtLogin ?? DEFAULT_STATE.launchAtLogin,
      transcriptionLanguage: loaded.transcriptionLanguage ?? DEFAULT_STATE.transcriptionLanguage,
      outputLanguage: loaded.outputLanguage ?? DEFAULT_STATE.outputLanguage,
      selectedMicDeviceId: loaded.selectedMicDeviceId ?? DEFAULT_STATE.selectedMicDeviceId,
      meetingEnvironment: 'online', // Default to online so mic is accurately labeled Me and system is labeled Them
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
      pastSessions: Array.isArray(loaded.pastSessions) && loaded.pastSessions.length > 0 ? loaded.pastSessions : DEFAULT_PAST_SESSIONS,
      currentSessionId: loaded.currentSessionId ?? null,
    };
  }

  public recordAssistEvent(event: {
    userPrompt: string;
    aiResponse: string;
    modeName?: string;
    triggerSource?: 'typed' | 'voice';
  }): void {
    const sessions = [...(this.state.pastSessions || DEFAULT_PAST_SESSIONS)];
    let activeSession = sessions.find((s) => s.id === this.state.currentSessionId);

    if (!activeSession) {
      activeSession = {
        id: `sess_${Date.now()}`,
        title: 'Active Meeting Session',
        startTime: Date.now(),
        durationSeconds: 0,
        transcripts: [],
        assistEvents: [],
        status: 'active',
      };
      sessions.unshift(activeSession);
      this.patchState({ currentSessionId: activeSession.id });
    }

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
    this.patchState({ pastSessions: sessions });
  }

  public addTranscriptSegment(segment: TranscriptSegment): void {
    if (segment.isPartial) return; // Only store finalized speech segments
    const current = this.state.transcripts || [];
    const exists = current.some((s) => s.id === segment.id);
    if (!exists) {
      const updated = [segment, ...current].slice(0, 500);

      // Record to active meeting session
      const sessions = [...(this.state.pastSessions || DEFAULT_PAST_SESSIONS)];
      let activeSession = sessions.find((s) => s.id === this.state.currentSessionId);
      if (!activeSession && this.state.isSessionActive) {
        activeSession = {
          id: `sess_${Date.now()}`,
          title: 'Active Meeting Session',
          startTime: Date.now(),
          durationSeconds: 0,
          transcripts: [],
          assistEvents: [],
          status: 'active',
        };
        sessions.unshift(activeSession);
      }

      if (activeSession) {
        activeSession.transcripts.push(segment);
        activeSession.durationSeconds = Math.round((Date.now() - activeSession.startTime) / 1000);
        if (activeSession.title === 'Active Meeting Session' && activeSession.transcripts.length >= 2) {
          const firstSnippet = activeSession.transcripts[0].text.slice(0, 35);
          activeSession.title = firstSnippet ? `${firstSnippet}...` : 'Active Meeting Session';
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
          fs.mkdirSync(transcriptsDir, { recursive: true });
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

  private persistSync(data: AppState): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const dataString = JSON.stringify(data, null, 2);
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, dataString, 'utf-8');
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error('[Store] Synchronous initial persist failed:', err);
    }
  }
}

export const store = new DomainStore();
