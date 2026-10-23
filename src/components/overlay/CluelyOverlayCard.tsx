import React, { useState, useRef, useEffect } from 'react';
import {
  Navigation,
  ChevronDown,
  Square,
  Sparkles,
  Wand2,
  MessageSquare,
  RotateCw,
  Zap,
  Play,
  Copy,
  Check,
  X,
  Image as ImageIcon,
  History,
} from 'lucide-react';
import { marked } from 'marked';
import { AppState, CluelyMode, MemoryItem, TranscriptSegment } from '../../types/ipc';
import { AttachedScreenshot } from '../../hooks/useLiveScreen';

interface CluelyOverlayCardProps {
  state: AppState | null;
  activeMode: CluelyMode | undefined;
  inputValue: string;
  onInputChange: (val: string) => void;
  onSubmit: (prompt: string, displayLabel?: string, triggerSource?: 'typed' | 'voice') => void;
  aiResponse: string;
  latestUserPrompt: string;
  isGenerating: boolean;
  onCancelGenerating: () => void;
  attachedScreenshots: AttachedScreenshot[];
  onRemoveScreenshot: (id: string) => void;
  onSnapScreenshot: () => void;
  onToggleSession: () => void;
  onOpenSettings: (tab?: string) => void;
  onSelectMode?: (modeId: string) => void;
  usedMemories: MemoryItem[];
  transcripts: TranscriptSegment[];
  onClearResponse: () => void;
}

export const CluelyOverlayCard: React.FC<CluelyOverlayCardProps> = ({
  state,
  activeMode,
  inputValue,
  onInputChange,
  onSubmit,
  aiResponse,
  latestUserPrompt,
  isGenerating,
  onCancelGenerating,
  attachedScreenshots,
  onRemoveScreenshot,
  onToggleSession,
  onOpenSettings,
  onSelectMode,
  transcripts,
  onClearResponse,
}) => {
  const [isCardHidden, setIsCardHidden] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [sessionSeconds, setSessionSeconds] = useState<number>(0);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Active query badge label (Assist, What should I say?, Recap, Follow-up questions, or custom)
  const activeIntentBadge = latestUserPrompt || 'Assist';

  // Session elapsed timer
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (state?.isSessionActive) {
      interval = setInterval(() => {
        setSessionSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setSessionSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [state?.isSessionActive]);

  // Format elapsed time (M:SS)
  const formatTimer = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;

  // Keyboard shortcut listener (Cmd+Enter for Assist, Escape to toggle/clear)
  useEffect(() => {
    if (window.cluely && window.cluely.onShortcut) {
      const unsub = window.cluely.onShortcut('askCluely', () => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
        const text = inputValueRef.current.trim();
        inputValueRef.current = '';
        onInputChange('');
        if (text.length > 0) {
          onSubmit(text, text, 'typed');
        } else {
          onSubmit('', 'Assist', 'voice');
        }
      });
      return unsub;
    }
  }, [onSubmit, onInputChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = inputValueRef.current.trim();
      inputValueRef.current = '';
      onInputChange('');
      if (text.length > 0) {
        onSubmit(text, text, 'typed');
      } else {
        onSubmit('', 'Assist', 'voice');
      }
    } else if (e.key === 'Escape') {
      if (aiResponse) {
        onClearResponse();
      } else {
        setIsCardHidden((prev) => !prev);
      }
    }
  };

  const handleCopy = () => {
    if (!aiResponse) return;
    navigator.clipboard.writeText(aiResponse);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Determine context tag: Viewed screen vs Heard conversation
  const contextTag =
    attachedScreenshots.length > 0
      ? 'Viewed screen'
      : transcripts.length > 0
      ? 'Listening in real time'
      : 'Cluely Copilot';

  const hasContent = Boolean(aiResponse || isGenerating);

  // Dynamically sync Electron window height to the exact DOM content height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const syncHeight = () => {
      // scrollHeight gives the true unclipped height of the entire card hierarchy
      const measured = Math.ceil(el.scrollHeight);
      // Give a comfortable buffer (36px) so bottom rounded borders and shadows are completely visible
      const target = Math.max(56, measured + 36);
      window.cluely?.setOverlayHeight(target);
    };

    syncHeight();

    const ro = new ResizeObserver(() => {
      syncHeight();
    });
    ro.observe(el);

    return () => ro.disconnect();
  }, [isCardHidden, hasContent, aiResponse, state?.isSessionActive, isModeMenuOpen]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center select-none w-[600px] transition-all"
    >
      {/* 1. TOP FLOATING CAPSULE BAR (Logo + Hide/Show + Stop) */}
      <div className="flex items-center gap-2.5 bg-[#202024]/90 backdrop-blur-xl border border-white/10 rounded-full px-3.5 py-1 shadow-lg mb-2 cursor-pointer transition hover:bg-[#202024]">
        {/* Cluely Logo Icon (Click opens Settings ⌘ ,) */}
        <button
          type="button"
          onClick={() => onOpenSettings?.()}
          className="w-5 h-5 rounded-full bg-white hover:bg-neutral-200 flex items-center justify-center text-black shadow-sm transition hover:scale-105 active:scale-95 cursor-pointer"
          title="Open Settings ⌘ ,"
        >
          <Navigation size={11} className="rotate-45 fill-current text-black" />
        </button>

        {/* Hide / Show Button */}
        <button
          type="button"
          onClick={() => setIsCardHidden(!isCardHidden)}
          className="text-xs text-white/85 hover:text-white flex items-center gap-1 font-medium transition cursor-pointer"
        >
          <ChevronDown
            size={13}
            className={`transition-transform duration-200 ${isCardHidden ? 'rotate-180' : ''}`}
          />
          <span>{isCardHidden ? 'Show' : 'Hide'}</span>
        </button>

        {/* Stop / Start Recording Button */}
        <button
          type="button"
          onClick={onToggleSession}
          className="w-5 h-5 rounded-md bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 transition cursor-pointer ml-0.5"
          title={state?.isSessionActive ? 'Stop Session' : 'Start Session'}
        >
          {state?.isSessionActive ? (
            <Square size={9} className="fill-current text-white/90" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
          )}
        </button>
      </div>

      {/* 2. MAIN CLUELY TRANSLUCENT CARD */}
      {!isCardHidden && (
        <div className="w-full bg-[#202024]/95 backdrop-blur-2xl border border-white/[0.12] rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.7)] p-4 flex flex-col gap-3 text-white transition-all">
          {/* Header row: Context label on left, Blue Action Pill & Close on right */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-neutral-400 font-medium">
                {contextTag}
              </span>

              {/* Attached screenshot thumbnails preview */}
              {attachedScreenshots.length > 0 && (
                <div className="flex items-center gap-1">
                  {attachedScreenshots.map((snap) => (
                    <div
                      key={snap.id}
                      className="flex items-center gap-1 bg-black/40 rounded px-1.5 py-0.5 text-[10px] text-white/80 border border-white/10"
                    >
                      <ImageIcon size={10} className="text-white/60" />
                      <span className="max-w-[80px] truncate">{snap.sourceName}</span>
                      <button
                        type="button"
                        onClick={() => onRemoveScreenshot(snap.id)}
                        className="text-white/40 hover:text-white"
                      >
                        <X size={9} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Vibrant Blue Action Pill */}
              <span className="bg-[#0091FF] text-white text-[12px] font-semibold px-3 py-1 rounded-lg shadow-sm tracking-wide">
                {activeIntentBadge}
              </span>

              {/* Close button if response is visible */}
              {hasContent && (
                <button
                  type="button"
                  onClick={onClearResponse}
                  className="text-white/40 hover:text-white p-1 rounded-md hover:bg-white/10 transition cursor-pointer"
                  title="Close response"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* AI Response Output Area (Smooth scrollbar, never gets stuck or clipped) */}
          {hasContent && (
            <div className="flex flex-col gap-2 pt-1 pb-1">
              {isGenerating && !aiResponse ? (
                <div className="py-6 flex items-center justify-center gap-2 text-sky-300 text-xs font-medium">
                  <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                  <span>Generating response...</span>
                </div>
              ) : (
                <div
                  ref={scrollContainerRef}
                  className="max-h-[300px] overflow-y-auto pr-1 text-[14px] text-white/95 leading-relaxed selection:bg-sky-500/30 font-normal prose prose-invert max-w-none"
                  dangerouslySetInnerHTML={{
                    __html: marked.parse(aiResponse, { breaks: true }) as string,
                  }}
                />
              )}

              {/* Copy Response & Stop Generation footer */}
              {aiResponse && (
                <div className="flex items-center justify-between pt-2 border-t border-white/[0.08]">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="text-[12px] text-white/60 hover:text-white flex items-center gap-1.5 transition cursor-pointer"
                  >
                    {copied ? (
                      <Check size={13} className="text-emerald-400" />
                    ) : (
                      <Copy size={13} />
                    )}
                    <span>{copied ? 'Copied response' : 'Copy response'}</span>
                  </button>

                  {isGenerating && (
                    <button
                      type="button"
                      onClick={onCancelGenerating}
                      className="text-[12px] text-red-400 hover:text-red-300 flex items-center gap-1 transition cursor-pointer"
                    >
                      <Square size={10} className="fill-current" />
                      <span>Stop</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Quick Action Pills Row (Assist • What should I say? • Follow-up questions • Recap) */}
          <div className="flex items-center gap-2.5 text-xs text-neutral-300 pt-0.5 pb-0.5 select-none font-medium">
            <button
              type="button"
              onClick={() => onSubmit('', 'Assist', 'voice')}
              className="flex items-center gap-1 hover:text-white transition cursor-pointer active:scale-95"
            >
              <Sparkles size={12} className="text-neutral-400" />
              <span>Assist</span>
            </button>
            <span className="text-neutral-600">•</span>
            <button
              type="button"
              onClick={() =>
                onSubmit(
                  'What should I say right now? Deliver the exact first-person words I should speak out loud enclosed in quotation marks.',
                  'What should I say?',
                  'voice'
                )
              }
              className="flex items-center gap-1 hover:text-white transition cursor-pointer active:scale-95"
            >
              <Wand2 size={12} className="text-neutral-400" />
              <span>What should I say?</span>
            </button>
            <span className="text-neutral-600">•</span>
            <button
              type="button"
              onClick={() =>
                onSubmit(
                  'Give me 2-3 sharp follow-up questions to bounce back to the speaker right now.',
                  'Follow-up questions',
                  'voice'
                )
              }
              className="flex items-center gap-1 hover:text-white transition cursor-pointer active:scale-95"
            >
              <MessageSquare size={12} className="text-neutral-400" />
              <span>Follow-up questions</span>
            </button>
            <span className="text-neutral-600">•</span>
            <button
              type="button"
              onClick={() =>
                onSubmit(
                  'Give a concise 2-3 sentence meeting recap of what was just explained or discussed.',
                  'Recap',
                  'voice'
                )
              }
              className="flex items-center gap-1 hover:text-white transition cursor-pointer active:scale-95"
            >
              <RotateCw size={12} className="text-neutral-400" />
              <span>Recap</span>
            </button>
          </div>

          {/* Integrated Inset Search/Input Box */}
          <div className="bg-[#19191c] border border-white/10 rounded-xl p-3 flex flex-col gap-2 shadow-inner">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your screen or conversation, or ⌘ ↵ for Assist"
              className="bg-transparent text-[13px] text-white placeholder-white/40 outline-none w-full"
            />

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2 relative">
                {/* 1-Click Mode Selector Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsModeMenuOpen(!isModeMenuOpen)}
                    className="bg-white/10 hover:bg-white/15 text-white/90 text-[11px] font-medium px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                    title="Change Copilot Mode"
                  >
                    <Zap size={11} className="text-sky-400" />
                    <span className="max-w-[85px] truncate">{activeMode?.name || 'Smart'}</span>
                    <ChevronDown
                      size={10}
                      className={`text-white/60 transition-transform ${isModeMenuOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {isModeMenuOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-52 bg-[#18181c] border border-white/15 rounded-xl shadow-2xl py-1.5 z-50 overflow-hidden backdrop-blur-xl">
                      <div className="px-3 py-1 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                        Copilot Mode
                      </div>
                      <div className="max-h-48 overflow-y-auto no-scrollbar">
                        {(state?.modes || []).map((m) => {
                          const isCurrent = state?.activeModeId === m.id;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => {
                                onSelectMode?.(m.id);
                                setIsModeMenuOpen(false);
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition cursor-pointer ${
                                isCurrent
                                  ? 'bg-[#0091FF]/20 text-[#38bdf8] font-semibold'
                                  : 'text-neutral-300 hover:text-white hover:bg-white/5'
                              }`}
                            >
                              <span className="truncate">{m.name}</span>
                              {isCurrent && <Check size={12} className="text-[#38bdf8]" />}
                            </button>
                          );
                        })}
                      </div>
                      <div className="border-t border-white/10 mt-1 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setIsModeMenuOpen(false);
                            onOpenSettings?.('modes');
                          }}
                          className="w-full text-left px-3 py-1.5 text-[11px] text-neutral-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
                        >
                          Configure Modes...
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Direct Link to Sessions & History */}
                <button
                  type="button"
                  onClick={() => onOpenSettings?.('sessions')}
                  className="text-white/40 hover:text-white text-xs p-1 rounded transition cursor-pointer"
                  title="View Meeting Sessions & History"
                >
                  <History size={13} />
                </button>

                {/* Settings ... Button */}
                <button
                  type="button"
                  onClick={() => onOpenSettings?.()}
                  className="text-white/40 hover:text-white text-xs px-1.5 py-1 transition cursor-pointer"
                  title="Open Settings ⌘ ,"
                >
                  •••
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (isGenerating) {
                    onCancelGenerating();
                  } else {
                    const text = inputValueRef.current.trim();
                    inputValueRef.current = '';
                    onInputChange('');
                    if (text.length > 0) {
                      onSubmit(text, text, 'typed');
                    } else {
                      onSubmit('', 'Assist', 'voice');
                    }
                  }
                }}
                className="w-7 h-7 rounded-full bg-[#0091FF] hover:bg-sky-400 text-white flex items-center justify-center transition shadow cursor-pointer active:scale-95"
                title={isGenerating ? 'Stop generating' : 'Send'}
              >
                {isGenerating ? (
                  <Square size={9} className="fill-current" />
                ) : (
                  <Play size={10} className="fill-current translate-x-0.5" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. ACTIVE SESSION STATUS PILL (Clicking opens Sessions History page) */}
      {state?.isSessionActive && (
        <div
          onClick={() => onOpenSettings?.('sessions')}
          className="mt-2 flex items-center gap-2 bg-[#1a1a1d]/90 backdrop-blur-xl border border-white/10 rounded-full px-3 py-1 text-xs text-white/80 shadow-md cursor-pointer hover:bg-[#252528] transition group"
          title="Open Active Session & Transcripts"
        >
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="font-semibold text-white group-hover:text-sky-400 transition">
            Active Session
          </span>
          <span className="text-neutral-500">•</span>
          <span className="text-neutral-400 font-mono text-[11px]">
            Recording • {formatTimer(sessionSeconds)}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSession();
            }}
            className="w-4 h-4 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 ml-1 transition cursor-pointer"
            title="Stop recording"
          >
            <Square size={8} className="fill-current text-red-400" />
          </button>
        </div>
      )}
    </div>
  );
};
