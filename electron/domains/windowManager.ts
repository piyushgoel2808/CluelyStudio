import { app, BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { store } from './store';

export class WindowManager {
  private overlayWindow: BrowserWindow | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private isCapturingScreen: boolean = false;
  private isAppQuitting: boolean = false;

  constructor() {
    store.subscribe((state) => {
      this.applyContentProtection();
      this.broadcastToAllWindows('state:changed', state);
    });
  }

  public setIsQuitting(quitting: boolean): void {
    this.isAppQuitting = quitting;
  }

  public async initWindows(): Promise<void> {
    this.createOverlayWindow();
    this.createSettingsWindow();
  }

  public getOverlayWindow(): BrowserWindow | null {
    return this.overlayWindow;
  }

  public getSettingsWindow(): BrowserWindow | null {
    return this.settingsWindow;
  }

  private isDev(): boolean {
    return !app.isPackaged;
  }

  private getAppUrl(hashRoute: string): string {
    if (this.isDev()) {
      const devServer = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
      return `${devServer}/#${hashRoute}`;
    }
    const htmlPath = path.join(__dirname, '../dist/index.html');
    return `file://${htmlPath}#${hashRoute}`;
  }

  public createOverlayWindow(): BrowserWindow {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      return this.overlayWindow;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;
    const width = 640;
    const height = 280;
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    const y = Math.round(workArea.y + 48);

    const win = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      type: 'panel',
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    win.loadURL(this.getAppUrl('/overlay'));

    win.on('closed', () => {
      this.overlayWindow = null;
    });

    this.overlayWindow = win;
    this.applyContentProtection();

    const initialState = store.getState();
    if (!initialState.isOverlayVisible) {
      win.hide();
    }

    return win;
  }

  public createSettingsWindow(): BrowserWindow {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      return this.settingsWindow;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;
    const width = 960;
    const height = 680;
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    const y = Math.round(workArea.y + (workArea.height - height) / 2);

    const win = new BrowserWindow({
      width,
      height,
      minWidth: 860,
      minHeight: 600,
      x,
      y,
      title: 'Cluely Studio Settings',
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#0d0d0f',
      show: false,
      movable: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    win.loadURL(this.getAppUrl('/settings'));

    // Prevent destruction on close; hide window instead for instantaneous re-opening
    win.on('close', (event) => {
      if (!this.isAppQuitting) {
        event.preventDefault();
        win.hide();
      }
    });

    win.on('closed', () => {
      this.settingsWindow = null;
    });

    this.settingsWindow = win;
    this.applyContentProtection();

    return win;
  }

  public applyContentProtection(isCapturing: boolean = this.isCapturingScreen): void {
    this.isCapturingScreen = isCapturing;
    const state = store.getState();
    const protect = Boolean(state.undetectability || this.isCapturingScreen);

    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      try {
        this.overlayWindow.setContentProtection(protect);
      } catch (err) {
        console.error('[WindowManager] Failed to set content protection on overlay:', err);
      }
    }

    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      try {
        this.settingsWindow.setContentProtection(protect);
      } catch (err) {
        console.error('[WindowManager] Failed to set content protection on settings:', err);
      }
    }
  }

  public setOverlayHeight(height: number): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
    const bounds = this.overlayWindow.getBounds();
    const targetHeight = Math.max(60, Math.min(Math.round(height), 850));
    if (bounds.height === targetHeight) return;

    this.overlayWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: targetHeight,
    });
  }

  public moveWindowBy(target: 'overlay' | 'settings', deltaX: number, deltaY: number): void {
    const win = target === 'overlay' ? this.overlayWindow : this.settingsWindow;
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    win.setPosition(Math.round(x + deltaX), Math.round(y + deltaY), false);
  }

  public moveOverlayBy(deltaX: number, deltaY: number): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
    const bounds = this.overlayWindow.getBounds();
    const currentDisplay = screen.getDisplayMatching(bounds);
    const workArea = currentDisplay.workArea;

    let targetX = bounds.x + deltaX;
    let targetY = bounds.y + deltaY;

    // Clamping bounds to active workArea
    const minX = workArea.x;
    const maxX = workArea.x + workArea.width - bounds.width;
    const minY = workArea.y;
    const maxY = workArea.y + workArea.height - bounds.height;

    targetX = Math.max(minX, Math.min(targetX, maxX));
    targetY = Math.max(minY, Math.min(targetY, maxY));

    this.overlayWindow.setBounds({
      x: Math.round(targetX),
      y: Math.round(targetY),
      width: bounds.width,
      height: bounds.height,
    });
  }

  public toggleOverlayVisibility(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) {
      this.createOverlayWindow();
      store.patchState({ isOverlayVisible: true });
      return;
    }

    if (this.overlayWindow.isVisible()) {
      this.overlayWindow.hide();
      store.patchState({ isOverlayVisible: false });
    } else {
      this.overlayWindow.showInactive();
      store.patchState({ isOverlayVisible: true });
    }
  }

  public showSettings(tab?: string): void {
    if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
      this.createSettingsWindow();
    }
    if (this.settingsWindow) {
      if (tab) {
        this.settingsWindow.webContents.send('settings:navigate-tab', tab);
      }
      this.settingsWindow.show();
      this.settingsWindow.focus();
      this.settingsWindow.moveTop();
      // Temporarily elevate level so it cleanly pops over the screen-saver level HUD overlay
      try {
        this.settingsWindow.setAlwaysOnTop(true, 'floating');
        setTimeout(() => {
          if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            this.settingsWindow.setAlwaysOnTop(false);
            this.settingsWindow.focus();
          }
        }, 400);
      } catch {
        // ignore
      }
    }
  }

  public broadcastToAllWindows(channel: string, ...args: unknown[]): void {
    const windows = [this.overlayWindow, this.settingsWindow];
    for (const win of windows) {
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    }
  }

  public sendToOverlay(channel: string, ...args: unknown[]): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send(channel, ...args);
    }
  }
}

export const windowManager = new WindowManager();
