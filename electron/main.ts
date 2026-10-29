import { app, ipcMain, desktopCapturer, session } from 'electron';
import { store } from './domains/store';
import { windowManager } from './domains/windowManager';
import { shortcutManager } from './domains/shortcuts';
import { screenCaptureService } from './domains/screenCapture';
import { audioEngine } from './domains/audioEngine';
import { transcriptionService } from './domains/transcriptionService';
import { fileParser } from './domains/fileParser';
import { memoryBrain } from './domains/memoryBrain';
import { aiRouter } from './domains/aiRouter';
import { localModelManager } from './domains/localModelManager';
import { companionServer } from './domains/companionServer';
import {
  AIStreamRequest,
  AppState,
  CluelyModeFile,
  CompanionServerInfo,
  FineTuneExportResult,
  LocalModelId,
  LocalModelStatus,
  MeetingSession,
  MemoryItem,
  NvidiaConnectionTestResult,
  ScreenSourceInfo,
  ScreenCaptureResult,
  AudioStatusResult,
  TranscribePayload,
  TranscriptSegment,
  VectorDBStats,
} from '../src/types/ipc';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    windowManager.showSettings();
  });
}

app.setName('Terminal ');
process.title = 'Terminal ';

app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('no-pings');

ipcMain.handle('state:get', async (): Promise<AppState> => {
  return store.getState();
});

ipcMain.handle(
  'state:patch',
  async (_event, delta: Partial<AppState>): Promise<AppState> => {
    const updated = store.patchState(delta);
    if (delta.shortcuts) {
      shortcutManager.registerAll();
    }
    if (typeof delta.overlayOpacity === 'number') {
      windowManager.applyWindowOpacity(delta.overlayOpacity);
    }
    return updated;
  }
);

ipcMain.handle(
  'window:set-overlay-height',
  async (_event, height: number): Promise<void> => {
    windowManager.setOverlayHeight(height);
  }
);

ipcMain.handle(
  'window:set-opacity',
  async (_event, opacity: number): Promise<void> => {
    const clamped = Math.max(0.2, Math.min(1.0, opacity));
    windowManager.applyWindowOpacity(clamped);
    store.patchState({ overlayOpacity: clamped });
  }
);

ipcMain.handle(
  'window:move',
  async (_event, deltaX: number, deltaY: number): Promise<void> => {
    windowManager.moveOverlayBy(deltaX, deltaY);
  }
);

ipcMain.on(
  'window:drag-move',
  (_event, { target, deltaX, deltaY }: { target: 'overlay' | 'settings'; deltaX: number; deltaY: number }) => {
    windowManager.moveWindowBy(target, deltaX, deltaY);
  }
);

ipcMain.handle('window:open-settings', async (_event, tab?: string): Promise<void> => {
  windowManager.showSettings(tab);
});

ipcMain.handle('window:toggle-overlay', async (): Promise<void> => {
  windowManager.toggleOverlayVisibility();
});

// Session Lifecycle: Note that audioEngine stays running 100% of the time so Mic & System Audio
// are continuously captured even when session timer is toggled off or while answering!
ipcMain.handle('session:start', async (): Promise<void> => {
  store.startSession();
  if (!audioEngine.isRunning()) {
    try {
      audioEngine.start();
    } catch (err) {
      console.warn('[Main] audioEngine.start warning:', err);
    }
  }
});

ipcMain.handle('session:stop', async (): Promise<void> => {
  const stopped = store.stopSession();
  // Keep audioEngine running continuously in background so voice is always ready!
  if (!audioEngine.isRunning()) {
    try {
      audioEngine.start();
    } catch {}
  }
  if (stopped && (stopped.transcripts.length > 0 || stopped.assistEvents.length > 0)) {
    memoryBrain.generateSessionNotes(stopped.id).catch((err) => {
      console.warn('[Main] Auto session notes generation warning:', err);
    });
  }
});

ipcMain.handle('session:clear', async (): Promise<void> => {
  store.clearCurrentSessionChat();
});

ipcMain.handle('session:delete', async (_event, sessionId: string): Promise<boolean> => {
  return store.deleteSession(sessionId);
});

ipcMain.handle(
  'session:update-notes',
  async (
    _event,
    sessionId: string,
    notes: string,
    title?: string
  ): Promise<MeetingSession | null> => {
    return store.updateSessionNotes(sessionId, notes, title);
  }
);

ipcMain.handle(
  'session:generate-notes',
  async (_event, sessionId?: string): Promise<MeetingSession | null> => {
    return memoryBrain.generateSessionNotes(sessionId);
  }
);

ipcMain.handle('screen:get-sources', async (): Promise<ScreenSourceInfo[]> => {
  return screenCaptureService.listScreenSources();
});

ipcMain.handle(
  'screen:capture',
  async (_event, sourceId?: string): Promise<ScreenCaptureResult | null> => {
    return screenCaptureService.captureSelfExcludedSnapshot(sourceId);
  }
);

ipcMain.handle('audio:start', async (): Promise<AudioStatusResult> => {
  return audioEngine.start();
});

ipcMain.handle('audio:stop', async (): Promise<AudioStatusResult> => {
  // Keep background system audio tap active so continuous listening never drops
  return { success: true };
});

ipcMain.handle(
  'audio:transcribe-segment',
  async (_event, payload: TranscribePayload): Promise<TranscriptSegment | null> => {
    return transcriptionService.transcribeSegment(payload);
  }
);

ipcMain.handle(
  'audio:test-nvidia-connection',
  async (): Promise<NvidiaConnectionTestResult> => {
    return transcriptionService.testNvidiaConnection();
  }
);

ipcMain.handle(
  'ai:ask-stream',
  async (_event, request: AIStreamRequest): Promise<void> => {
    return aiRouter.streamPrompt(request);
  }
);

ipcMain.handle(
  'ai:cancel-stream',
  async (_event, requestId: string): Promise<void> => {
    aiRouter.cancelStream(requestId);
  }
);

ipcMain.handle(
  'ai:query',
  async (_event, prompt: string, context?: { imageBase64?: string; transcript?: string }): Promise<string> => {
    const reqId = `q_${Date.now()}`;
    await aiRouter.streamPrompt({
      requestId: reqId,
      prompt,
      imageDataUrl: context?.imageBase64 ? `data:image/jpeg;base64,${context.imageBase64}` : undefined,
    });
    const active = store.ensureActiveSession();
    const latest = active.assistEvents[active.assistEvents.length - 1];
    return latest?.aiResponse || '';
  }
);

ipcMain.handle(
  'modes:attach-files',
  async (
    _event,
    modeId: string,
    files: Array<{ name: string; path?: string; base64Data?: string }>
  ): Promise<CluelyModeFile[]> => {
    return fileParser.attachFilesToMode(modeId, files);
  }
);

ipcMain.handle(
  'modes:remove-file',
  async (_event, modeId: string, fileId: string): Promise<boolean> => {
    return fileParser.removeFileFromMode(modeId, fileId);
  }
);

ipcMain.handle(
  'modes:pick-files',
  async (_event, modeId: string): Promise<CluelyModeFile[]> => {
    return fileParser.pickFilesDialog(modeId);
  }
);

ipcMain.handle(
  'memory:add',
  async (
    _event,
    memoryInput: Omit<MemoryItem, 'id' | 'createdAt'>
  ): Promise<MemoryItem> => {
    return memoryBrain.addMemory(memoryInput);
  }
);

ipcMain.handle(
  'memory:update',
  async (
    _event,
    id: string,
    updates: Partial<MemoryItem>
  ): Promise<MemoryItem | null> => {
    return memoryBrain.updateMemory(id, updates);
  }
);

ipcMain.handle(
  'memory:delete',
  async (_event, id: string): Promise<boolean> => {
    return memoryBrain.deleteMemory(id);
  }
);

ipcMain.handle('memory:get', async (): Promise<MemoryItem[]> => {
  return memoryBrain.getMemories();
});

ipcMain.handle(
  'memory:search',
  async (_event, query: string): Promise<MemoryItem[]> => {
    return memoryBrain.searchMemories(query);
  }
);

ipcMain.handle(
  'memory:extract-from-transcript',
  async (_event, segments: TranscriptSegment[]): Promise<MemoryItem[]> => {
    return memoryBrain.extractMemoriesFromTranscript(segments);
  }
);

ipcMain.handle('memory:vector-stats', async (): Promise<VectorDBStats> => {
  return memoryBrain.getVectorDBStats();
});

ipcMain.handle('memory:reindex', async (): Promise<VectorDBStats> => {
  return memoryBrain.reindexAll();
});

ipcMain.handle('models:list', async (): Promise<LocalModelStatus[]> => {
  return localModelManager.listLocalModels();
});

ipcMain.handle(
  'models:pull',
  async (_event, modelId: LocalModelId): Promise<{ ok: boolean; message: string }> => {
    return localModelManager.pullLocalModel(modelId);
  }
);

ipcMain.handle(
  'models:start-server',
  async (): Promise<{ ok: boolean; port: number; message: string }> => {
    return localModelManager.startLocalServer();
  }
);

ipcMain.handle(
  'models:build-custom-gemma',
  async (
    _event,
    baseModel: 'gemma4:e4b' | 'gemma4:12b'
  ): Promise<{ ok: boolean; modelName: string; message: string }> => {
    return localModelManager.buildCustomGemmaModel(baseModel);
  }
);

ipcMain.handle(
  'models:export-finetune-dataset',
  async (
    _event,
    baseModel?: 'gemma4:e4b' | 'gemma4:12b'
  ): Promise<FineTuneExportResult> => {
    return localModelManager.exportFineTuneDataset(baseModel);
  }
);

ipcMain.handle(
  'companion:get-info',
  async (): Promise<CompanionServerInfo> => {
    return companionServer.getInfo();
  }
);

app.whenReady().then(async () => {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      const activeSourceId = store.getState().selectedScreenSourceId;
      const target = sources.find((s) => s.id === activeSourceId) || sources[0];
      if (target) {
        callback({
          video: target,
          audio: process.platform === 'win32' ? 'loopback' : undefined,
        });
      } else {
        callback({});
      }
    });
  });

  await localModelManager.startLocalServer();
  await localModelManager.checkOllamaStatus();
  await companionServer.start();
  await windowManager.initWindows();
  shortcutManager.registerAll();

  // Immediately start system audio loopback capture on startup so both Mic & System Audio are always live!
  audioEngine.start();

  // Pre-warm active local LLM in background so first answer takes 2-3s with zero cold-start!
  aiRouter.prewarmLocalModel().catch(() => {});
});

app.on('before-quit', () => {
  windowManager.setIsQuitting(true);
});

app.on('will-quit', () => {
  audioEngine.stop();
  localModelManager.stopLocalServer();
  companionServer.stop();
  shortcutManager.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
