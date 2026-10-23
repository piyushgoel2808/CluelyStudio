import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import {
  AIStreamChunk,
  AIStreamRequest,
  AppState,
  CluelyAPI,
  CluelyModeFile,
  CompanionServerInfo,
  LocalModelStatus,
  MemoryItem,
  NvidiaConnectionTestResult,
  ShortcutAction,
  TranscriptSegment,
} from '../src/types/ipc';

const api: CluelyAPI = {
  getState: () => ipcRenderer.invoke('state:get'),

  patchState: (delta: Partial<AppState>) =>
    ipcRenderer.invoke('state:patch', delta),

  onStateChange: (callback: (state: AppState) => void) => {
    const handler = (_event: IpcRendererEvent, state: AppState) => callback(state);
    ipcRenderer.on('state:changed', handler);
    return () => {
      ipcRenderer.removeListener('state:changed', handler);
    };
  },

  setOverlayHeight: (height: number) =>
    ipcRenderer.invoke('window:set-overlay-height', height),

  moveWindow: (deltaX: number, deltaY: number) =>
    ipcRenderer.invoke('window:move', deltaX, deltaY),

  openSettings: (tab?: string) => ipcRenderer.invoke('window:open-settings', tab),

  onSettingsNavigateTab: (callback: (tab: string) => void) => {
    const handler = (_event: IpcRendererEvent, tab: string) => callback(tab);
    ipcRenderer.on('settings:navigate-tab', handler);
    return () => {
      ipcRenderer.removeListener('settings:navigate-tab', handler);
    };
  },

  toggleOverlay: () => ipcRenderer.invoke('window:toggle-overlay'),

  setUndetectability: (val: boolean) =>
    ipcRenderer.invoke('state:patch', { undetectability: val }),

  saveAIConfig: (config) =>
    ipcRenderer.invoke('state:patch', { aiConfig: config }),

  onShortcut: (action: ShortcutAction, callback: () => void) => {
    const channelMap: Partial<Record<ShortcutAction, string>> = {
      askCluely: 'shortcut:ask-cluely',
      newChat: 'shortcut:new-chat',
      toggleSession: 'shortcut:toggle-session',
    };
    const channel = channelMap[action] || `shortcut:${action}`;
    const handler = () => callback();
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },

  onShortcutScroll: (callback: (direction: 'up' | 'down') => void) => {
    const handler = (_event: IpcRendererEvent, direction: 'up' | 'down') =>
      callback(direction);
    ipcRenderer.on('shortcut:scroll', handler);
    return () => {
      ipcRenderer.removeListener('shortcut:scroll', handler);
    };
  },

  captureScreen: (sourceId?: string) => ipcRenderer.invoke('screen:capture', sourceId),

  getScreenSources: () => ipcRenderer.invoke('screen:get-sources'),

  startAudio: () => ipcRenderer.invoke('audio:start'),

  stopAudio: () => ipcRenderer.invoke('audio:stop'),

  onAudioData: (callback: (data: { role: 'me' | 'them'; chunk: string }) => void) => {
    const handler = (
      _event: IpcRendererEvent,
      data: { role: 'me' | 'them'; chunk: string }
    ) => callback(data);
    ipcRenderer.on('audio:data', handler);
    return () => {
      ipcRenderer.removeListener('audio:data', handler);
    };
  },

  onTranscriptSegment: (callback: (segment: TranscriptSegment) => void) => {
    const handler = (_event: IpcRendererEvent, segment: TranscriptSegment) =>
      callback(segment);
    ipcRenderer.on('audio:transcript-segment', handler);
    return () => {
      ipcRenderer.removeListener('audio:transcript-segment', handler);
    };
  },

  transcribeSegment: (payload) =>
    ipcRenderer.invoke('audio:transcribe-segment', payload),

  onSystemAudioLevel: (callback: (data: { rms: number }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { rms: number }) =>
      callback(data);
    ipcRenderer.on('audio:system-level', handler);
    return () => {
      ipcRenderer.removeListener('audio:system-level', handler);
    };
  },

  onSystemPcmChunk: (callback: (data: { pcmBase64: string; rms: number }) => void) => {
    const handler = (
      _event: IpcRendererEvent,
      data: { pcmBase64: string; rms: number }
    ) => callback(data);
    ipcRenderer.on('audio:system-pcm-chunk', handler);
    return () => {
      ipcRenderer.removeListener('audio:system-pcm-chunk', handler);
    };
  },

  onUseDesktopAudioFallback: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('audio:use-desktop-audio-fallback', handler);
    return () => {
      ipcRenderer.removeListener('audio:use-desktop-audio-fallback', handler);
    };
  },

  testNvidiaConnection: (): Promise<NvidiaConnectionTestResult> =>
    ipcRenderer.invoke('audio:test-nvidia-connection'),

  queryAI: (prompt: string, context?: { imageBase64?: string; transcript?: string }) =>
    ipcRenderer.invoke('ai:query', prompt, context),

  askAIStream: (request: AIStreamRequest): Promise<void> =>
    ipcRenderer.invoke('ai:ask-stream', request),

  cancelAIStream: (requestId: string): Promise<void> =>
    ipcRenderer.invoke('ai:cancel-stream', requestId),

  onAIStreamChunk: (callback: (chunk: AIStreamChunk) => void) => {
    const handler = (_event: IpcRendererEvent, chunk: AIStreamChunk) => callback(chunk);
    ipcRenderer.on('ai:stream-chunk', handler);
    return () => {
      ipcRenderer.removeListener('ai:stream-chunk', handler);
    };
  },

  onAIChunk: (callback: (chunk: string) => void) => {
    const handler = (_event: IpcRendererEvent, chunk: string) => callback(chunk);
    ipcRenderer.on('ai:chunk', handler);
    return () => {
      ipcRenderer.removeListener('ai:chunk', handler);
    };
  },

  attachModeFiles: (
    modeId: string,
    files: Array<{ name: string; path?: string; base64Data?: string }>
  ): Promise<CluelyModeFile[]> =>
    ipcRenderer.invoke('modes:attach-files', modeId, files),

  removeModeFile: (modeId: string, fileId: string): Promise<boolean> =>
    ipcRenderer.invoke('modes:remove-file', modeId, fileId),

  pickModeFiles: (modeId: string): Promise<CluelyModeFile[]> =>
    ipcRenderer.invoke('modes:pick-files', modeId),

  addMemory: (memory: Omit<MemoryItem, 'id' | 'createdAt'>): Promise<MemoryItem> =>
    ipcRenderer.invoke('memory:add', memory),

  updateMemory: (id: string, updates: Partial<MemoryItem>): Promise<MemoryItem | null> =>
    ipcRenderer.invoke('memory:update', id, updates),

  deleteMemory: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('memory:delete', id),

  getMemories: (): Promise<MemoryItem[]> => ipcRenderer.invoke('memory:get'),

  searchMemories: (query: string): Promise<MemoryItem[]> =>
    ipcRenderer.invoke('memory:search', query),

  extractMemoriesFromTranscript: (
    segments: TranscriptSegment[]
  ): Promise<MemoryItem[]> =>
    ipcRenderer.invoke('memory:extract-from-transcript', segments),

  // Local Open-Source NVIDIA & Ollama Models (Phase 4.5)
  listLocalModels: (): Promise<LocalModelStatus[]> =>
    ipcRenderer.invoke('models:list'),

  pullLocalModel: (
    modelId: LocalModelStatus['id']
  ): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('models:pull', modelId),

  startLocalNvidiaServer: (): Promise<{ ok: boolean; port: number; message: string }> =>
    ipcRenderer.invoke('models:start-server'),

  onModelProgress: (callback: (status: LocalModelStatus) => void) => {
    const handler = (_event: IpcRendererEvent, status: LocalModelStatus) => callback(status);
    ipcRenderer.on('models:progress', handler);
    return () => {
      ipcRenderer.removeListener('models:progress', handler);
    };
  },

  // iOS Companion & Pocket Microphone (Phase 5)
  getCompanionInfo: (): Promise<CompanionServerInfo> =>
    ipcRenderer.invoke('companion:get-info'),
};

contextBridge.exposeInMainWorld('cluely', api);
