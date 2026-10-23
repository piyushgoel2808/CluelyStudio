import React, { useRef, useEffect, useState } from 'react';
import {
  Monitor,
  AppWindow,
  Play,
  Square,
  Sparkles,
  Edit3,
  RotateCcw,
  RefreshCw,
  Copy,
  Check,
  MessageSquare,
  Bookmark,
  Clock,
  Layers,
  ChevronRight,
  Brain,
  Paperclip,
  Trash2,
  Plus,
  Zap,
} from 'lucide-react';
import { marked } from 'marked';
import { AppState, MemoryItem, ScreenSourceInfo, TranscriptSegment } from '../../types/ipc';
import { SPEAKER_TRACK_COLORS } from '../../services/vadAndDiarization';

interface OverlayDrawerProps {
  state: AppState | null;
  activeView: AppState['overlayDrawerView'];
  onClose: () => void;
  onSelectView: (view: AppState['overlayDrawerView']) => void;
  // Live Screen
  sources: ScreenSourceInfo[];
  selectedSource: ScreenSourceInfo | null;
  onSelectSource: (sourceId: string) => void;
  isStreaming: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
  onToggleLiveStream: () => void;
  onRefreshSources: () => void;
  onAskAboutScreen: () => void;
  // Response & Chat
  aiResponse: string;
  latestUserPrompt?: string;
  isGenerating: boolean;
  onCancelGenerating?: () => void;
  usedMemories?: MemoryItem[];
  onRunQuickAction: (actionPrompt: string, displayLabel?: string) => void;
  onClearChat: () => void;
  // History & Transcripts
  transcripts: TranscriptSegment[];
  chatHistory: Array<{ id: string; role: 'user' | 'assistant'; text: string; timestamp: number }>;
  onRenameSpeaker?: (speakerId: string, newName: string) => void;
  onToggleMeetingEnvironment?: () => void;
  micLevel?: number;
  systemLevel?: number;
  // Modes selection
  isModesModalOpen: boolean;
  onCloseModesModal: () => void;
  onSelectMode: (modeId: string) => void;
}

export const OverlayDrawer: React.FC<OverlayDrawerProps> = ({
  state,
  activeView,
  onClose,
  onSelectView,
  sources,
  selectedSource,
  onSelectSource,
  isStreaming,
  videoRef,
  onToggleLiveStream,
  onRefreshSources,
  onAskAboutScreen,
  aiResponse,
  latestUserPrompt = '',
  isGenerating,
  onCancelGenerating,
  usedMemories = [],
  onRunQuickAction,
  onClearChat,
  transcripts,
  chatHistory,
  onRenameSpeaker,
  onToggleMeetingEnvironment,
  micLevel = 0,
  systemLevel = 0,
  isModesModalOpen,
  onCloseModesModal,
  onSelectMode,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [showMemoriesDrawer, setShowMemoriesDrawer] = useState(false);
  const [editingSpeakerId, setEditingSpeakerId] = useState<string | null>(null);
  const [tempSpeakerName, setTempSpeakerName] = useState<string>('');
  const [savedMemoryId, setSavedMemoryId] = useState<string | null>(null);
  const [isExtractingFacts, setIsExtractingFacts] = useState(false);
  const [extractionNotice, setExtractionNotice] = useState<string | null>(null);

  // Global shortcut scrolling
  useEffect(() => {
    if (window.cluely && window.cluely.onShortcutScroll) {
      const unsub = window.cluely.onShortcutScroll((direction) => {
        if (scrollContainerRef.current) {
          const delta = direction === 'down' ? 140 : -140;
          scrollContainerRef.current.scrollBy({ top: delta, behavior: 'smooth' });
        }
      });
      return unsub;
    }
  }, []);

  // Global shortcut newChat (⌘R)
  useEffect(() => {
    if (window.cluely && window.cluely.onShortcut) {
      const unsub = window.cluely.onShortcut('newChat', () => {
        onClearChat();
      });
      return unsub;
    }
  }, [onClearChat]);

  const handleCopyResponse = () => {
    if (!aiResponse) return;
    navigator.clipboard.writeText(aiResponse);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveSegmentToMemory = async (seg: TranscriptSegment) => {
    if (!window.cluely?.addMemory) return;
    await window.cluely.addMemory({
      category: 'meeting_fact',
      title: `${seg.speakerLabel} Statement`,
      content: seg.text,
      tags: ['meeting', seg.speakerLabel.toLowerCase(), seg.role],
    });
    setSavedMemoryId(seg.id);
    setTimeout(() => setSavedMemoryId(null), 2500);
  };

  const handleExtractMeetingFacts = async () => {
    if (!window.cluely?.extractMemoriesFromTranscript || transcripts.length === 0) return;
    setIsExtractingFacts(true);
    setExtractionNotice(null);
    try {
      const extracted = await window.cluely.extractMemoriesFromTranscript(transcripts);
      setExtractionNotice(`Extracted ${extracted.length} permanent facts into Memory Vault!`);
    } catch {
      setExtractionNotice('Failed to extract facts. Verify Gemini API key.');
    } finally {
      setIsExtractingFacts(false);
      setTimeout(() => setExtractionNotice(null), 4000);
    }
  };

  const handlePickFilesForMode = async (modeId: string) => {
    if (!window.cluely?.pickModeFiles) return;
    await window.cluely.pickModeFiles(modeId);
  };

  const handleRemoveModeFile = async (modeId: string, fileId: string) => {
    if (!window.cluely?.removeModeFile) return;
    await window.cluely.removeModeFile(modeId, fileId);
  };

  const latencyProfile = state?.aiConfig?.nvidiaSpeech?.latencyProfile || 'balanced';
  const latencyBadgeMap: Record<string, { label: string; time: string; color: string }> = {
    'ultra-low': { label: 'NVIDIA Ultra-Low', time: '380ms', color: 'text-amber-400 border-amber-400/30 bg-amber-400/10' },
    balanced: { label: 'NVIDIA Balanced', time: '650ms', color: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' },
    'high-accuracy': { label: 'NVIDIA High-Acc', time: '1050ms', color: 'text-sky-400 border-sky-400/30 bg-sky-400/10' },
  };
  const activeLatency = latencyBadgeMap[latencyProfile] || latencyBadgeMap.balanced;

  const QUICK_ACTION_CHIPS = [
    {
      label: 'Assist',
      icon: Sparkles,
      display: 'Assist',
      prompt: 'Assist: Look at the recent meeting conversation and current screen. Give me the immediate optimal answer or talking points.',
    },
    {
      label: 'What should I say?',
      icon: Edit3,
      display: 'What should I say?',
      prompt: 'What should I say? Give me the exact concise answer in first person to address the latest question or discussion topic in the live transcript above.',
    },
    {
      label: 'Follow-up questions',
      icon: MessageSquare,
      display: 'Follow-up questions',
      prompt: 'Suggest 2-3 sharp, thoughtful follow-up questions based on the meeting discussion.',
    },
    {
      label: 'Recap',
      icon: RotateCcw,
      display: 'Recap',
      prompt: 'Recap: Summarize the key points discussed and action items so far.',
    },
  ];

  // 60-Second 4-Track Speaker Timeline Calculation
  const now = Date.now();
  const timelineWindowMs = 60000;
  const recentTimelineSegments = transcripts.filter((s) => now - s.timestamp <= timelineWindowMs);

  // If modes modal is open, show the modes selection & attached files panel
  if (isModesModalOpen) {
    return (
      <div className="w-[680px] mt-2 rounded-[20px] bg-[#1a1a1c]/95 border border-white/[0.14] shadow-[0_20px_50px_rgba(0,0,0,0.7)] backdrop-blur-3xl overflow-hidden p-5 text-white select-none transition-all">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-white/80" />
            <h3 className="text-[15px] font-semibold tracking-wide">Cluely Modes & File RAG</h3>
            <span className="text-[11px] bg-white/10 text-white/70 px-2 py-0.5 rounded-full">
              {state?.modes.length || 11} preloaded
            </span>
          </div>
          <button
            type="button"
            onClick={onCloseModesModal}
            className="text-[13px] text-white/60 hover:text-white transition px-2 py-1 rounded bg-white/5 cursor-pointer"
          >
            Done
          </button>
        </div>

        <div className="mt-3.5 max-h-[360px] overflow-y-auto space-y-2 pr-1">
          {state?.modes.map((mode) => {
            const isActive = mode.id === state.activeModeId;
            return (
              <div
                key={mode.id}
                className={`p-3 rounded-xl border transition flex flex-col gap-2 ${
                  isActive
                    ? 'bg-white/15 border-white/30 text-white shadow-sm'
                    : 'bg-white/[0.04] border-white/[0.06] hover:bg-white/[0.08] text-white/85'
                }`}
              >
                <div
                  className="flex items-start justify-between gap-3 cursor-pointer"
                  onClick={() => {
                    onSelectMode(mode.id);
                  }}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[14px]">{mode.name}</span>
                      <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">
                        {mode.category}
                      </span>
                      {isActive && (
                        <span className="text-[10px] bg-[#38bdf8]/20 text-[#38bdf8] font-bold px-2 py-0.5 rounded-full">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-white/60 line-clamp-2 mt-1 leading-relaxed">
                      {mode.contextPrompt}
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-white/40 shrink-0 mt-1" />
                </div>

                {/* Attached Mode Knowledge Files */}
                <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Paperclip size={12} className="text-white/50" />
                    <span className="text-white/50">Knowledge Files:</span>
                    {mode.files && mode.files.length > 0 ? (
                      mode.files.map((f) => (
                        <span
                          key={f.id}
                          className="bg-black/40 border border-white/10 px-2 py-0.5 rounded flex items-center gap-1 text-white/80"
                        >
                          <span className="max-w-[110px] truncate">{f.name}</span>
                          <span className="text-white/40">({Math.round(f.size / 1024)}KB)</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveModeFile(mode.id, f.id);
                            }}
                            className="hover:text-red-400 p-0.5"
                          >
                            <Trash2 size={10} />
                          </button>
                        </span>
                      ))
                    ) : (
                      <span className="text-white/40 italic">None attached</span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePickFilesForMode(mode.id);
                    }}
                    className="flex items-center gap-1 bg-white/10 hover:bg-white/20 text-white/90 px-2 py-0.5 rounded border border-white/10 transition cursor-pointer shrink-0"
                  >
                    <Plus size={11} />
                    <span>Attach Docs/Code</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="w-[680px] mt-2 rounded-[20px] bg-[#1a1a1c]/95 border border-white/[0.14] shadow-[0_20px_50px_rgba(0,0,0,0.7)] backdrop-blur-3xl overflow-hidden flex flex-col text-white select-none transition-all max-h-[460px]">
      {/* Drawer Sub-Header Tabs */}
      <div className="bg-[#242427]/80 px-4 py-2 flex items-center justify-between border-b border-white/[0.08] shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSelectView('response')}
            className={`px-3 py-1 rounded-lg text-[13px] font-medium transition cursor-pointer flex items-center gap-1.5 ${
              activeView === 'response'
                ? 'bg-white/20 text-white shadow-sm'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Sparkles size={14} className="text-sky-300" />
            <span>Assistant</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectView('live-screen')}
            className={`px-3 py-1 rounded-lg text-[13px] font-medium transition cursor-pointer flex items-center gap-1.5 ${
              activeView === 'live-screen'
                ? 'bg-white/20 text-white shadow-sm'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Monitor size={14} className="text-emerald-400" />
            <span>Live Screen ({sources.length})</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectView('history')}
            className={`px-3 py-1 rounded-lg text-[13px] font-medium transition cursor-pointer flex items-center gap-1.5 ${
              activeView === 'history' || activeView === 'transcript'
                ? 'bg-white/20 text-white shadow-sm'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Clock size={14} className="text-amber-300" />
            <span>Transcripts & History</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Latency profile pill badge */}
          <div
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold tracking-wider ${activeLatency.color}`}
            title={`NVIDIA Speech Pipeline: ${activeLatency.label} profile (${activeLatency.time} silence hangover)`}
          >
            <Zap size={10} />
            <span>{activeLatency.time}</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-white/50 hover:text-white text-[12px] px-2 py-0.5 rounded hover:bg-white/10 transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>

      {/* Main Scrollable Drawer Content */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 text-[14px]"
      >
        {/* VIEW 1: Response View */}
        {activeView === 'response' && (
          <div className="space-y-4">
            {/* Quick action chips */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1.5 pt-0.5 no-scrollbar">
              {QUICK_ACTION_CHIPS.map((chip, idx) => {
                const IconComponent = chip.icon;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onRunQuickAction(chip.prompt, chip.display)}
                    className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white/90 text-[12px] px-3 py-1.5 rounded-full shrink-0 transition border border-white/10 cursor-pointer active:scale-95"
                  >
                    <IconComponent size={13} className="text-white/70" />
                    <span>{chip.label}</span>
                  </button>
                );
              })}
            </div>

            {/* AI Output Card */}
            <div className="bg-black/30 rounded-xl p-4 border border-white/[0.08] relative">
              <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/[0.06]">
                <div className="flex items-center gap-2 text-[12px] text-white/60">
                  <span className="w-2 h-2 rounded-full bg-sky-400" />
                  <span className="font-semibold text-white/90">Cluely Copilot</span>

                  {latestUserPrompt && (
                    <span className="bg-[#0091FF] text-white text-[11px] font-semibold px-2.5 py-0.5 rounded-full shadow-sm ml-1 truncate max-w-[280px]">
                      {latestUserPrompt}
                    </span>
                  )}

                  {/* Personal Memory Brain Active Indicator */}
                  {usedMemories.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowMemoriesDrawer(!showMemoriesDrawer)}
                      className="flex items-center gap-1 bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full text-[10px] font-medium hover:bg-purple-500/30 transition cursor-pointer"
                      title="Click to view personal memories injected into this response"
                    >
                      <Brain size={11} />
                      <span>🧠 {usedMemories.length} memories active</span>
                    </button>
                  )}

                  {isGenerating && (
                    <span className="animate-pulse text-sky-300 text-[11px] flex items-center gap-1">
                      <span>Streaming response...</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {isGenerating && onCancelGenerating && (
                    <button
                      type="button"
                      onClick={onCancelGenerating}
                      className="flex items-center gap-1 text-[11px] text-red-300 hover:text-red-200 px-2 py-0.5 rounded bg-red-500/20 border border-red-500/30 transition cursor-pointer"
                    >
                      <Square size={11} />
                      <span>Stop</span>
                    </button>
                  )}

                  {aiResponse && (
                    <button
                      type="button"
                      onClick={handleCopyResponse}
                      className="flex items-center gap-1 text-[11px] text-white/60 hover:text-white px-2 py-0.5 rounded bg-white/5 transition cursor-pointer"
                    >
                      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Memory Drawer breakdown if toggled */}
              {showMemoriesDrawer && usedMemories.length > 0 && (
                <div className="mb-3 p-2.5 bg-purple-950/40 border border-purple-500/30 rounded-lg text-[11px] space-y-1">
                  <span className="font-semibold text-purple-200 block uppercase tracking-wider text-[10px]">
                    Retrieved Personal Memories:
                  </span>
                  {usedMemories.map((m) => (
                    <div key={m.id} className="text-white/80 flex items-start gap-1">
                      <span className="text-purple-400 font-bold">•</span>
                      <span>
                        <strong className="text-white">{m.title}:</strong> {m.content}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {aiResponse ? (
                <div
                  className="prose prose-invert max-w-none text-white/95 text-[15px] leading-relaxed overflow-x-auto tracking-normal font-normal selection:bg-sky-500/30"
                  dangerouslySetInnerHTML={{
                    __html: marked.parse(aiResponse, { breaks: true }) as string,
                  }}
                />
              ) : isGenerating ? (
                <div className="py-6 text-center text-white/60 text-[13px] space-y-2">
                  <div className="flex items-center justify-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                    <span className="text-sky-300 font-medium">Generating response with local Ollama...</span>
                  </div>
                  <p className="text-[11px] text-white/40">Synthesizing audio and screen context</p>
                </div>
              ) : (
                <div className="py-8 text-center text-white/50 text-[13px] space-y-1">
                  <p>No response yet.</p>
                  <p className="text-[12px] text-white/40">
                    Type a prompt above or press ⌘↵ to ask about current audio & screen context.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 2: Live Screen View (👁) */}
        {activeView === 'live-screen' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[13px] text-white/80">Active Video Stream:</span>
                <span className="text-[12px] text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded">
                  {selectedSource?.name || 'Default Screen'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onRefreshSources}
                  className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10 transition"
                  title="Refresh Screen Sources"
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowSourcePicker(!showSourcePicker)}
                  className="text-[12px] bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded-md text-white/90 transition cursor-pointer"
                >
                  {showSourcePicker ? 'Hide Sources' : 'Switch Source'}
                </button>
              </div>
            </div>

            {/* Source Picker Grid */}
            {showSourcePicker && (
              <div className="grid grid-cols-3 gap-2.5 p-3 bg-black/40 rounded-xl border border-white/10 max-h-[180px] overflow-y-auto">
                {sources.map((src) => {
                  const isCur = src.id === selectedSource?.id;
                  return (
                    <div
                      key={src.id}
                      onClick={() => {
                        onSelectSource(src.id);
                        setShowSourcePicker(false);
                      }}
                      className={`p-2 rounded-lg border cursor-pointer transition flex flex-col gap-1.5 ${
                        isCur
                          ? 'bg-[#38bdf8]/15 border-[#38bdf8]/50 ring-1 ring-[#38bdf8]/40'
                          : 'bg-white/[0.04] border-white/10 hover:bg-white/10'
                      }`}
                    >
                      <img
                        src={src.thumbnailDataUrl || src.thumbnail}
                        alt={src.name}
                        className="w-full h-16 object-cover rounded bg-black/50"
                      />
                      <div className="flex items-center gap-1.5 text-[11px] truncate">
                        {src.type === 'screen' ? <Monitor size={12} /> : <AppWindow size={12} />}
                        <span className="truncate">{src.name}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Real-time Video Stream Monitor */}
            <div className="relative rounded-xl overflow-hidden bg-black/60 border border-white/10 aspect-video flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-contain"
              />

              {!isStreaming && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-3">
                  <Monitor size={36} className="text-white/40" />
                  <p className="text-[13px] text-white/60">Live stream monitor is currently paused.</p>
                  <button
                    type="button"
                    onClick={onToggleLiveStream}
                    className="flex items-center gap-1.5 bg-[#38bdf8] hover:bg-[#38bdf8]/90 text-black font-semibold text-[13px] px-4 py-1.5 rounded-lg transition cursor-pointer"
                  >
                    <Play size={14} /> Start Live Stream
                  </button>
                </div>
              )}
            </div>

            {/* Stream Action Controls */}
            {isStreaming && (
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={onToggleLiveStream}
                  className="flex items-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 text-[12px] px-3 py-1.5 rounded-lg transition cursor-pointer"
                >
                  <Square size={13} /> Pause Live View
                </button>

                <button
                  type="button"
                  onClick={onAskAboutScreen}
                  className="flex items-center gap-1.5 bg-[#38bdf8] hover:bg-[#38bdf8]/90 text-black font-semibold text-[13px] px-4 py-1.5 rounded-lg transition cursor-pointer shadow-md"
                >
                  <Sparkles size={14} /> Ask About Current Frame (⌘↵)
                </button>
              </div>
            )}
          </div>
        )}

        {/* VIEW 3: History & Transcripts */}
        {activeView === 'history' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-white/90">
                  Transcripts & History
                </span>
                {onToggleMeetingEnvironment && (
                  <button
                    type="button"
                    onClick={onToggleMeetingEnvironment}
                    className="text-[11px] px-2 py-0.5 rounded-full border border-white/20 bg-white/10 hover:bg-white/20 text-white/80 transition cursor-pointer flex items-center gap-1"
                    title="Toggle between Online Call and Offline Room Diarization"
                  >
                    <span>Mode:</span>
                    <span className="font-semibold text-sky-400 uppercase">
                      {state?.meetingEnvironment === 'offline' ? 'Offline Room' : 'Online Call'}
                    </span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                {/* Real-time audio levels indicator */}
                <div className="flex items-center gap-2 text-[10px] text-white/50">
                  <span className="flex items-center gap-1">
                    Mic: <span className="font-mono text-emerald-400">{Math.round(micLevel * 100)}%</span>
                  </span>
                  <span className="flex items-center gap-1">
                    Sys: <span className="font-mono text-sky-400">{Math.round(systemLevel * 100)}%</span>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleExtractMeetingFacts}
                  disabled={isExtractingFacts || transcripts.length === 0}
                  className="text-[11px] bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 px-2.5 py-1 rounded-md transition cursor-pointer flex items-center gap-1 disabled:opacity-50"
                  title="Analyze full transcript and extract key commitments and facts into Memory Vault"
                >
                  <Brain size={12} />
                  <span>{isExtractingFacts ? 'Extracting...' : 'Extract Meeting Facts'}</span>
                </button>

                <button
                  type="button"
                  onClick={onClearChat}
                  className="text-[11px] text-white/50 hover:text-white px-2 py-0.5 rounded bg-white/5 transition cursor-pointer"
                  title="Start Fresh Chat (⌘R)"
                >
                  Clear (⌘R)
                </button>
              </div>
            </div>

            {/* Fact Extraction Toast Notification */}
            {extractionNotice && (
              <div className="p-2 bg-emerald-950/60 border border-emerald-500/40 rounded-lg text-[12px] text-emerald-300 flex items-center gap-2">
                <Check size={14} className="text-emerald-400" />
                <span>{extractionNotice}</span>
              </div>
            )}

            {/* 4-Track Horizontal Speaker Timeline Bar (Last 60 Seconds) */}
            <div className="bg-black/40 border border-white/10 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-white/50">
                <span className="font-semibold text-white/80">4-Track Speaker Timeline (Last 60s)</span>
                <span className="font-mono text-[10px]">T-60s ─── Now</span>
              </div>

              <div className="space-y-1 pt-1">
                {SPEAKER_TRACK_COLORS.map((color, trackIdx) => {
                  const trackLabel = trackIdx === 0 ? 'Me (Track 0)' : `Speaker ${trackIdx} (Track ${trackIdx})`;
                  // Find segments for this track
                  const trackSegs = recentTimelineSegments.filter((s) => {
                    if (trackIdx === 0) return s.role === 'me';
                    return s.speakerColor === color || (!s.speakerColor && s.role === 'them');
                  });

                  return (
                    <div key={trackIdx} className="flex items-center gap-2">
                      <span className="w-16 text-[10px] text-white/40 truncate font-mono">{trackLabel}</span>
                      <div className="flex-1 h-2.5 bg-white/[0.06] rounded-full relative overflow-hidden">
                        {trackSegs.map((seg) => {
                          const ageMs = now - seg.timestamp;
                          const rightPct = Math.max(0, Math.min(100, (1 - ageMs / timelineWindowMs) * 100));
                          const widthPct = Math.max(2, Math.min(30, (seg.endTimeMs - seg.startTimeMs) / 600));

                          return (
                            <div
                              key={seg.id}
                              style={{
                                left: `${Math.max(0, rightPct - widthPct)}%`,
                                width: `${widthPct}%`,
                                backgroundColor: color,
                              }}
                              className="absolute top-0 bottom-0 rounded-full opacity-85 shadow-sm"
                              title={`${seg.speakerLabel}: ${seg.formattedTimestamp || ''}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live Audio Segments */}
            {transcripts.length > 0 ? (
              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {transcripts.map((seg) => {
                  const speakerColor = seg.speakerColor || (seg.role === 'me' ? '#22c55e' : '#38bdf8');
                  const isSaved = savedMemoryId === seg.id;

                  return (
                    <div
                      key={seg.id}
                      className="group p-2.5 rounded-lg text-[13px] border transition bg-black/30 border-white/[0.08] hover:border-white/20"
                    >
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <div className="flex items-center gap-2">
                          {/* Colored Speaker Avatar Dot */}
                          <span
                            style={{ backgroundColor: speakerColor }}
                            className="w-2.5 h-2.5 rounded-full inline-block shrink-0 shadow-sm"
                          />

                          {/* Speaker Label (Editable inline) */}
                          {editingSpeakerId === seg.speakerId ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={tempSpeakerName}
                                onChange={(e) => setTempSpeakerName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    if (onRenameSpeaker && tempSpeakerName.trim()) {
                                      onRenameSpeaker(seg.speakerId, tempSpeakerName.trim());
                                    }
                                    setEditingSpeakerId(null);
                                  } else if (e.key === 'Escape') {
                                    setEditingSpeakerId(null);
                                  }
                                }}
                                className="bg-black/60 border border-white/30 rounded px-1.5 py-0.5 text-[11px] text-white focus:outline-none"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (onRenameSpeaker && tempSpeakerName.trim()) {
                                    onRenameSpeaker(seg.speakerId, tempSpeakerName.trim());
                                  }
                                  setEditingSpeakerId(null);
                                }}
                                className="p-0.5 hover:text-white"
                              >
                                <Check size={12} className="text-emerald-400" />
                              </button>
                            </div>
                          ) : (
                            <span
                              onClick={() => {
                                setEditingSpeakerId(seg.speakerId);
                                setTempSpeakerName(seg.speakerLabel);
                              }}
                              className="font-semibold uppercase tracking-wider cursor-pointer hover:underline"
                              style={{ color: speakerColor }}
                              title="Click to rename speaker"
                            >
                              {seg.speakerLabel || (seg.role === 'me' ? 'Me' : 'Speaker')}
                            </span>
                          )}

                          {/* Formatted Timestamp Pill [MM:SS.cc - MM:SS.cc] */}
                          <span className="font-mono text-[10px] text-white/50 bg-white/5 px-1.5 py-0.2 rounded border border-white/5">
                            {seg.formattedTimestamp || `[${new Date(seg.timestamp).toLocaleTimeString()}]`}
                          </span>

                          {/* Partial streaming badge */}
                          {seg.isPartial && (
                            <span className="text-[10px] text-amber-300 font-semibold animate-pulse flex items-center gap-1">
                              <span>● streaming</span>
                            </span>
                          )}
                        </div>

                        {/* Save to memory button on hover */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleSaveSegmentToMemory(seg)}
                            className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[10px] text-white/60 hover:text-white bg-white/10 px-1.5 py-0.5 rounded transition cursor-pointer"
                            title="Save this segment to Personal Memory Vault"
                          >
                            {isSaved ? <Check size={10} className="text-emerald-400" /> : <Bookmark size={10} />}
                            <span>{isSaved ? 'Saved' : 'Save to Memory'}</span>
                          </button>
                        </div>
                      </div>

                      {/* Utterance Text with italic streaming indicator */}
                      <p
                        className={`leading-relaxed ${
                          seg.isPartial ? 'italic text-white/70' : 'text-white/95'
                        }`}
                      >
                        {seg.text}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-6 text-center text-white/40 text-[13px]">
                <p>No meeting transcripts recorded yet.</p>
                <p className="text-[12px] text-white/30 mt-1">
                  Click the equalizer icon (|||||) or press ⇧⌘\ to start capturing meeting audio.
                </p>
              </div>
            )}

            {/* Conversation Thread Messages */}
            {chatHistory.length > 0 && (
              <div className="pt-2 border-t border-white/10 space-y-2">
                <span className="text-[12px] text-white/50 uppercase font-bold tracking-wider">
                  Conversation Thread
                </span>
                {chatHistory.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-3 rounded-xl text-[13px] ${
                      msg.role === 'user'
                        ? 'bg-white/10 text-white border border-white/10'
                        : 'bg-black/30 text-white/90 border border-white/[0.06]'
                    }`}
                  >
                    <div className="text-[11px] text-white/50 mb-1 font-semibold uppercase">
                      {msg.role === 'user' ? 'You' : 'Cluely'}
                    </div>
                    <p className="leading-relaxed">{msg.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
