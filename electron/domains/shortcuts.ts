import { globalShortcut } from 'electron';
import { store } from './store';
import { windowManager } from './windowManager';
import { ShortcutAction } from '../../src/types/ipc';

export class ShortcutManager {
  private registeredAccelerators: string[] = [];

  public registerAll(): void {
    this.unregisterAll();
    const shortcuts = store.getState().shortcuts;

    const actionHandlers: Record<ShortcutAction, () => void> = {
      toggleVisibility: () => {
        windowManager.toggleOverlayVisibility();
      },
      askCluely: () => {
        windowManager.sendToOverlay('shortcut:ask-cluely');
      },
      newChat: () => {
        store.clearCurrentSessionChat();
        windowManager.sendToOverlay('shortcut:new-chat');
      },
      openSettings: () => {
        windowManager.showSettings();
      },
      toggleSession: () => {
        const current = store.getState().isSessionActive;
        const next = !current;
        store.patchState({ isSessionActive: next });
        windowManager.sendToOverlay('shortcut:toggle-session', next);
      },
      moveUp: () => {
        windowManager.moveOverlayBy(0, -60);
      },
      moveDown: () => {
        windowManager.moveOverlayBy(0, 60);
      },
      moveLeft: () => {
        windowManager.moveOverlayBy(-60, 0);
      },
      moveRight: () => {
        windowManager.moveOverlayBy(60, 0);
      },
      scrollUp: () => {
        windowManager.sendToOverlay('shortcut:scroll', 'up');
      },
      scrollDown: () => {
        windowManager.sendToOverlay('shortcut:scroll', 'down');
      },
    };

    (Object.keys(actionHandlers) as ShortcutAction[]).forEach((action) => {
      const accelerator = shortcuts[action];
      if (accelerator && accelerator.trim().length > 0) {
        try {
          const registered = globalShortcut.register(accelerator, () => {
            actionHandlers[action]();
          });
          if (registered) {
            this.registeredAccelerators.push(accelerator);
          } else {
            console.warn(`[ShortcutManager] Failed to register accelerator: ${accelerator} for action: ${action}`);
          }
        } catch (error) {
          console.error(`[ShortcutManager] Error registering accelerator ${accelerator}:`, error);
        }
      }
    });
  }

  public unregisterAll(): void {
    try {
      globalShortcut.unregisterAll();
      this.registeredAccelerators = [];
    } catch (error) {
      console.error('[ShortcutManager] Error unregistering accelerators:', error);
    }
  }
}

export const shortcutManager = new ShortcutManager();
