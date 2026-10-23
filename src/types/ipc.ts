/**
 * Cluely Studio - Canonical Data & IPC Contract
 * Phase 1, 2, 3 & 4: Shared TypeScript Definitions
 */

export type ShortcutAction =
  | 'toggleVisibility'
  | 'askCluely'
  | 'newChat'
  | 'openSettings'
  | 'toggleSession'
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'scrollUp'
  | 'scrollDown';

export interface CluelyModeFile {
  id: string;
  name: string;
  path: string;
  size: number;
  extractedText: string;
  addedAt: number;
}

export interface CluelyMode {
  id: string;
  name: string;
  category: 'general' | 'work' | 'other';
  icon: string;
  contextPrompt: string;
  files: CluelyModeFile[];
  isCustom?: boolean;
}

export interface TranscriptSegment {
  id: string;
  speakerId: string;
  speakerLabel: string;
  role: 'me' | 'them';
  text: string;
  timestamp: number;
  confidence?: number;
  startTimeMs: number;
  endTimeMs: number;
  durationMs?: number;
  formattedTimestamp?: string; // e.g., "[00:16.64 - 00:28.16]"
  speakerColor?: string;       // "#22c55e" (Speaker-0/Me), "#38bdf8" (Speaker-1), "#a3a3a3" (Speaker-2), "#f43f5e" (Speaker-3)
  isPartial?: boolean;        // true during Nemotron live streaming, false once finalized by Parakeet-TDT
}

export interface MemoryItem {
  id: string;
  category: 'bio' | 'project' | 'preference' | 'meeting_fact' | 'person';
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  sourceMeetingId?: string;
}

export interface SpeakerVoiceProfile {
  id: string;
  name: string;
  isSelf: boolean;
  mfccCentroid: number[];
  pitchMeanHz: number;
  createdAt: number;
}

export type NvidiaLatencyProfile = 'ultra-low' | 'balanced' | 'high-accuracy';

export interface NvidiaSpeechConfig {
  nimApiKey: string;                    // NVIDIA Developer NIM API Key (nvapi-...)
  nimEndpointUrl: string;               // Default: 'https://integrate.api.nvidia.com/v1/audio/transcriptions'
  localParakeetUrl: string;             // Default: 'http://127.0.0.1:50051/v1/audio/transcriptions'
  parakeetModelId: string;              // Default: 'nvidia/parakeet-tdt-0.6b-v2'
  nemotronModelId: string;              // Default: 'nvidia/nemotron-speech-streaming-en-0.6b'
  enableMultiTalker: boolean;           // Default: true (Zero-shot 4-speaker stream separation)
  handleCrossTalk: boolean;             // Default: true (Parallel stream per voice on overlapping speech)
  latencyProfile: NvidiaLatencyProfile; // Default: 'balanced' ('ultra-low'=380ms, 'balanced'=650ms, 'high-accuracy'=1050ms)
}

export interface AIProviderConfig {
  activeProvider: 'gemini' | 'openai' | 'anthropic' | 'groq' | 'ollama';
  activeModel: string;
  voiceProvider:
    | 'nvidia-hybrid'
    | 'nvidia-parakeet-tdt'
    | 'whisper-base-onnx'
    | 'nvidia-nemotron-nim'
    | 'gemini-native'
    | 'groq-whisper'
    | 'deepgram-nova3';
  apiKeys: {
    gemini: string;
    openai: string;
    anthropic: string;
    groq: string;
    deepgram: string;
    ollamaUrl: string;
  };
  nvidiaSpeech: NvidiaSpeechConfig;
}

export interface SessionAssistEvent {
  id: string;
  timestamp: number;
  offsetSeconds: number;
  formattedOffset: string;
  userPrompt: string;
  aiResponse: string;
  modeId?: string;
  modeName?: string;
  triggerSource?: 'typed' | 'voice';
}

export interface MeetingSession {
  id: string;
  title: string;
  startTime: number;
  endTime?: number;
  durationSeconds: number;
  transcripts: TranscriptSegment[];
  assistEvents: SessionAssistEvent[];
  summary?: string;
  status: 'active' | 'completed';
}

export interface AppState {
  undetectability: boolean;
  launchAtLogin: boolean;
  transcriptionLanguage: string;
  outputLanguage: string;
  selectedMicDeviceId: string;
  meetingEnvironment: 'online' | 'offline';
  isSessionActive: boolean;
  isLiveScreenActive: boolean;
  selectedScreenSourceId: string | null;
  isOverlayVisible: boolean;
  overlayExpanded: boolean;
  overlayDrawerView: 'none' | 'response' | 'history' | 'transcript' | 'live-screen';
  activeModeId: string;
  modes: CluelyMode[];
  shortcuts: Record<ShortcutAction, string>;
  aiConfig: AIProviderConfig;
  personalMemories: MemoryItem[];
  voiceProfiles: SpeakerVoiceProfile[];
  transcripts: TranscriptSegment[];
  pastSessions: MeetingSession[];
  currentSessionId: string | null;
}

export interface ScreenSourceInfo {
  id: string;
  name: string;
  thumbnail: string;
  type?: 'screen' | 'window';
  thumbnailDataUrl?: string;
  appIconDataUrl?: string;
  displayId?: string;
}

export interface ScreenCaptureResult {
  data: string;
  mimeType: string;
  dataUrl?: string;
  width?: number;
  height?: number;
  sourceName?: string;
  timestamp?: number;
}

export interface AudioStatusResult {
  success: boolean;
  error?: string;
}

export interface TranscribePayload {
  wavBase64: string;
  role: 'me' | 'them';
  speakerId: string;
  speakerLabel: string;
  durationMs: number;
  startTimeMs?: number;
  endTimeMs?: number;
  formattedTimestamp?: string;
  speakerColor?: string;
  isPartial?: boolean;
}

export interface AIStreamRequest {
  requestId: string;
  prompt: string;
  imageDataUrl?: string | null;
  transcript?: TranscriptSegment[];
  modeId?: string;
  triggerSource?: 'typed' | 'voice';
}

export interface AIStreamChunk {
  requestId: string;
  delta: string;
  done: boolean;
  error?: string;
  usedMemories?: MemoryItem[];
  activeModeName?: string;
  modelUsed?: string;
}

export interface NvidiaConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  engine: 'local-parakeet' | 'nvidia-nim' | 'none';
  message: string;
}

export interface LocalModelStatus {
  id:
    | 'nvidia-nemotron-ollama'
    | 'nvidia-parakeet-tdt-onnx'
    | 'whisper-base-onnx'
    | 'speaker-diarization-onnx'
    | 'ollama-vision';
  name: string;
  provider: 'ollama' | 'onnx-local';
  modelTag: string;
  installed: boolean;
  running: boolean;
  downloading: boolean;
  progressPercent: number;
  sizeLabel: string;
  statusMessage: string;
  error?: string;
}

export interface CompanionServerInfo {
  running: boolean;
  port: number;
  lanIp: string;
  companionUrl: string;
  pairingPin: string;
  connectedClients: number;
}

export interface CluelyAPI {
  // State synchronization
  getState: () => Promise<AppState>;
  patchState: (delta: Partial<AppState>) => Promise<AppState>;
  onStateChange: (callback: (state: AppState) => void) => () => void;

  // Window control
  setOverlayHeight: (height: number) => Promise<void>;
  moveWindow: (deltaX: number, deltaY: number) => Promise<void>;
  openSettings: (tab?: string) => Promise<void>;
  onSettingsNavigateTab?: (callback: (tab: string) => void) => () => void;
  toggleOverlay: () => Promise<void>;
  setUndetectability: (val: boolean) => Promise<void>;
  saveAIConfig: (config: AIProviderConfig) => Promise<void>;

  // Shortcuts
  onShortcut: (action: ShortcutAction, callback: () => void) => () => void;
  onShortcutScroll: (callback: (direction: 'up' | 'down') => void) => () => void;

  // Screen capture & sources (Phase 2)
  captureScreen: (sourceId?: string) => Promise<ScreenCaptureResult | null>;
  getScreenSources: () => Promise<ScreenSourceInfo[]>;

  // Audio stream & sidecars (Phase 3)
  startAudio: () => Promise<AudioStatusResult>;
  stopAudio: () => Promise<AudioStatusResult>;
  onAudioData: (callback: (data: { role: 'me' | 'them'; chunk: string }) => void) => () => void;
  onTranscriptSegment: (callback: (segment: TranscriptSegment) => void) => () => void;
  transcribeSegment: (payload: TranscribePayload) => Promise<TranscriptSegment | null>;
  onSystemAudioLevel: (callback: (data: { rms: number }) => void) => () => void;
  onSystemPcmChunk: (callback: (data: { pcmBase64: string; rms: number }) => void) => () => void;
  onUseDesktopAudioFallback: (callback: () => void) => () => void;

  // Stage 1-3 NVIDIA Speech (Phase 4)
  testNvidiaConnection: () => Promise<NvidiaConnectionTestResult>;

  // AI & Streaming (Phase 4)
  queryAI: (prompt: string, context?: { imageBase64?: string; transcript?: string }) => Promise<string>;
  askAIStream: (request: AIStreamRequest) => Promise<void>;
  cancelAIStream: (requestId: string) => Promise<void>;
  onAIStreamChunk: (callback: (chunk: AIStreamChunk) => void) => () => void;
  onAIChunk: (callback: (chunk: string) => void) => () => void;

  // Modes File RAG Engine (Phase 4)
  attachModeFiles: (modeId: string, files: Array<{ name: string; path?: string; base64Data?: string }>) => Promise<CluelyModeFile[]>;
  removeModeFile: (modeId: string, fileId: string) => Promise<boolean>;
  pickModeFiles: (modeId: string) => Promise<CluelyModeFile[]>;

  // Personal Memory Brain (Phase 4)
  addMemory: (memory: Omit<MemoryItem, 'id' | 'createdAt'>) => Promise<MemoryItem>;
  updateMemory: (id: string, updates: Partial<MemoryItem>) => Promise<MemoryItem | null>;
  deleteMemory: (id: string) => Promise<boolean>;
  getMemories: () => Promise<MemoryItem[]>;
  searchMemories: (query: string) => Promise<MemoryItem[]>;
  extractMemoriesFromTranscript: (segments: TranscriptSegment[]) => Promise<MemoryItem[]>;

  // Local Open-Source NVIDIA & Ollama Models (Phase 4.5)
  listLocalModels: () => Promise<LocalModelStatus[]>;
  pullLocalModel: (modelId: LocalModelStatus['id']) => Promise<{ ok: boolean; message: string }>;
  startLocalNvidiaServer: () => Promise<{ ok: boolean; port: number; message: string }>;
  onModelProgress: (cb: (status: LocalModelStatus) => void) => () => void;

  // iOS Companion & Pocket Microphone (Phase 5)
  getCompanionInfo: () => Promise<CompanionServerInfo>;
}

declare global {
  interface Window {
    cluely: CluelyAPI;
  }
}
