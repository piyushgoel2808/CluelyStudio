import React, { useState, useRef, useEffect } from 'react';
import {
  GripVertical,
  CornerDownLeft,
  Monitor,
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
  transcripts,
  onClearResponse,
}) => {
  const { onMouseDown: handleOverlayDrag } = useWindowDrag('overlay');

  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [activeDrawerView, setActiveDrawerView] = useState<'response' | 'transcripts' | 'history'>('response');
  const [copied, setCopied] = useState<boolean>(false);
  const [sessionSeconds, setSessionSeconds] = useState<number>(0);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState<boolean>(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;

  // Automatically open drawer when AI begins generating or returns answer
  useEffect(() => {
    if (isGenerating || aiResponse) {
      setIsDrawerOpen(true);
      setActiveDrawerView('response');
    }
  }, [isGenerating, aiResponse]);

  // Session timer
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

  // Keyboard shortcut listener (Cmd+Enter for Ask AI, Escape to dismiss)
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
      } else if (aiResponse) {
        onClearResponse();
      }
    }
  };

  const handleCopy = () => {
    if (!aiResponse) return;
    navigator.clipboard.writeText(aiResponse);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Dynamically sync Electron window height to DOM content height
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
  }, [isDrawerOpen, aiResponse, isGenerating, isModeMenuOpen, activeDrawerView]);

  const isLiveScreenActive = Boolean(state?.isLiveScreenActive);
  const isSessionActive = Boolean(state?.isSessionActive);
  const isUndetectable = Boolean(state?.undetectability);

  // Active meeting assist events for history tab
  const activeSession = (state?.pastSessions || []).find((s) => s.id === state?.currentSessionId);
  const sessionHistoryEvents = activeSession?.assistEvents || [];

  return (
    <div
      ref={containerRef}
      onMouseDown={handleOverlayDrag}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      className="flex flex-col items-center select-none w-[660px] transition-all cursor-grab active:cursor-grabbing"
    >
      {/* ========================================================================= */}
      {/* MAIN TWO-TIER FROSTED GLASS BAR                                          */}
      {/* ========================================================================= */}
      <div className="w-full rounded-[22px] overflow-hidden border border-white/[0.16] shadow-[0_24px_60px_rgba(0,0,0,0.7)] backdrop-blur-2xl transition-all bg-[#2b2b2e]/92">
        {/* Attached context preview chips */}
        {attachedScreenshots.length > 0 && (
          <div
            data-no-drag="true"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="bg-[#202024]/95 px-4 py-1.5 flex items-center gap-2 overflow-x-auto border-b border-white/[0.08] cursor-default"
          >
            <span className="text-[11px] font-medium text-white/70 flex items-center gap-1">
              <ImageIcon size={12} className="text-white/60" /> Attached Screen:
            </span>
            {attachedScreenshots.map((snap) => (
              <div
                key={snap.id}
                className="flex items-center gap-1.5 bg-black/40 rounded-md px-2 py-0.5 text-[11px] text-white/90 border border-white/10 shrink-0"
              >
                <span className="max-w-[100px] truncate">{snap.sourceName}</span>
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

        {/* ----------------------------------------------------------------------- */}
        {/* TIER 1: TOP INPUT BAR                                                  */}
        {/* ----------------------------------------------------------------------- */}
        <div className="px-4 py-3 flex items-center gap-3">
          {/* Drag Handle Icon on Left */}
          <div
            className="text-white/40 hover:text-white transition flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing"
            title="Drag overlay to reposition on screen"
          >
            <GripVertical size={18} />
          </div>

          {/* Center Input Field */}
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
              placeholder="Ask about your screen or conversation, or ⌘↵ for Assist"
              className="w-full bg-transparent text-white placeholder-white/50 text-[15px] font-normal focus:outline-none"
            />
          </div>

          {/* Right Submit Button */}
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
            title="Ask AI (⌘↵)"
          >
            {isGenerating ? (
              <Square size={10} className="fill-current text-white" />
            ) : (
              <CornerDownLeft size={15} strokeWidth={2.4} />
            )}
          </button>
        </div>

        {/* ----------------------------------------------------------------------- */}
        {/* TIER 2: CONTROL TOOLBAR (ALL 6 CONTROLS VISIBLE AT ALL TIMES)          */}
        {/* ----------------------------------------------------------------------- */}
        <div
          data-no-drag="true"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="bg-[#202023]/95 px-4 py-2 flex items-center justify-between border-t border-white/[0.08] cursor-default"
        >
          {/* Group 1: Screen Vision & Invisibility Controls */}
          <div className="flex items-center gap-2">
            {/* Control 1: Screen Sharing Toggle */}
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
              title="Toggle Screen Vision Sharing with AI (Click to toggle live screen / snap)"
            >
              <Monitor size={14} className={isLiveScreenActive ? 'text-[#38bdf8] animate-pulse' : ''} />
              <span>{isLiveScreenActive ? 'Screen ON' : 'Screen OFF'}</span>
            </button>

            {/* Control 2: Invisibility / Undetectability Toggle */}
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
              title="Toggle Screen-Share Invisibility (⌘⇧I) — Hides overlay from Zoom, Teams, Meet"
            >
              {isUndetectable ? <Eye size={14} /> : <EyeOff size={14} />}
              <span>{isUndetectable ? 'Invisible' : 'Visible'}</span>
            </button>
          </div>

          {/* Group 2: Mode Switcher & Audio Session Control */}
          <div className="flex items-center gap-2">
            {/* Control 3: Mode Switcher */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsModeMenuOpen(!isModeMenuOpen)}
                className="bg-white/10 hover:bg-white/15 text-white text-xs font-medium px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                title="Switch Copilot Mode (⌘M)"
              >
                <LayoutGrid size={13} className="text-sky-400" />
                <span className="max-w-[100px] truncate">{activeMode?.name || 'Gen AI'}</span>
                <ChevronDown
                  size={12}
                  className={`text-white/60 transition-transform ${isModeMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {/* Mode Dropdown Popover */}
              {isModeMenuOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-56 bg-[#18181c] border border-white/15 rounded-xl shadow-2xl py-1.5 z-50 overflow-hidden backdrop-blur-xl">
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
                        onOpenSettings('modes');
                      }}
                      className="w-full text-left px-3 py-1.5 text-[11px] text-neutral-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
                    >
                      Configure Modes...
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Control 4: Start / Stop Audio Session Button */}
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
              className={`px-3 py-1 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition cursor-pointer shadow-sm active:scale-95 ${
                isSessionActive
                  ? 'bg-red-500/25 text-red-300 ring-1 ring-red-500/40 hover:bg-red-500/35'
                  : 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30'
              }`}
              title={isSessionActive ? 'Stop Audio Session' : 'Start Audio Session'}
            >
              <AudioLines size={14} className={isSessionActive ? 'animate-pulse text-red-400' : ''} />
              <span>{isSessionActive ? `Session (${formatTimer(sessionSeconds)})` : 'Start Audio'}</span>
            </button>
          </div>

          {/* Group 3: Reset, Settings & Drawer Toggle */}
          <div className="flex items-center gap-1.5">
            {/* Control 5: New Chat / Reset Session Context Button */}
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
              title="New Session / Clear Context (⌘R)"
            >
              <RotateCcw size={15} />
            </button>

            {/* Control 6: Settings Button */}
            <button
              type="button"
              onClick={() => onOpenSettings()}
              className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition cursor-pointer"
              title="Open Settings (⌘,)"
            >
              <Settings size={15} />
            </button>

            {/* History [↓] Drawer Toggle */}
            <button
              type="button"
              onClick={() => setIsDrawerOpen(!isDrawerOpen)}
              className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition cursor-pointer ${
                isDrawerOpen
                  ? 'bg-white/20 text-white'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
              title="Expand / Collapse Drawer"
            >
              <History size={13} />
              <span>History</span>
              <ChevronDown
                size={12}
                className={`transition-transform duration-200 ${isDrawerOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* DRAWER VIEWPORT: AI RESPONSE, LIVE TRANSCRIPTS, OR SESSION Q&A HISTORY     */}
      {/* ========================================================================= */}
      {isDrawerOpen && (
        <div
          data-no-drag="true"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="w-full mt-2 bg-[#202024]/95 backdrop-blur-2xl border border-white/[0.14] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] p-4 flex flex-col gap-3 text-white transition-all cursor-default"
        >
          {/* Drawer Top Row: Sub-Tab Selectors & Action Pill */}
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveDrawerView('response')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                  activeDrawerView === 'response'
                    ? 'bg-white/15 text-white'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                AI Response
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
                Live Transcripts ({transcripts.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveDrawerView('history')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                  activeDrawerView === 'history'
                    ? 'bg-white/15 text-white'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                Session History ({sessionHistoryEvents.length})
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="bg-[#0091FF] text-white text-[11px] font-semibold px-2.5 py-0.5 rounded-md shadow-sm">
                {latestUserPrompt || 'Assist'}
              </span>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="text-white/40 hover:text-white p-1 rounded-md hover:bg-white/10 transition cursor-pointer"
                title="Collapse drawer"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* TAB 1: AI RESPONSE */}
          {activeDrawerView === 'response' && (
            <div className="flex flex-col gap-2">
              {/* Quick Action Chips */}
              <div className="flex items-center gap-2 text-xs text-neutral-300 pt-0.5 pb-1 select-none font-medium overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => onSubmit('', 'Assist', 'voice')}
                  className="flex items-center gap-1 hover:text-white transition cursor-pointer active:scale-95 shrink-0 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded-md"
                >
                  <Sparkles size={12} className="text-sky-400" />
                  <span>Assist</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onSubmit(
                      'What should I say right now? Deliver the exact first-person words I should speak out loud enclosed in quotation marks.',
                      'What should I say?',
                      'voice'
                    )
                  }
                  className="flex items-center gap-1 hover:text-white transition cursor-pointer active:scale-95 shrink-0 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded-md"
                >
                  <Wand2 size={12} className="text-amber-400" />
                  <span>What should I say?</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onSubmit(
                      'Give me 2-3 sharp follow-up questions to bounce back to the speaker right now.',
                      'Follow-up questions',
                      'voice'
                    )
                  }
                  className="flex items-center gap-1 hover:text-white transition cursor-pointer active:scale-95 shrink-0 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded-md"
                >
                  <MessageSquare size={12} className="text-emerald-400" />
                  <span>Follow-up questions</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onSubmit(
                      'Give a concise 2-3 sentence meeting recap of what was just explained or discussed.',
                      'Recap',
                      'voice'
                    )
                  }
                  className="flex items-center gap-1 hover:text-white transition cursor-pointer active:scale-95 shrink-0 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded-md"
                >
                  <RotateCw size={12} className="text-purple-400" />
                  <span>Recap</span>
                </button>
              </div>

              {/* Streaming or generated text content */}
              {isGenerating && !aiResponse ? (
                <div className="py-8 flex items-center justify-center gap-2 text-sky-300 text-xs font-medium">
                  <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                  <span>Synthesizing live answer...</span>
                </div>
              ) : aiResponse ? (
                <div
                  ref={scrollContainerRef}
                  className="max-h-[300px] overflow-y-auto pr-1 text-[14px] text-white/95 leading-relaxed selection:bg-sky-500/30 font-normal prose prose-invert max-w-none"
                  dangerouslySetInnerHTML={{
                    __html: marked.parse(aiResponse, { breaks: true }) as string,
                  }}
                />
              ) : (
                <div className="py-6 text-center text-xs text-white/40">
                  Press ⌘↵ or speak to trigger instant AI answers.
                </div>
              )}

              {/* Footer row: Copy & Stop */}
              {aiResponse && (
                <div className="flex items-center justify-between pt-2 border-t border-white/[0.08]">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="text-[12px] text-white/60 hover:text-white flex items-center gap-1.5 transition cursor-pointer"
                  >
                    {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    <span>{copied ? 'Copied' : 'Copy answer'}</span>
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

          {/* TAB 2: LIVE TRANSCRIPTS */}
          {activeDrawerView === 'transcripts' && (
            <div className="max-h-[280px] overflow-y-auto flex flex-col gap-2 pr-1">
              {transcripts.length === 0 ? (
                <div className="py-8 text-center text-xs text-white/40">
                  No transcripts recorded yet. Speak into your mic or start meeting loopback audio.
                </div>
              ) : (
                transcripts.slice(0, 30).map((seg) => (
                  <div
                    key={seg.id}
                    className="p-2 rounded-lg bg-black/30 border border-white/5 flex flex-col gap-0.5 text-xs"
                  >
                    <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-400">
                      <span style={{ color: seg.speakerColor || '#38bdf8' }}>
                        {seg.speakerLabel || (seg.role === 'me' ? 'Candidate (Me)' : 'Interviewer (Them)')}
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
          )}

          {/* TAB 3: SESSION Q&A HISTORY */}
          {activeDrawerView === 'history' && (
            <div className="max-h-[280px] overflow-y-auto flex flex-col gap-3 pr-1">
              {sessionHistoryEvents.length === 0 ? (
                <div className="py-8 text-center text-xs text-white/40">
                  No questions asked in this session yet.
                </div>
              ) : (
                sessionHistoryEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-2.5 rounded-lg bg-black/40 border border-white/10 flex flex-col gap-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between text-[11px] text-sky-400 font-semibold">
                      <span>Q: {ev.userPrompt}</span>
                      <span className="text-neutral-500 font-mono text-[10px]">{ev.formattedOffset}</span>
                    </div>
                    <div className="text-white/80 line-clamp-3 leading-relaxed">
                      {ev.aiResponse.replace(/^\*\*Question:\*\*.*?\n/i, '')}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
