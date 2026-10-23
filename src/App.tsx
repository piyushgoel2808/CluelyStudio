import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAppState } from './hooks/useAppState';
import { useLiveScreen } from './hooks/useLiveScreen';
import { useAudioPipeline } from './hooks/useAudioPipeline';
import { CluelyOverlayCard } from './components/overlay/CluelyOverlayCard';
import { SettingsWindow } from './components/settings/SettingsWindow';
import { MemoryItem, TranscriptSegment } from './types/ipc';

export const App: React.FC = () => {
  const [currentRoute, setCurrentRoute] = useState<string>(() => {
    return window.location.hash.replace(/^#\/?/, '') || 'overlay';
  });

  useEffect(() => {
    const handleHashChange = () => {
      const route = window.location.hash.replace(/^#\/?/, '') || 'overlay';
      setCurrentRoute(route);
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (currentRoute === 'settings') {
    return <SettingsWindow />;
  }

  return <OverlayApp />;
};

const OverlayApp: React.FC = () => {
  const {
    state,
    patchState,
    activeMode,
    toggleSession,
  } = useAppState();

  const isLiveScreenActive = Boolean(state?.isLiveScreenActive);
  const selectedSourceId = state?.selectedScreenSourceId ?? null;

  const {
    segments,
    flushPendingSpeech,
    flushAndWaitForTranscription,
  } = useAudioPipeline(state);

  const {
    attachedScreenshots,
    snapManualScreenshot,
    removeScreenshot,
  } = useLiveScreen(isLiveScreenActive, selectedSourceId);

  const [inputValue, setInputValue] = useState<string>('');
  const [latestUserPrompt, setLatestUserPrompt] = useState<string>('');
  const [aiResponse, setAiResponse] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>(() => state?.transcripts || []);
  const [usedMemories, setUsedMemories] = useState<MemoryItem[]>([]);

  const currentStreamIdRef = useRef<string | null>(null);

  // Sync state.transcripts when loaded from store
  useEffect(() => {
    if (state?.transcripts && state.transcripts.length > 0) {
      setTranscripts((prev) => {
        if (prev.length === 0) return state.transcripts;
        return prev;
      });
    }
  }, [state?.transcripts]);

  // Sync transcripts from IPC
  useEffect(() => {
    if (window.cluely && window.cluely.onTranscriptSegment) {
      const unsub = window.cluely.onTranscriptSegment((segment) => {
        setTranscripts((prev) => {
          const newBaseId = segment.id.replace(/_(part|fin)$/, '');
          const idx = prev.findIndex((s) => {
            if (s.id === segment.id) return true;
            const sBaseId = s.id.replace(/_(part|fin)$/, '');
            if (sBaseId === newBaseId) return true;
            if (
              s.isPartial &&
              s.speakerId === segment.speakerId &&
              Math.abs(s.startTimeMs - segment.startTimeMs) < 1500
            ) {
              return true;
            }
            return false;
          });

          if (idx !== -1) {
            const next = [...prev];
            next[idx] = segment;
            return next;
          }
          return [segment, ...prev];
        });
      });
      return unsub;
    }
  }, []);

  // Listen for newChat shortcut (Cmd+R) to clear active AI response and context
  useEffect(() => {
    if (window.cluely && window.cluely.onShortcut) {
      const unsub = window.cluely.onShortcut('newChat', () => {
        setAiResponse('');
        setLatestUserPrompt('');
        setIsGenerating(false);
        setTranscripts([]);
      });
      return unsub;
    }
  }, []);

  // Listen for real-time AI Stream Chunks (multimodal SSE)
  useEffect(() => {
    if (window.cluely && window.cluely.onAIStreamChunk) {
      const unsub = window.cluely.onAIStreamChunk((chunk) => {
        if (chunk.requestId === currentStreamIdRef.current) {
          if (chunk.delta) {
            setAiResponse((prev) => prev + chunk.delta);
          }
          if (chunk.usedMemories && chunk.usedMemories.length > 0) {
            setUsedMemories(chunk.usedMemories);
          }
          if (chunk.error) {
            setAiResponse((prev) => `${prev}\n\n[Error: ${chunk.error}]`);
            setIsGenerating(false);
          }
          if (chunk.done) {
            setIsGenerating(false);
          }
        }
      });
      return unsub;
    }
  }, []);

  const handleSubmit = useCallback(
    async (prompt: string, customDisplayLabel?: string, triggerSource?: 'typed' | 'voice') => {
      if (isGenerating) {
        return; // Guard against duplicate concurrent requests
      }
      const resolvedTrigger: 'typed' | 'voice' = triggerSource || (prompt.trim() ? 'typed' : 'voice');
      const isVoiceAssist = resolvedTrigger === 'voice';

      // FIX 1 & STEP 2: Force-flush pending VAD speech from mic & system audio
      // and await in-flight ASR segment transcriptions BEFORE requesting AI stream!
      if (isVoiceAssist) {
        try {
          if (flushAndWaitForTranscription) {
            await flushAndWaitForTranscription();
          } else if (flushPendingSpeech) {
            await flushPendingSpeech();
          }
        } catch (flushErr) {
          console.warn('[OverlayApp] flush speech error, continuing:', flushErr);
        }
      }

      const displayLabel = customDisplayLabel || (isVoiceAssist ? 'Assist' : prompt.trim());
      const effectivePrompt = isVoiceAssist ? '' : prompt.trim();

      setInputValue(''); // Clear immediately so it never lingers
      setLatestUserPrompt(displayLabel);
      setAiResponse('');
      setUsedMemories([]);
      setIsGenerating(true);

      const latestScreenshot = attachedScreenshots[0]?.dataUrl || null;
      const reqId = `stream_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      currentStreamIdRef.current = reqId;

      try {
        if (window.cluely && window.cluely.askAIStream) {
          const activeTranscripts = segments.length > 0 ? segments : transcripts;
          await window.cluely.askAIStream({
            requestId: reqId,
            prompt: effectivePrompt,
            imageDataUrl: latestScreenshot,
            transcript: activeTranscripts,
            modeId: state?.activeModeId,
            triggerSource: resolvedTrigger,
          });
        }
      } catch (err) {
        console.error('[OverlayApp] askAIStream error:', err);
        setAiResponse(`Error generating response: ${String(err)}`);
        setIsGenerating(false);
      } finally {
        setInputValue('');
      }
    },
    [attachedScreenshots, segments, transcripts, state?.activeModeId, flushPendingSpeech]
  );

  const handleCancelStream = useCallback(() => {
    if (currentStreamIdRef.current && window.cluely?.cancelAIStream) {
      window.cluely.cancelAIStream(currentStreamIdRef.current);
    }
    setIsGenerating(false);
  }, []);

  return (
    <div className="flex flex-col items-center justify-start p-2 select-none">
      <CluelyOverlayCard
        state={state}
        activeMode={activeMode}
        inputValue={inputValue}
        onInputChange={setInputValue}
        onSubmit={handleSubmit}
        aiResponse={aiResponse}
        latestUserPrompt={latestUserPrompt}
        isGenerating={isGenerating}
        onCancelGenerating={handleCancelStream}
        attachedScreenshots={attachedScreenshots}
        onRemoveScreenshot={removeScreenshot}
        onSnapScreenshot={snapManualScreenshot}
        onToggleLiveScreen={() => patchState({ isLiveScreenActive: !isLiveScreenActive })}
        onToggleUndetectability={() => {
          const val = !state?.undetectability;
          window.cluely?.setUndetectability?.(val);
          patchState({ undetectability: val });
        }}
        onToggleSession={toggleSession}
        onStartSession={async () => {
          if (window.cluely?.startSession) await window.cluely.startSession();
          else toggleSession();
        }}
        onStopSession={async () => {
          if (window.cluely?.stopSession) await window.cluely.stopSession();
          else toggleSession();
        }}
        onClearSessionChat={async () => {
          if (window.cluely?.clearSessionChat) await window.cluely.clearSessionChat();
          setAiResponse('');
          setIsGenerating(false);
        }}
        onOpenSettings={(tab?: string) => window.cluely?.openSettings(tab)}
        onSelectMode={(modeId: string) => patchState({ activeModeId: modeId })}
        usedMemories={usedMemories}
        transcripts={segments.length > 0 ? segments : transcripts}
        onClearResponse={() => {
          setAiResponse('');
          setIsGenerating(false);
        }}
      />
    </div>
  );
};
