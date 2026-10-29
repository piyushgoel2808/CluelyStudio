/**
 * Cluely Studio - Canonical Data & IPC Contract
 * Unified TypeScript Definitions for Stealth HUD, Continuous Audio Pipeline, Vector DB & Fast Local Gemma 4 AI
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

export interface DocumentChunk {
  id: string;
  fileId: string;
  fileName: string;
  text: string;
  embedding?: number[];
}

export interface CluelyModeFile {
  id: string;
  name: string;
  path: string;
  size: number;
  extractedText: string;
  chunks?: DocumentChunk[];
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
  formattedTimestamp?: string;
  speakerColor?: string;
  isPartial?: boolean;
}

export interface MemoryItem {
  id: string;
  category: 'bio' | 'project' | 'preference' | 'meeting_fact' | 'person';
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  sourceMeetingId?: string;
  embedding?: number[];
  similarityScore?: number;
}

export interface VectorDBStats {
  totalMemories: number;
  indexedVectors: number;
  totalModeChunks: number;
  embeddingModel: string;
  dimensions: number;
  engineStatus: 'ollama-dense' | 'local-hybrid-384d';
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
  nimApiKey: string;
  nimEndpointUrl: string;
  localParakeetUrl: string;
  parakeetModelId: string;
  nemotronModelId: string;
  enableMultiTalker: boolean;
  handleCrossTalk: boolean;
  latencyProfile: NvidiaLatencyProfile;
}

export interface AIProviderConfig {
  activeProvider: 'ollama';
  activeModel: string;
  embeddingModel?: string;
  voiceProvider:
    | 'nvidia-parakeet-tdt'
    | 'whisper-base-onnx'
    | 'nvidia-hybrid'
    | 'nvidia-nemotron-nim';
  apiKeys: {
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
  notes?: string;
  actionItems?: string[];
  keyDecisions?: string[];
  status: 'active' | 'completed';
}

export interface AppState {
  undetectability: boolean;
  overlayOpacity: number;
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
  overlayDrawerView: 'none' | 'response' | 'history' | 'transcript' | 'live-screen' | 'notes';
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

export type LocalModelId =
  | 'gemma4-e4b-ollama'
  | 'gemma4-12b-ollama'
  | 'gemma2-embed-ollama'
  | 'nvidia-nemotron-ollama'
  | 'ollama-vision'
  | 'nvidia-parakeet-tdt-onnx'
  | 'whisper-base-onnx'
  | 'speaker-diarization-onnx';

export interface LocalModelStatus {
  id: LocalModelId;
  name: string;
  provider: 'ollama' | 'onnx-local';
  modelTag: string;
  role: 'llm-multimodal' | 'embedding' | 'asr' | 'diarization';
  installed: boolean;
  running: boolean;
  downloading: boolean;
  progressPercent: number;
  sizeLabel: string;
  statusMessage: string;
  error?: string;
}

export interface FineTuneExportResult {
  ok: boolean;
  datasetPath: string;
  modelfilePath: string;
  scriptPath: string;
  sampleCount: number;
  message: string;
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
  getState: () => Promise<AppState>;
  patchState: (delta: Partial<AppState>) => Promise<AppState>;
  onStateChange: (callback: (state: AppState) => void) => () => void;

  setOverlayHeight: (height: number) => Promise<void>;
  setOverlayOpacity?: (opacity: number) => Promise<void>;
  moveWindow: (deltaX: number, deltaY: number) => Promise<void>;
  dragWindowMove?: (target: 'overlay' | 'settings', deltaX: number, deltaY: number) => void;
  openSettings: (tab?: string) => Promise<void>;
  onSettingsNavigateTab?: (callback: (tab: string) => void) => () => void;
  toggleOverlay: () => Promise<void>;
  setUndetectability: (val: boolean) => Promise<void>;
  saveAIConfig: (config: AIProviderConfig) => Promise<void>;

  startSession?: () => Promise<void>;
  stopSession?: () => Promise<void>;
  clearSessionChat?: () => Promise<void>;
  deleteSession?: (sessionId: string) => Promise<boolean>;
  updateSessionNotes?: (sessionId: string, notes: string, title?: string) => Promise<MeetingSession | null>;
  generateSessionNotes?: (sessionId?: string) => Promise<MeetingSession | null>;

  onShortcut: (action: ShortcutAction, callback: () => void) => () => void;
  onShortcutScroll: (callback: (direction: 'up' | 'down') => void) => () => void;

  captureScreen: (sourceId?: string) => Promise<ScreenCaptureResult | null>;
  getScreenSources: () => Promise<ScreenSourceInfo[]>;

  startAudio: () => Promise<AudioStatusResult>;
  stopAudio: () => Promise<AudioStatusResult>;
  onAudioData: (callback: (data: { role: 'me' | 'them'; chunk: string }) => void) => () => void;
  onTranscriptSegment: (callback: (segment: TranscriptSegment) => void) => () => void;
  transcribeSegment: (payload: TranscribePayload) => Promise<TranscriptSegment | null>;
  onSystemAudioLevel: (callback: (data: { rms: number }) => void) => () => void;
  onSystemPcmChunk: (callback: (data: { pcmBase64: string; rms: number }) => void) => () => void;
  onUseDesktopAudioFallback: (callback: () => void) => () => void;

  testNvidiaConnection: () => Promise<NvidiaConnectionTestResult>;

  queryAI: (prompt: string, context?: { imageBase64?: string; transcript?: string }) => Promise<string>;
  askAIStream: (request: AIStreamRequest) => Promise<void>;
  cancelAIStream: (requestId: string) => Promise<void>;
  onAIStreamChunk: (callback: (chunk: AIStreamChunk) => void) => () => void;
  onAIChunk: (callback: (chunk: string) => void) => () => void;

  attachModeFiles: (modeId: string, files: Array<{ name: string; path?: string; base64Data?: string }>) => Promise<CluelyModeFile[]>;
  removeModeFile: (modeId: string, fileId: string) => Promise<boolean>;
  pickModeFiles: (modeId: string) => Promise<CluelyModeFile[]>;

  addMemory: (memory: Omit<MemoryItem, 'id' | 'createdAt'>) => Promise<MemoryItem>;
  updateMemory: (id: string, updates: Partial<MemoryItem>) => Promise<MemoryItem | null>;
  deleteMemory: (id: string) => Promise<boolean>;
  getMemories: () => Promise<MemoryItem[]>;
  searchMemories: (query: string) => Promise<MemoryItem[]>;
  extractMemoriesFromTranscript: (segments: TranscriptSegment[]) => Promise<MemoryItem[]>;
  getVectorDBStats?: () => Promise<VectorDBStats>;
  reindexVectorDB?: () => Promise<VectorDBStats>;

  listLocalModels: () => Promise<LocalModelStatus[]>;
  pullLocalModel: (modelId: LocalModelId) => Promise<{ ok: boolean; message: string }>;
  startLocalNvidiaServer: () => Promise<{ ok: boolean; port: number; message: string }>;
  onModelProgress: (cb: (status: LocalModelStatus) => void) => () => void;
  buildCustomGemmaModel?: (baseModel: 'gemma4:e4b' | 'gemma4:12b') => Promise<{ ok: boolean; modelName: string; message: string }>;
  exportFineTuneDataset?: (baseModel?: 'gemma4:e4b' | 'gemma4:12b') => Promise<FineTuneExportResult>;

  getCompanionInfo: () => Promise<CompanionServerInfo>;
}

declare global {
  interface Window {
    cluely: CluelyAPI;
  }
}
