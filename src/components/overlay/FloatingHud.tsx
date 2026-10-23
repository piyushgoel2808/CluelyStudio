import React, { useState, useRef, useEffect } from 'react';
import {
  CornerDownLeft,
  Image as ImageIcon,
  Eye,
  EyeOff,
  Settings,
  LayoutGrid,
  ArrowDown,
  X,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { AppState, CluelyMode } from '../../types/ipc';
import { AttachedScreenshot } from '../../hooks/useLiveScreen';
import { useWindowDrag } from '../../hooks/useWindowDrag';

interface FloatingHudProps {
  state: AppState | null;
  activeMode: CluelyMode | undefined;
  inputValue: string;
  onInputChange: (val: string) => void;
  onSubmit: (prompt: string) => void;
  attachedScreenshots: AttachedScreenshot[];
  onRemoveScreenshot: (id: string) => void;
  onSnapScreenshot: () => void;
  isLiveScreenActive: boolean;
  onToggleLiveScreen: () => void;
  onToggleSession: () => void;
  combinedBands?: number[];
  onOpenSettings: () => void;
  onToggleExpanded: () => void;
  onOpenDrawer: (view: AppState['overlayDrawerView']) => void;
  onOpenModesModal: () => void;
}

export const FloatingHud: React.FC<FloatingHudProps> = ({
  state,
  activeMode,
  inputValue,
  onInputChange,
  onSubmit,
  attachedScreenshots,
  onRemoveScreenshot,
  onSnapScreenshot,
  isLiveScreenActive,
  onToggleLiveScreen,
  onToggleSession,
  combinedBands = [0.15, 0.25, 0.35, 0.2, 0.3],
  onOpenSettings,
  onToggleExpanded,
  onOpenDrawer,
  onOpenModesModal,
}) => {
  const { onMouseDown: handleOverlayDrag } = useWindowDrag('overlay');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isHoveredSubmit, setIsHoveredSubmit] = useState(false);

  useEffect(() => {
    // Listen for global shortcut askCluely (⌘↵)
    if (window.cluely && window.cluely.onShortcut) {
      const unsub = window.cluely.onShortcut('askCluely', () => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
        onSubmit(inputValue);
      });
      return unsub;
    }
  }, [inputValue, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSubmit(inputValue);
    } else if (e.key === 'Escape') {
      if (state?.overlayExpanded) {
        onToggleExpanded();
      } else {
        window.cluely?.toggleOverlay();
      }
    }
  };

  const isSessionActive = Boolean(state?.isSessionActive);
  const isExpanded = Boolean(state?.overlayExpanded);

  return (
    <div
      onMouseDown={handleOverlayDrag}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      className="w-[680px] rounded-[22px] overflow-hidden border border-white/[0.16] shadow-[0_24px_60px_rgba(0,0,0,0.65)] backdrop-blur-2xl transition-all select-none cursor-grab active:cursor-grabbing"
    >
      {/* Attached Context Preview Chips */}
      {attachedScreenshots.length > 0 && (
        <div className="bg-[#5f5f62]/90 px-4 py-1.5 flex items-center gap-2 overflow-x-auto border-b border-white/[0.08]">
          <span className="text-[11px] font-medium text-white/70 flex items-center gap-1">
            <ImageIcon size={12} className="text-white/60" /> Attached Context:
          </span>
          {attachedScreenshots.map((snap) => (
            <div
              key={snap.id}
              className="flex items-center gap-1.5 bg-black/40 hover:bg-black/60 rounded-md px-2 py-0.5 text-[11px] text-white/90 border border-white/10 shrink-0 transition"
            >
              <img
                src={snap.dataUrl}
                alt={snap.sourceName}
                className="w-4 h-3 object-cover rounded-[2px]"
              />
              <span className="max-w-[120px] truncate">{snap.sourceName}</span>
              <button
                type="button"
                onClick={() => onRemoveScreenshot(snap.id)}
                className="text-white/50 hover:text-white p-0.5"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Top Tier: Input Bar */}
      <div className="bg-[#767679]/75 backdrop-blur-2xl px-5 py-3 flex items-center justify-between gap-3">
        <div className="flex-1 flex items-center gap-2">
          {isLiveScreenActive && (
            <div className="shrink-0 flex items-center gap-1 bg-[#38bdf8]/20 border border-[#38bdf8]/40 rounded-md px-2 py-0.5 text-[11px] text-[#38bdf8] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-[#38bdf8] animate-pulse" />
              <span>Live Screen</span>
            </div>
          )}
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your screen or conversation, or ⌘↵ for Assist"
            className="w-full bg-transparent text-white placeholder-white/65 text-[18px] leading-tight font-normal focus:outline-none"
            autoFocus
          />
        </div>

        <button
          type="button"
          onClick={() => onSubmit(inputValue)}
          onMouseEnter={() => setIsHoveredSubmit(true)}
          onMouseLeave={() => setIsHoveredSubmit(false)}
          className={`w-9 h-9 shrink-0 rounded-[11px] flex items-center justify-center transition active:scale-95 cursor-pointer ${
            inputValue.trim().length > 0
              ? 'bg-white/30 text-white shadow-sm hover:bg-white/40'
              : 'bg-white/20 hover:bg-white/30 text-white/90'
          }`}
          title="Submit prompt (Enter or ⌘↵)"
        >
          <CornerDownLeft
            size={18}
            strokeWidth={2.2}
            className={isHoveredSubmit ? 'translate-x-[-1px]' : ''}
          />
        </button>
      </div>

      {/* Bottom Tier: Control Toolbar */}
      <div className="bg-[#464649]/88 backdrop-blur-2xl px-4 py-2.5 flex items-center justify-between border-t border-white/[0.08]">
        {/* Left Section: Drag Handle & Active Mode Indicator */}
        <div
          className="flex items-center gap-2 cursor-grab active:cursor-grabbing shrink-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          onDoubleClick={onOpenSettings}
          title="Drag to reposition HUD (Double-click to open Settings)"
        >
          {/* Custom Cluely Emblem */}
          <div className="w-5 h-5 flex items-center justify-center text-white/80 hover:text-white transition">
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path
                d="M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.2L19 8.5v7l-7 3.9-7-3.9v-7L12 4.2z"
                opacity="0.45"
              />
              <path d="M12 6.5L6.5 9.5v5L12 17.5l5.5-3v-5L12 6.5z" />
            </svg>
          </div>

          <div
            onClick={(e) => {
              e.stopPropagation();
              onOpenModesModal();
            }}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="text-[11px] text-white/85 bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded-full font-medium transition cursor-pointer max-w-[125px] truncate"
            title="Switch Mode"
          >
            {activeMode?.name || 'Behavioral Interview'}
          </div>
        </div>

        {/* Center Section: Action Controls */}
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* 1. Dedicated Undetectability / Stealth Toggle (👁 / EyeOff) */}
          <button
            type="button"
            onClick={() => {
              const current = Boolean(state?.undetectability);
              window.cluely?.setUndetectability?.(!current);
            }}
            className={`px-2 py-1 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
              state?.undetectability
                ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25'
                : 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30 hover:bg-amber-500/25'
            }`}
            title={
              state?.undetectability
                ? 'Stealth Protection Active (Invisible to Zoom, Teams, Meet, Screen Recorders)'
                : 'Stealth Disabled (Window Visible in Screen Shares) - Click to Enable'
            }
          >
            {state?.undetectability ? <Eye size={15} /> : <EyeOff size={15} />}
            <span className="text-[11px] font-semibold tracking-wide">
              {state?.undetectability ? 'Stealth ON' : 'Visible'}
            </span>
          </button>

          {/* 2. Photo / Screen Context & Live Screen (🖼) */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onSnapScreenshot}
              onContextMenu={(e) => {
                e.preventDefault();
                onToggleLiveScreen();
              }}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
                isLiveScreenActive
                  ? 'text-[#38bdf8] bg-[#38bdf8]/20 ring-1 ring-[#38bdf8]/40'
                  : 'text-white/80 hover:text-white hover:bg-white/10'
              }`}
              title="Capture Screen Context (Click to snap screenshot, Right-click to toggle Live Stream)"
            >
              <ImageIcon size={16} />
            </button>
            {isLiveScreenActive && (
              <button
                type="button"
                onClick={onToggleLiveScreen}
                className="text-[10px] font-bold text-[#38bdf8] bg-[#38bdf8]/25 border border-[#38bdf8]/40 px-1.5 py-0.5 rounded-md flex items-center gap-1 animate-pulse"
                title="Live Screen Stream Active - Click to Stop"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#38bdf8]" />
                LIVE
              </button>
            )}
          </div>

          {/* 3. Modes Library (⊞) */}
          <button
            type="button"
            onClick={onOpenModesModal}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title="Modes Library (⊞)"
          >
            <LayoutGrid size={16} />
          </button>

          {/* Vertical Divider */}
          <div className="h-4 w-[1px] bg-white/20 mx-0.5" />

          {/* 4. Online / Offline Speech Engine Switcher */}
          {(() => {
            const current = state?.aiConfig?.voiceProvider;
            const isOffline = current === 'nvidia-parakeet-tdt' || current === 'whisper-base-onnx';
            return (
              <button
                type="button"
                onClick={() => {
                  const nextProvider = isOffline ? 'nvidia-hybrid' : 'whisper-base-onnx';
                  if (state?.aiConfig) {
                    window.cluely?.saveAIConfig?.({
                      ...state.aiConfig,
                      voiceProvider: nextProvider,
                    });
                  }
                }}
                className={`px-2 py-0.5 rounded-md text-[10.5px] font-semibold flex items-center gap-1 border transition cursor-pointer ${
                  isOffline
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30'
                    : 'bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30'
                }`}
                title={
                  isOffline
                    ? `Offline Mode Active (${current === 'whisper-base-onnx' ? 'Whisper Multilingual' : 'NVIDIA Parakeet-TDT'}). Click to switch to Cloud Speech.`
                    : 'Online Cloud Mode Active. Click to switch to Offline Speech.'
                }
              >
                {isOffline ? (
                  <>
                    <WifiOff size={11} />
                    <span>Offline</span>
                  </>
                ) : (
                  <>
                    <Wifi size={11} />
                    <span>Online</span>
                  </>
                )}
              </button>
            );
          })()}

          {/* 5. Live Audio Session Waveform REC (|||||) */}
          <button
            type="button"
            onClick={onToggleSession}
            className={`px-2 py-1 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
              isSessionActive
                ? 'bg-emerald-500/20 ring-1 ring-emerald-500/40 text-emerald-300'
                : 'hover:bg-white/10 text-white/80 hover:text-white'
            }`}
            title={
              isSessionActive
                ? 'Audio Session Active (Recording Me + Them) - Click to Stop'
                : 'Start Meeting Audio Session (⇧⌘\\)'
            }
          >
            <div className="flex items-center gap-[2px] h-3.5">
              <span
                style={{
                  height: isSessionActive ? `${Math.max(3, Math.round((combinedBands[0] || 0.2) * 14))}px` : '5px',
                }}
                className={`w-[2px] rounded-full transition-all duration-75 ${
                  isSessionActive ? 'bg-emerald-400' : 'bg-white/60'
                }`}
              />
              <span
                style={{
                  height: isSessionActive ? `${Math.max(3, Math.round((combinedBands[1] || 0.3) * 14))}px` : '10px',
                }}
                className={`w-[2px] rounded-full transition-all duration-75 ${
                  isSessionActive ? 'bg-emerald-400' : 'bg-white/60'
                }`}
              />
              <span
                style={{
                  height: isSessionActive ? `${Math.max(3, Math.round((combinedBands[2] || 0.4) * 14))}px` : '14px',
                }}
                className={`w-[2px] rounded-full transition-all duration-75 ${
                  isSessionActive ? 'bg-emerald-400' : 'bg-white/60'
                }`}
              />
              <span
                style={{
                  height: isSessionActive ? `${Math.max(3, Math.round((combinedBands[3] || 0.25) * 14))}px` : '7px',
                }}
                className={`w-[2px] rounded-full transition-all duration-75 ${
                  isSessionActive ? 'bg-emerald-400' : 'bg-white/60'
                }`}
              />
              <span
                style={{
                  height: isSessionActive ? `${Math.max(3, Math.round((combinedBands[4] || 0.35) * 14))}px` : '12px',
                }}
                className={`w-[2px] rounded-full transition-all duration-75 ${
                  isSessionActive ? 'bg-emerald-400' : 'bg-white/60'
                }`}
              />
            </div>
            {isSessionActive && (
              <span className="text-[10px] font-semibold text-emerald-400">REC</span>
            )}
          </button>

          {/* 6. Settings Gear Button (⚙️) */}
          <button
            type="button"
            onClick={onOpenSettings}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title="Open Cluely Settings (⌘,)"
          >
            <Settings size={16} />
          </button>
        </div>

        {/* Right Section: History & Drawer Toggle */}
        <div
          className="flex items-center gap-2 shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={() => onOpenDrawer('history')}
            className="text-[13px] font-medium text-white/85 hover:text-white transition cursor-pointer px-1.5 py-0.5 rounded hover:bg-white/5"
            title="View History & Meeting Transcripts"
          >
            History
          </button>

          <button
            type="button"
            onClick={onToggleExpanded}
            className="w-7 h-7 rounded-[9px] bg-white/15 hover:bg-white/25 flex items-center justify-center text-white/90 transition cursor-pointer active:scale-95"
            title={isExpanded ? 'Collapse Drawer' : 'Expand Drawer'}
          >
            <ArrowDown
              size={15}
              className={`transition-transform duration-200 ${
                isExpanded ? 'rotate-180' : 'rotate-0'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
};
