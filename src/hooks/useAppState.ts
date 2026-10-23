import { useState, useEffect, useCallback } from 'react';
import { AppState, CluelyMode } from '../types/ipc';

export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);

  useEffect(() => {
    let isMounted = true;

    if (window.cluely && window.cluely.getState) {
      window.cluely.getState().then((initial) => {
        if (isMounted) {
          setState(initial);
        }
      });

      const unsubscribe = window.cluely.onStateChange((updated) => {
        if (isMounted) {
          setState(updated);
        }
      });

      return () => {
        isMounted = false;
        unsubscribe();
      };
    }
    return () => {
      isMounted = false;
    };
  }, []);

  const patchState = useCallback((delta: Partial<AppState>) => {
    if (window.cluely && window.cluely.patchState) {
      return window.cluely.patchState(delta).then((updated) => {
        setState(updated);
        return updated;
      });
    }
    return Promise.resolve(null);
  }, []);

  const activeMode: CluelyMode | undefined =
    state?.modes.find((m) => m.id === state.activeModeId) || state?.modes[0];

  const setActiveMode = useCallback(
    (modeId: string) => {
      return patchState({ activeModeId: modeId });
    },
    [patchState]
  );

  const toggleSession = useCallback(() => {
    if (!state) return;
    return patchState({ isSessionActive: !state.isSessionActive });
  }, [state, patchState]);

  const setDrawer = useCallback(
    (view: AppState['overlayDrawerView'], forceExpanded?: boolean) => {
      const willExpand = forceExpanded ?? view !== 'none';
      return patchState({
        overlayDrawerView: view,
        overlayExpanded: willExpand,
      });
    },
    [patchState]
  );

  const toggleExpanded = useCallback(() => {
    if (!state) return;
    const willExpand = !state.overlayExpanded;
    const nextView = willExpand
      ? state.overlayDrawerView === 'none'
        ? 'response'
        : state.overlayDrawerView
      : 'none';

    return patchState({
      overlayExpanded: willExpand,
      overlayDrawerView: nextView,
    });
  }, [state, patchState]);

  return {
    state,
    patchState,
    activeMode,
    setActiveMode,
    toggleSession,
    setDrawer,
    toggleExpanded,
  };
}
