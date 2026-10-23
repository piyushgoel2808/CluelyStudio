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
  LocalModelStatus,
  MemoryItem,
  NvidiaConnectionTestResult,
  ScreenSourceInfo,
  ScreenCaptureResult,
  AudioStatusResult,
  TranscribePayload,
  TranscriptSegment,
} from '../src/types/ipc';

// Enforce single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    windowManager.showSettings();
  });
}

// Stealth metadata configuration
app.setName('Terminal ');
process.title = 'Terminal ';

// Chromium performance & quietness switches
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('no-pings');

// Register IPC handlers
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
  'window:move',
  async (_event, deltaX: number, deltaY: number): Promise<void> => {
    windowManager.moveOverlayBy(deltaX, deltaY);
  }
);

ipcMain.on('window:drag-move', (_event, { target, deltaX, deltaY }: { target: 'overlay' | 'settings'; deltaX: number; deltaY: number }) => {
  windowManager.moveWindowBy(target, deltaX, deltaY);
});

ipcMain.handle('session:start', async (): Promise<void> => {
  store.startSession();
  try {
    await audioEngine.start();
  } catch (err) {
    console.warn('[Main] audioEngine.start on session:start warning:', err);
  }
});

ipcMain.handle('session:stop', async (): Promise<void> => {
  store.stopSession();
  try {
    await audioEngine.stop();
  } catch (err) {
    console.warn('[Main] audioEngine.stop on session:stop warning:', err);
  }
});

ipcMain.handle('session:clear', async (): Promise<void> => {
  store.clearCurrentSessionChat();
});

ipcMain.handle('window:open-settings', async (_event, tab?: string): Promise<void> => {
  windowManager.showSettings(tab);
});

ipcMain.handle('window:toggle-overlay', async (): Promise<void> => {
  windowManager.toggleOverlayVisibility();
});

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
  store.patchState({ isSessionActive: true });
  return audioEngine.start();
});

ipcMain.handle('audio:stop', async (): Promise<AudioStatusResult> => {
  store.patchState({ isSessionActive: false });
  return audioEngine.stop();
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

// AI & Streaming Handlers
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
    return new Promise((resolve) => {
      let accumulated = '';
      const reqId = `q_${Date.now()}`;

      const handler = (_event: Electron.IpcMainEvent, chunk: { requestId: string; delta: string; done: boolean; error?: string }) => {
        if (chunk.requestId === reqId) {
          if (chunk.delta) accumulated += chunk.delta;
          if (chunk.done) {
            ipcMain.removeListener('ai:stream-chunk-internal' as unknown as string, handler as unknown as () => void);
            resolve(chunk.error ? `Error: ${chunk.error}` : accumulated);
          }
        }
      };

      aiRouter.streamPrompt({
        requestId: reqId,
        prompt,
        imageDataUrl: context?.imageBase64 ? `data:image/jpeg;base64,${context.imageBase64}` : undefined,
      }).catch((err) => {
        resolve(`Error: ${String(err)}`);
      });
    });
  }
);

// Mode File Ingestion Handlers
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

// Memory Brain Handlers
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

// Local Model Manager Handlers (Phase 4.5)
ipcMain.handle('models:list', async (): Promise<LocalModelStatus[]> => {
  return localModelManager.listLocalModels();
});

ipcMain.handle(
  'models:pull',
  async (_event, modelId: LocalModelStatus['id']): Promise<{ ok: boolean; message: string }> => {
    return localModelManager.pullLocalModel(modelId);
  }
);

ipcMain.handle(
  'models:start-server',
  async (): Promise<{ ok: boolean; port: number; message: string }> => {
    return localModelManager.startLocalServer();
  }
);

// iOS Companion Handlers (Phase 5)
ipcMain.handle(
  'companion:get-info',
  async (): Promise<CompanionServerInfo> => {
    return companionServer.getInfo();
  }
);

// App Lifecycle
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

  // React to session state changes (e.g. from global shortcut ⇧⌘\)
  store.subscribe((state) => {
    if (state.isSessionActive && !audioEngine.isRunning()) {
      audioEngine.start();
    } else if (!state.isSessionActive && audioEngine.isRunning()) {
      audioEngine.stop();
    }
  });
});

app.on('before-quit', () => {
  windowManager.setIsQuitting(true);
});

app.on('will-quit', () => {
  localModelManager.stopLocalServer();
  companionServer.stop();
  shortcutManager.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
