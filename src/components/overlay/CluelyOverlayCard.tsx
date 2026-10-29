import React, { useState, useRef, useEffect } from 'react';
import {
  GripVertical,
  CornerDownLeft,
  Monitor,
  Camera,
  Eye,
  EyeOff,
  LayoutGrid,
  AudioLines,
  RotateCcw,
  Settings,
  ChevronDown,
  Square,
  Sparkles,
  Wand2,
  MessageSquare,
  RotateCw,
  Copy,
  Check,
  X,
  History,
  Image as ImageIcon,
  FileText,
  Brain,
  Code2,
} from 'lucide-react';
import { marked } from 'marked';
import { AppState, CluelyMode, MemoryItem, TranscriptSegment } from '../../types/ipc';
import { AttachedScreenshot } from '../../hooks/useLiveScreen';
import { useWindowDrag } from '../../hooks/useWindowDrag';

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
  onToggleLiveScreen?: () => void;
  onToggleUndetectability?: () => void;
  onToggleSession: () => void;
  onStartSession?: () => void;
  onStopSession?: () => void;
  onClearSessionChat?: () => void;
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
  onSnapScreenshot,
  onToggleLiveScreen,
  onToggleUndetectability,
  onToggleSession,
  onStartSession,
  onStopSession,
  onClearSessionChat,
  onOpenSettings,
  onSelectMode,
  usedMemories,
  transcripts,
  onClearResponse,
}) => {
  const { onMouseDown: handleOverlayDrag } = useWindowDrag('overlay');

  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [activeDrawerView, setActiveDrawerView] = useState<
    'response' | 'transcripts' | 'notes'
  >('response');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sessionSeconds, setSessionSeconds] = useState<number>(0);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState<boolean>(false);
  const [notesDraft, setNotesDraft] = useState<string>('');
  const [isGeneratingNotes, setIsGeneratingNotes] = useState<boolean>(false);
  const [isExtractingMemories, setIsExtractingMemories] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;

  const activeSession = (state?.pastSessions || []).find((s) => s.id === state?.currentSessionId);
  const sessionHistoryEvents = activeSession?.assistEvents || [];

  useEffect(() => {
    if (activeSession?.notes !== undefined) {
      setNotesDraft(activeSession.notes);
    }
  }, [activeSession?.id, activeSession?.notes]);

  useEffect(() => {
    if (isGenerating || aiResponse) {
      setIsDrawerOpen(true);
      setActiveDrawerView('response');
    }
  }, [isGenerating, aiResponse]);

  // Smooth auto-scroll to newest streaming Q&A card while keeping all previous cards scrollable above
  useEffect(() => {
    if ((isGenerating || aiResponse) && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [aiResponse, isGenerating, sessionHistoryEvents.length]);

  // Support global keyboard shortcut scrolling (⌘⇧↑ / ⌘⇧↓) inside the Q&A feed
  useEffect(() => {
    if (window.cluely && window.cluely.onShortcutScroll) {
      const unsub = window.cluely.onShortcutScroll((direction) => {
        if (scrollContainerRef.current) {
          const delta = direction === 'down' ? 160 : -160;
          scrollContainerRef.current.scrollBy({ top: delta, behavior: 'smooth' });
        }
      });
      return unsub;
    }
  }, []);

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

  const formatTimer = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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
      if (isDrawerOpen) {
        setIsDrawerOpen(false);
      }
    }
  };

  const handleCopyText = (id: string, text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSaveNotes = async () => {
    if (!activeSession || !window.cluely?.updateSessionNotes) return;
    await window.cluely.updateSessionNotes(activeSession.id, notesDraft);
    setStatusBanner('Saved session notes');
    setTimeout(() => setStatusBanner(null), 2200);
  };

  const handleAutoGenerateNotes = async () => {
    if (!window.cluely?.generateSessionNotes) return;
    setIsGeneratingNotes(true);
    setStatusBanner(null);
    try {
      const updated = await window.cluely.generateSessionNotes(activeSession?.id);
      if (updated?.notes) {
        setNotesDraft(updated.notes);
      }
      setStatusBanner('Synthesized AI meeting notes & action items');
    } catch {
      setStatusBanner('Could not synthesize notes');
    } finally {
      setIsGeneratingNotes(false);
      setTimeout(() => setStatusBanner(null), 3000);
    }
  };

  const handleExtractFactsToVectorDB = async () => {
    if (!window.cluely?.extractMemoriesFromTranscript || transcripts.length === 0) return;
    setIsExtractingMemories(true);
    setStatusBanner(null);
    try {
      const added = await window.cluely.extractMemoriesFromTranscript(transcripts);
      setStatusBanner(`Indexed ${added.length} facts into Local Vector DB`);
    } catch {
      setStatusBanner('Fact extraction failed');
    } finally {
      setIsExtractingMemories(false);
      setTimeout(() => setStatusBanner(null), 3000);
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const syncHeight = () => {
      const measured = Math.ceil(el.scrollHeight);
      const target = Math.max(68, measured + 28);
      window.cluely?.setOverlayHeight(target);
    };

    syncHeight();
    const ro = new ResizeObserver(() => syncHeight());
    ro.observe(el);

    return () => ro.disconnect();
  }, [
    isDrawerOpen,
    aiResponse,
    isGenerating,
    isModeMenuOpen,
    activeDrawerView,
    notesDraft,
    sessionHistoryEvents.length,
  ]);

  const isLiveScreenActive = Boolean(state?.isLiveScreenActive);
  const isSessionActive = Boolean(state?.isSessionActive);
  const isUndetectable = Boolean(state?.undetectability);
  const overlayOpacity =
    typeof state?.overlayOpacity === 'number'
      ? Math.max(0.2, Math.min(1.0, state.overlayOpacity))
      : 0.92;

  const activeModelLabel =
    state?.aiConfig?.activeProvider === 'ollama'
      ? state?.aiConfig?.activeModel || 'gemma4:e4b'
      : `${state?.aiConfig?.activeProvider || 'ollama'}`;

  return (
    <div
      ref={containerRef}
      onMouseDown={handleOverlayDrag}
      style={
        {
          WebkitAppRegion: 'drag',
          opacity: overlayOpacity,
        } as React.CSSProperties
      }
      className="flex flex-col items-center select-none w-[652px] transition-opacity duration-150 cursor-grab active:cursor-grabbing"
    >
      {/* ========================================================================= */}
      {/* MAIN TWO-TIER FROSTED GLASS BAR                                          */}
      {/* ========================================================================= */}
      <div className="w-full rounded-[22px] overflow-hidden border border-white/[0.16] shadow-[0_24px_60px_rgba(0,0,0,0.75)] backdrop-blur-2xl transition-all bg-[#222226]/95">
        {attachedScreenshots.length > 0 && (
          <div
            data-no-drag="true"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="bg-[#18181b]/95 px-4 py-1.5 flex items-center gap-2 overflow-x-auto border-b border-white/[0.08] cursor-default"
          >
            <span className="text-[11px] font-medium text-sky-400 flex items-center gap-1">
              <ImageIcon size={12} /> Screen Context Ready:
            </span>
            {attachedScreenshots.map((snap) => (
              <div
                key={snap.id}
                className="flex items-center gap-1.5 bg-black/50 rounded-md px-2 py-0.5 text-[11px] text-white/90 border border-white/10 shrink-0"
              >
                <span className="max-w-[110px] truncate">{snap.sourceName}</span>
                <button
                  type="button"
                  onClick={() => onRemoveScreenshot(snap.id)}
                  className="text-white/40 hover:text-white cursor-pointer"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* TIER 1: TOP INPUT BAR */}
        <div className="px-4 py-3 flex items-center gap-3">
          <div
            className="text-white/40 hover:text-white transition flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing"
            title="Drag overlay anywhere on screen (Press ⌘\ to hide/show all Cluely windows)"
          >
            <GripVertical size={18} />
          </div>

          <div
            data-no-drag="true"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="flex-1 flex items-center gap-2 cursor-text"
          >
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything or press ⌘↵ for 2-sec live voice Assist..."
              className="w-full bg-transparent text-white placeholder-white/45 text-[14.5px] font-normal focus:outline-none"
            />
          </div>

          {/* Active Model Pill Badge */}
          <span
            data-no-drag="true"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => onOpenSettings('security')}
            className="text-[10px] font-mono text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-md cursor-pointer hover:bg-emerald-500/25 shrink-0"
            title="Active Fast AI Model — Click to configure"
          >
            ⚡ {activeModelLabel}
          </span>

          <button
            type="button"
            data-no-drag="true"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
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
            className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center transition active:scale-95 cursor-pointer ${
              inputValue.trim().length > 0 || isGenerating
                ? 'bg-[#0091FF] text-white shadow-sm hover:bg-sky-400'
                : 'bg-white/15 hover:bg-white/25 text-white/90'
            }`}
            title="Ask Cluely (⌘↵)"
          >
            {isGenerating ? (
              <Square size={10} className="fill-current text-white" />
            ) : (
              <CornerDownLeft size={15} strokeWidth={2.4} />
            )}
          </button>
        </div>

        {/* TIER 2: CONTROL TOOLBAR */}
        <div
          data-no-drag="true"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="bg-[#18181b]/95 px-4 py-2 flex items-center justify-between border-t border-white/[0.08] cursor-default"
        >
          {/* Left Group: Screen Vision, Snap & Stealth */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (onToggleLiveScreen) {
                  onToggleLiveScreen();
                } else {
                  onSnapScreenshot();
                }
              }}
              className={`px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition cursor-pointer ${
                isLiveScreenActive
                  ? 'bg-sky-500/25 text-[#38bdf8] ring-1 ring-sky-500/40 hover:bg-sky-500/35'
                  : 'bg-white/10 text-white/70 hover:text-white hover:bg-white/15'
              }`}
              title="Toggle Continuous Screen Context for Gemma 4 Vision"
            >
              <Monitor size={13} className={isLiveScreenActive ? 'text-[#38bdf8] animate-pulse' : ''} />
              <span>{isLiveScreenActive ? 'Vision ON' : 'Vision OFF'}</span>
            </button>

            <button
              type="button"
              onClick={onSnapScreenshot}
              className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white/75 hover:text-white text-xs font-medium flex items-center gap-1 transition cursor-pointer"
              title="Capture Self-Excluded Screen Snapshot Now"
            >
              <Camera size={13} />
              <span>Snap</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (onToggleUndetectability) {
                  onToggleUndetectability();
                } else {
                  const val = !isUndetectable;
                  window.cluely?.setUndetectability?.(val);
                }
              }}
              className={`px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition cursor-pointer ${
                isUndetectable
                  ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40 hover:bg-amber-500/30'
              }`}
              title="Hardware Screen-Share Stealth Protection (⌘\ to hide/show all windows)"
            >
              {isUndetectable ? <Eye size={13} /> : <EyeOff size={13} />}
              <span>{isUndetectable ? 'Stealth' : 'Visible'}</span>
            </button>
          </div>

          {/* Center Group: Mode Selector & Always-On Audio Badge */}
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsModeMenuOpen(!isModeMenuOpen)}
                className="bg-white/10 hover:bg-white/15 text-white text-xs font-medium px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                title="Switch Active Copilot Mode"
              >
                <LayoutGrid size={13} className="text-sky-400" />
                <span className="max-w-[110px] truncate">{activeMode?.name || 'General Copilot'}</span>
                <ChevronDown
                  size={12}
                  className={`text-white/60 transition-transform ${isModeMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {isModeMenuOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-60 bg-[#16161a] border border-white/15 rounded-xl shadow-2xl py-1.5 z-50 overflow-hidden backdrop-blur-xl">
                  <div className="px-3 py-1 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                    Copilot Mode & Vector RAG
                  </div>
                  <div className="max-h-52 overflow-y-auto no-scrollbar">
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
                          <div className="flex items-center gap-1">
                            {m.files?.length > 0 && (
                              <span className="text-[10px] text-neutral-400 bg-white/10 px-1.5 rounded">
                                {m.files.length}f
                              </span>
                            )}
                            {isCurrent && <Check size={12} className="text-[#38bdf8]" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="border-t border-white/10 mt-1 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsModeMenuOpen(false);
                        onOpenSettings('modes');
                      }}
                      className="w-full text-left px-3 py-1.5 text-[11px] text-sky-400 hover:text-sky-300 hover:bg-white/5 transition cursor-pointer font-medium"
                    >
                      + Manage Modes & Attach Files...
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                if (isSessionActive) {
                  if (onStopSession) onStopSession();
                  else onToggleSession();
                } else {
                  if (onStartSession) onStartSession();
                  else onToggleSession();
                }
              }}
              className="px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition cursor-pointer shadow-sm active:scale-95 bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30"
              title="Mic + System Audio are ALWAYS listening continuously (Click to start/reset session timer)"
            >
              <AudioLines size={13} className="animate-pulse text-emerald-400" />
              <span>{isSessionActive ? `Live (${formatTimer(sessionSeconds)})` : 'Audio Live'}</span>
            </button>
          </div>

          {/* Right Group: Clear, Settings & Workspace Drawer */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (onClearSessionChat) {
                  onClearSessionChat();
                } else {
                  onClearResponse();
                }
              }}
              className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition cursor-pointer"
              title="Start Fresh Session Context (⌘R)"
            >
              <RotateCcw size={14} />
            </button>

            <button
              type="button"
              onClick={() => onOpenSettings()}
              className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition cursor-pointer"
              title="Open Cluely Studio Settings (⌘,)"
            >
              <Settings size={14} />
            </button>

            <button
              type="button"
              onClick={() => setIsDrawerOpen(!isDrawerOpen)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition cursor-pointer ${
                isDrawerOpen
                  ? 'bg-white/20 text-white'
                  : 'text-white/75 hover:text-white hover:bg-white/10'
              }`}
              title="Expand / Collapse Scrollable Q&A & Transcript Feed"
            >
              <History size={13} />
              <span>Feed ({sessionHistoryEvents.length})</span>
              <ChevronDown
                size={12}
                className={`transition-transform duration-200 ${isDrawerOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* EXPANDABLE WORKSPACE DRAWER: SCROLLABLE Q&A FEED, TRANSCRIPTS, NOTES      */}
      {/* ========================================================================= */}
      {isDrawerOpen && (
        <div
          data-no-drag="true"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="w-full mt-2 bg-[#1c1c20]/96 backdrop-blur-2xl border border-white/[0.14] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.65)] p-4 flex flex-col gap-3 text-white transition-all cursor-default"
        >
          {/* Drawer Sub-Navigation Tabs */}
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveDrawerView('response')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                  activeDrawerView === 'response'
                    ? 'bg-white/15 text-white'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                Teleprompter & Session Q&A ({sessionHistoryEvents.length + (isGenerating ? 1 : 0)})
              </button>
              <button
                type="button"
                onClick={() => setActiveDrawerView('transcripts')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                  activeDrawerView === 'transcripts'
                    ? 'bg-white/15 text-white'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                Live Transcript ({transcripts.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveDrawerView('notes')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer flex items-center gap-1 ${
                  activeDrawerView === 'notes'
                    ? 'bg-white/15 text-white'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                <FileText size={11} />
                <span>Session Notes</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {usedMemories.length > 0 && (
                <span
                  className="bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-medium px-2 py-0.5 rounded-md flex items-center gap-1"
                  title="Memories retrieved from Local Vector DB"
                >
                  <Brain size={11} /> {usedMemories.length} Vector Memories
                </span>
              )}
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="text-white/40 hover:text-white p-1 rounded-md hover:bg-white/10 transition cursor-pointer"
                title="Collapse panel"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {statusBanner && (
            <div className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
              <span>{statusBanner}</span>
              <Check size={13} />
            </div>
          )}

          {/* TAB 1: CONTINUOUS SCROLLABLE TELEPROMPTER & SESSION Q&A FEED */}
          {activeDrawerView === 'response' && (
            <div className="flex flex-col gap-2">
              {/* Quick Action Chips */}
              <div className="flex items-center gap-1.5 text-xs text-neutral-300 pt-0.5 pb-1 select-none font-medium overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => onSubmit('', 'Assist', 'voice')}
                  className="flex items-center gap-1 hover:text-white transition cursor-pointer active:scale-95 shrink-0 bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-md border border-white/5"
                >
                  <Sparkles size={12} className="text-sky-400" />
                  <span>Assist (⌘↵)</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onSubmit(
                      'What should I say right now? Give me the exact first-person words I should speak aloud in 3 short bullet points.',
                      'What should I say?',
                      'voice'
                    )
                  }
                  className="flex items-center gap-1 hover:text-white transition cursor-pointer active:scale-95 shrink-0 bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-md border border-white/5"
                >
                  <Wand2 size={12} className="text-amber-400" />
                  <span>What to say?</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await onSnapScreenshot();
                    onSubmit(
                      'Analyze the problem, code, or slide on my screen right now. Give the immediate optimal solution and complexity.',
                      'Analyze Screen',
                      'typed'
                    );
                  }}
                  className="flex items-center gap-1 hover:text-white transition cursor-pointer active:scale-95 shrink-0 bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-md border border-white/5"
                >
                  <Code2 size={12} className="text-cyan-400" />
                  <span>Solve Screen</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onSubmit(
                      'Give me 2-3 sharp follow-up questions to ask the speaker right now.',
                      'Follow-up questions',
                      'voice'
                    )
                  }
                  className="flex items-center gap-1 hover:text-white transition cursor-pointer active:scale-95 shrink-0 bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-md border border-white/5"
                >
                  <MessageSquare size={12} className="text-emerald-400" />
                  <span>Follow-ups</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onSubmit(
                      'Give a concise 3-bullet recap of what was just discussed along with any action items.',
                      'Recap',
                      'voice'
                    )
                  }
                  className="flex items-center gap-1 hover:text-white transition cursor-pointer active:scale-95 shrink-0 bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-md border border-white/5"
                >
                  <RotateCw size={12} className="text-purple-400" />
                  <span>Recap</span>
                </button>
              </div>

              {/* Scrollable Feed of ALL Previous Answers in Current Session + Active Streaming Answer */}
              <div
                ref={scrollContainerRef}
                className="max-h-[340px] overflow-y-auto pr-1 flex flex-col gap-3 scroll-smooth"
              >
                {sessionHistoryEvents.length === 0 && !isGenerating && !aiResponse && (
                  <div className="py-7 text-center text-xs text-white/40">
                    Mic & System Audio are continuously listening. Press{' '}
                    <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/70">⌘↵</kbd> at any time for an instant 2–3s answer. All answers in this session stay scrollable right here.
                  </div>
                )}

                {/* Previous Q&A turns in the current session (never vanish!) */}
                {sessionHistoryEvents.map((ev, index) => (
                  <div
                    key={ev.id}
                    className="p-3.5 rounded-xl bg-black/40 border border-white/10 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between text-[11px] border-b border-white/[0.06] pb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="bg-sky-500/20 text-sky-300 border border-sky-500/30 font-mono text-[10px] px-1.5 py-0.5 rounded shrink-0">
                          #{index + 1} • {ev.formattedOffset}
                        </span>
                        <span className="font-semibold text-white/90 truncate">
                          {ev.userPrompt}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyText(ev.id, ev.aiResponse)}
                        className="text-white/50 hover:text-white flex items-center gap-1 transition cursor-pointer shrink-0 ml-2"
                      >
                        {copiedId === ev.id ? (
                          <Check size={12} className="text-emerald-400" />
                        ) : (
                          <Copy size={12} />
                        )}
                        <span>{copiedId === ev.id ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <div
                      className="text-[13.5px] text-white/95 leading-relaxed selection:bg-sky-500/30 font-normal prose prose-invert max-w-none"
                      dangerouslySetInnerHTML={{
                        __html: marked.parse(ev.aiResponse, { breaks: true }) as string,
                      }}
                    />
                  </div>
                ))}

                {/* Active Streaming Turn at the bottom of the scrollable feed */}
                {(isGenerating || aiResponse) && (
                  <div className="p-3.5 rounded-xl bg-sky-950/25 border border-sky-500/40 flex flex-col gap-2 shadow-lg">
                    <div className="flex items-center justify-between text-[11px] border-b border-white/[0.08] pb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping shrink-0" />
                        <span className="font-semibold text-sky-300 truncate">
                          {latestUserPrompt || 'Live Voice Assist'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {aiResponse && (
                          <button
                            type="button"
                            onClick={() => handleCopyText('streaming', aiResponse)}
                            className="text-white/60 hover:text-white flex items-center gap-1 transition cursor-pointer"
                          >
                            {copiedId === 'streaming' ? (
                              <Check size={12} className="text-emerald-400" />
                            ) : (
                              <Copy size={12} />
                            )}
                            <span>{copiedId === 'streaming' ? 'Copied' : 'Copy'}</span>
                          </button>
                        )}
                        {isGenerating && (
                          <button
                            type="button"
                            onClick={onCancelGenerating}
                            className="text-red-400 hover:text-red-300 flex items-center gap-1 transition cursor-pointer"
                          >
                            <Square size={10} className="fill-current" />
                            <span>Stop</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {aiResponse ? (
                      <div
                        className="text-[14px] text-white/95 leading-relaxed selection:bg-sky-500/30 font-normal prose prose-invert max-w-none"
                        dangerouslySetInnerHTML={{
                          __html: marked.parse(aiResponse, { breaks: true }) as string,
                        }}
                      />
                    ) : (
                      <div className="py-3 flex items-center gap-2 text-sky-300 text-xs font-medium">
                        <span>Quick-thinking answer streaming from {activeModelLabel}...</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: LIVE TRANSCRIPTS */}
          {activeDrawerView === 'transcripts' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between pb-1">
                <span className="text-[11px] text-neutral-400">
                  Always-On Audio: <strong className="text-emerald-400">Me (Mic)</strong> +{' '}
                  <strong className="text-sky-400">Them (System Audio)</strong>
                </span>
                <button
                  type="button"
                  disabled={isExtractingMemories || transcripts.length === 0}
                  onClick={handleExtractFactsToVectorDB}
                  className="text-[11px] bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 px-2.5 py-1 rounded-md flex items-center gap-1 transition cursor-pointer disabled:opacity-40"
                >
                  <Brain size={11} />
                  <span>{isExtractingMemories ? 'Indexing...' : 'Extract Facts to Vector DB'}</span>
                </button>
              </div>

              <div className="max-h-[280px] overflow-y-auto flex flex-col gap-2 pr-1">
                {transcripts.length === 0 ? (
                  <div className="py-8 text-center text-xs text-white/40">
                    Mic & System Audio are actively listening... Speak or play meeting audio to see live transcripts.
                  </div>
                ) : (
                  transcripts.slice(0, 50).map((seg) => (
                    <div
                      key={seg.id}
                      className="p-2.5 rounded-lg bg-black/35 border border-white/5 flex flex-col gap-0.5 text-xs"
                    >
                      <div className="flex items-center justify-between text-[11px] font-semibold">
                        <span
                          style={{
                            color: seg.speakerColor || (seg.role === 'me' ? '#22c55e' : '#38bdf8'),
                          }}
                        >
                          {seg.speakerLabel || (seg.role === 'me' ? 'Me' : 'Participant')}
                        </span>
                        <span className="text-neutral-500 font-mono text-[10px]">
                          {seg.formattedTimestamp || ''}
                        </span>
                      </div>
                      <div className="text-white/90 font-normal leading-relaxed">{seg.text}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 3: LIVE SESSION NOTES & SUMMARY */}
          {activeDrawerView === 'notes' && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white/85">
                  {activeSession?.title || 'Active Session Notes'}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isGeneratingNotes}
                    onClick={handleAutoGenerateNotes}
                    className="px-2.5 py-1 rounded-md bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/30 text-sky-300 text-[11px] font-medium flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles size={11} />
                    <span>{isGeneratingNotes ? 'Synthesizing...' : 'AI Auto-Notes'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveNotes}
                    className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium transition cursor-pointer"
                  >
                    Save Notes
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenSettings('sessions')}
                    className="px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-neutral-300 text-[11px] transition cursor-pointer"
                  >
                    All Sessions ↗
                  </button>
                </div>
              </div>

              {activeSession?.summary && (
                <div className="p-2.5 rounded-lg bg-sky-950/30 border border-sky-500/25 text-[11.5px] text-sky-200 leading-relaxed">
                  <strong className="text-sky-400">Summary:</strong> {activeSession.summary}
                </div>
              )}

              <textarea
                rows={6}
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="Jot down live meeting notes or click 'AI Auto-Notes' to synthesize key points, decisions, and action items from the transcript..."
                className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white/90 placeholder-white/35 focus:outline-none focus:border-sky-400 leading-relaxed resize-none"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
