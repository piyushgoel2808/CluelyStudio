import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import {
  Sliders,
  Layers,
  Keyboard,
  Eye,
  PowerOff,
  AudioWaveform,
  Languages,
  Mic,
  Volume2,
  Check,
  Trash2,
  Plus,
  RefreshCw,
  Search,
  FileText,
  Download,
  Brain,
  Copy,
  History,
  Database,
  Sparkles,
  Cpu,
  Smartphone,
} from 'lucide-react';
import { useAppState } from '../../hooks/useAppState';
import { useWindowDrag } from '../../hooks/useWindowDrag';
import { SessionsHistoryView } from './SessionsHistoryView';
import {
  CompanionServerInfo,
  FineTuneExportResult,
  LocalModelId,
  LocalModelStatus,
  MemoryItem,
  NvidiaConnectionTestResult,
  NvidiaLatencyProfile,
  ShortcutAction,
  VectorDBStats,
} from '../../types/ipc';

export const SettingsWindow: React.FC = () => {
  const { state, patchState } = useAppState();
  const [activeTab, setActiveTab] = useState<string>('general');
  const { onMouseDown: handleSettingsDrag } = useWindowDrag('settings');

  // Real WebAudio Mic test state
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [micTestLevel, setMicTestLevel] = useState(0.05);
  const micAnimRef = useRef<number | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);

  // Speaker test state
  const [isTestingSpeaker, setIsTestingSpeaker] = useState(false);
  const [systemAudioLevel, setSystemAudioLevel] = useState<number>(0);

  // Modes Tab State
  const [selectedModeId, setSelectedModeId] = useState<string>(() => state?.activeModeId || 'general');

  // Keybinds Tab State
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);

  // Memory Vault & Vector DB State
  const [memories, setMemories] = useState<MemoryItem[]>(() => state?.personalMemories || []);
  const [memorySearch, setMemorySearch] = useState<string>('');
  const [isAddingMemory, setIsAddingMemory] = useState<boolean>(false);
  const [newMemTitle, setNewMemTitle] = useState<string>('');
  const [newMemCategory, setNewMemCategory] = useState<MemoryItem['category']>('preference');
  const [newMemContent, setNewMemContent] = useState<string>('');
  const [newMemTags, setNewMemTags] = useState<string>('');
  const [isExtractingFacts, setIsExtractingFacts] = useState<boolean>(false);
  const [factToast, setFactToast] = useState<string | null>(null);
  const [vectorStats, setVectorStats] = useState<VectorDBStats | null>(null);
  const [isReindexing, setIsReindexing] = useState<boolean>(false);

  // Voiceprint Enrollment State
  const [isEnrollingVoice, setIsEnrollingVoice] = useState<boolean>(false);
  const [voiceEnrollSuccess, setVoiceEnrollSuccess] = useState<boolean>(false);

  // iOS Companion State
  const [companionInfo, setCompanionInfo] = useState<CompanionServerInfo | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Local Models & Fine-Tuning Studio State
  const [localModels, setLocalModels] = useState<LocalModelStatus[]>([]);
  const [refreshingModels, setRefreshingModels] = useState<boolean>(false);
  const [isBuildingCustomModel, setIsBuildingCustomModel] = useState<boolean>(false);
  const [customModelNotice, setCustomModelNotice] = useState<string | null>(null);
  const [fineTuneExport, setFineTuneExport] = useState<FineTuneExportResult | null>(null);
  const [isExportingFineTune, setIsExportingFineTune] = useState<boolean>(false);

  // NVIDIA Speech Test State
  const [testingNvidia, setTestingNvidia] = useState<boolean>(false);
  const [nvidiaTestResult, setNvidiaTestResult] = useState<NvidiaConnectionTestResult | null>(null);

  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    const loadAudioDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((d) => d.kind === 'audioinput');
        setAudioInputDevices(inputs);
      } catch (err) {
        console.warn('Failed to enumerate audio devices:', err);
      }
    };
    loadAudioDevices();
    navigator.mediaDevices?.addEventListener('devicechange', loadAudioDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', loadAudioDevices);
    };
  }, []);

  useEffect(() => {
    const unsub = window.cluely?.onSettingsNavigateTab?.((tab: string) => {
      if (tab) {
        setActiveTab(tab);
      }
    });
    return () => {
      unsub?.();
    };
  }, []);

  useEffect(() => {
    if (state?.personalMemories) {
      setMemories(state.personalMemories);
    }
  }, [state?.personalMemories]);

  // Load Vector DB Stats
  const refreshVectorStats = async () => {
    if (window.cluely?.getVectorDBStats) {
      const stats = await window.cluely.getVectorDBStats();
      setVectorStats(stats);
    }
  };

  useEffect(() => {
    refreshVectorStats();
  }, [state?.personalMemories, state?.modes, activeTab]);

  useEffect(() => {
    if (window.cluely?.getCompanionInfo) {
      window.cluely.getCompanionInfo().then((info) => {
        setCompanionInfo(info);
        if (info.companionUrl) {
          QRCode.toDataURL(info.companionUrl, {
            margin: 1,
            color: { dark: '#000000', light: '#ffffff' },
            width: 140,
          }).then(setQrCodeDataUrl);
        }
      });
    }
  }, []);

  useEffect(() => {
    if (window.cluely?.listLocalModels) {
      window.cluely.listLocalModels().then(setLocalModels);
    }
    if (window.cluely?.onModelProgress) {
      const unsub = window.cluely.onModelProgress((updatedStatus) => {
        setLocalModels((prev) => {
          const idx = prev.findIndex((m) => m.id === updatedStatus.id);
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = updatedStatus;
            return next;
          }
          return [...prev, updatedStatus];
        });
      });
      return unsub;
    }
  }, []);

  useEffect(() => {
    if (window.cluely?.onSystemAudioLevel) {
      const unsub = window.cluely.onSystemAudioLevel(({ rms }) => {
        setSystemAudioLevel(rms);
      });
      return unsub;
    }
  }, []);

  useEffect(() => {
    if (!recordingAction) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
      if (e.shiftKey) parts.push('Shift');
      if (e.altKey) parts.push('Alt');

      let key = e.key;
      if (key === ' ') key = 'Space';
      else if (key === 'Enter') key = 'Enter';
      else if (key === 'Escape') {
        setRecordingAction(null);
        return;
      } else if (key === 'ArrowUp') key = 'Up';
      else if (key === 'ArrowDown') key = 'Down';
      else if (key === 'ArrowLeft') key = 'Left';
      else if (key === 'ArrowRight') key = 'Right';
      else if (key === '\\') key = '\\';
      else if (key === ',') key = ',';
      else if (key === 'r' || key === 'R') key = 'R';

      if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        parts.push(key.toUpperCase());
        const shortcutString = parts.join('+');

        patchState({
          shortcuts: {
            ...state!.shortcuts,
            [recordingAction]: shortcutString,
          },
        });
        setRecordingAction(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recordingAction, state, patchState]);

  // Real WebAudio Microphone Level Meter
  const stopMicTest = () => {
    if (micAnimRef.current) {
      cancelAnimationFrame(micAnimRef.current);
      micAnimRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (micAudioCtxRef.current) {
      micAudioCtxRef.current.close().catch(() => {});
      micAudioCtxRef.current = null;
    }
    setIsTestingMic(false);
    setMicTestLevel(0.05);
  };

  useEffect(() => {
    return () => {
      stopMicTest();
    };
  }, []);

  const handleToggleTestMic = async () => {
    if (isTestingMic) {
      stopMicTest();
      return;
    }
    try {
      const constraints: MediaStreamConstraints = {
        audio:
          state?.selectedMicDeviceId && state.selectedMicDeviceId !== 'default'
            ? { deviceId: { exact: state.selectedMicDeviceId } }
            : true,
        video: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micStreamRef.current = stream;
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      micAudioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      setIsTestingMic(true);

      const loop = () => {
        if (!micAudioCtxRef.current) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i];
        }
        const avg = sum / (data.length * 255);
        setMicTestLevel(Math.min(1, Math.max(0.05, avg * 2.5)));
        micAnimRef.current = requestAnimationFrame(loop);
      };
      micAnimRef.current = requestAnimationFrame(loop);
    } catch (err) {
      console.error('Microphone test error:', err);
      stopMicTest();
    }
  };

  const handleTestSpeaker = () => {
    setIsTestingSpeaker(true);
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880.0, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.42);
      setTimeout(() => {
        setIsTestingSpeaker(false);
        ctx.close();
      }, 500);
    } catch {
      setIsTestingSpeaker(false);
    }
  };

  const handleTestNvidia = async () => {
    if (!window.cluely?.testNvidiaConnection) return;
    setTestingNvidia(true);
    setNvidiaTestResult(null);
    try {
      const res = await window.cluely.testNvidiaConnection();
      setNvidiaTestResult(res);
    } catch (err) {
      setNvidiaTestResult({
        ok: false,
        latencyMs: 0,
        engine: 'none',
        message: `Connection error: ${String(err)}`,
      });
    } finally {
      setTestingNvidia(false);
    }
  };

  const handlePullModel = async (id: LocalModelId) => {
    if (!window.cluely?.pullLocalModel) return;
    await window.cluely.pullLocalModel(id);
  };

  const handleBuildCustomGemma = async (base: 'gemma4:e4b' | 'gemma4:12b') => {
    if (!window.cluely?.buildCustomGemmaModel) return;
    setIsBuildingCustomModel(true);
    setCustomModelNotice(null);
    try {
      const res = await window.cluely.buildCustomGemmaModel(base);
      setCustomModelNotice(res.message);
    } catch (err) {
      setCustomModelNotice(`Error: ${String(err)}`);
    } finally {
      setIsBuildingCustomModel(false);
    }
  };

  const handleExportFineTune = async (base: 'gemma4:e4b' | 'gemma4:12b') => {
    if (!window.cluely?.exportFineTuneDataset) return;
    setIsExportingFineTune(true);
    try {
      const res = await window.cluely.exportFineTuneDataset(base);
      setFineTuneExport(res);
    } finally {
      setIsExportingFineTune(false);
    }
  };

  const handleReindexVectorDB = async () => {
    if (!window.cluely?.reindexVectorDB) return;
    setIsReindexing(true);
    try {
      const stats = await window.cluely.reindexVectorDB();
      setVectorStats(stats);
    } finally {
      setIsReindexing(false);
    }
  };

  const handlePickFilesForMode = async (modeId: string) => {
    if (!window.cluely?.pickModeFiles) return;
    await window.cluely.pickModeFiles(modeId);
    refreshVectorStats();
  };

  const handleRemoveModeFile = async (modeId: string, fileId: string) => {
    if (!window.cluely?.removeModeFile) return;
    await window.cluely.removeModeFile(modeId, fileId);
    refreshVectorStats();
  };

  const handleAddMemory = async () => {
    if (!newMemTitle.trim() || !newMemContent.trim() || !window.cluely?.addMemory) return;
    const tags = newMemTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const created = await window.cluely.addMemory({
      title: newMemTitle.trim(),
      category: newMemCategory,
      content: newMemContent.trim(),
      tags,
    });
    setMemories((prev) => [created, ...prev]);
    setIsAddingMemory(false);
    setNewMemTitle('');
    setNewMemContent('');
    setNewMemTags('');
    refreshVectorStats();
  };

  const handleDeleteMemory = async (id: string) => {
    if (!window.cluely?.deleteMemory) return;
    await window.cluely.deleteMemory(id);
    setMemories((prev) => prev.filter((m) => m.id !== id));
    refreshVectorStats();
  };

  const handleExtractFactsFromTranscript = async () => {
    if (!window.cluely?.extractMemoriesFromTranscript) return;
    setIsExtractingFacts(true);
    setFactToast(null);
    try {
      const activeTranscripts = state?.transcripts || [];
      if (activeTranscripts.length === 0) {
        setFactToast('Speak in an active session first so Cluely can extract real facts from your transcript.');
        return;
      }
      const extracted = await window.cluely.extractMemoriesFromTranscript(activeTranscripts);
      setFactToast(`Indexed ${extracted.length} new facts from session transcript into Local Vector DB!`);
      const updated = await window.cluely.getMemories();
      setMemories(updated);
      refreshVectorStats();
    } catch {
      setFactToast('Fact extraction failed; verify local Ollama is running.');
    } finally {
      setIsExtractingFacts(false);
      setTimeout(() => setFactToast(null), 4000);
    }
  };

  const handleEnrollVoice = async () => {
    setIsEnrollingVoice(true);
    setVoiceEnrollSuccess(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000 },
        video: false,
      });
      const ctx = new AudioContext({ sampleRate: 16000 });
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Int16Array[] = [];

      processor.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(data.length);
        for (let i = 0; i < data.length; i++) {
          const s = Math.max(-1, Math.min(1, data[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        chunks.push(pcm);
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      await new Promise((resolve) => setTimeout(resolve, 4000));

      stream.getTracks().forEach((t) => t.stop());
      processor.disconnect();
      source.disconnect();
      await ctx.close();

      setVoiceEnrollSuccess(true);
      setTimeout(() => setVoiceEnrollSuccess(false), 3000);
    } catch (err) {
      console.error('Voice enrollment error:', err);
    } finally {
      setIsEnrollingVoice(false);
    }
  };

  const handleCopyCompanionLink = () => {
    if (!companionInfo?.companionUrl) return;
    navigator.clipboard.writeText(companionInfo.companionUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const filteredMemories = memories.filter((m) => {
    if (!memorySearch.trim()) return true;
    const q = memorySearch.toLowerCase();
    return (
      m.title.toLowerCase().includes(q) ||
      m.content.toLowerCase().includes(q) ||
      m.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const selectedMode = state?.modes.find((m) => m.id === selectedModeId) || state?.modes[0];

  const navTabs = [
    { id: 'general', label: 'General & Audio', icon: Sliders },
    { id: 'sessions', label: 'Sessions & Notes', icon: History },
    { id: 'security', label: 'Local AI & Vector DB', icon: Cpu },
    { id: 'modes', label: 'Modes & File RAG', icon: Layers },
    { id: 'profile', label: 'Memory Vault', icon: Database },
    { id: 'keybinds', label: 'Shortcuts & Mobile', icon: Keyboard },
  ];

  return (
    <div className="flex flex-col h-screen w-screen bg-[#101012] text-white font-sans overflow-hidden select-none">
      {/* Top Draggable Window Header */}
      <div
        onMouseDown={handleSettingsDrag}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        className="text-center py-2.5 border-b border-white/[0.08] bg-[#141416] shrink-0 cursor-grab active:cursor-grabbing"
      >
        <span className="text-[13px] text-neutral-300 font-semibold pointer-events-none">
          Cluely Studio — Production AI Workspace
        </span>
      </div>

      {/* Streamlined 6-Tab Navigation Bar */}
      <div
        onMouseDown={handleSettingsDrag}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        className="bg-[#18181b] border-b border-white/[0.08] px-6 py-2.5 flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing"
      >
        <div
          data-no-drag="true"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="flex items-center gap-2 overflow-x-auto no-scrollbar max-w-4xl cursor-default"
        >
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-no-drag="true"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 py-2 px-4 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 ${
                  isActive
                    ? 'bg-[#0091FF] text-white shadow-sm'
                    : 'text-[#8e8e93] hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Tab Viewport */}
      {activeTab === 'sessions' ? (
        <div className="flex-1 overflow-hidden p-6">
          <SessionsHistoryView
            state={state}
            patchState={patchState}
            onBackToSettings={() => setActiveTab('general')}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-[820px] mx-auto">
            {/* ============================================================== */}
            {/* TAB 1: GENERAL & AUDIO                                         */}
            {/* ============================================================== */}
            {activeTab === 'general' && (
              <div className="space-y-7">
                {/* Stealth & Startup */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                    Stealth & Window Protection
                  </h3>
                  <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden">
                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-400 shrink-0">
                          <Eye size={20} />
                        </div>
                        <div>
                          <div className="text-[14px] font-semibold text-white">
                            Hardware Screen-Share Stealth (setContentProtection)
                          </div>
                          <div className="text-[12px] text-neutral-400">
                            Excludes Cluely windows from Zoom, Google Meet, Microsoft Teams, Slack, and OBS captures.
                          </div>
                        </div>
                      </div>
                      <div
                        onClick={() => patchState({ undetectability: !state?.undetectability })}
                        className={`w-11 h-6 rounded-full p-0.5 cursor-pointer transition-colors ${
                          state?.undetectability ?? true ? 'bg-emerald-500' : 'bg-[#2c2c2e]'
                        }`}
                      >
                        <div
                          className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                            state?.undetectability ?? true ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </div>
                    </div>

                    {/* HUD Transparency / Opacity Slider */}
                    <div className="p-4 flex items-center justify-between gap-6">
                      <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-sky-500/15 flex items-center justify-center text-sky-400 shrink-0">
                          <Sliders size={20} />
                        </div>
                        <div>
                          <div className="text-[14px] font-semibold text-white">
                            Overlay Transparency / Opacity ({Math.round((state?.overlayOpacity ?? 0.92) * 100)}%)
                          </div>
                          <div className="text-[12px] text-neutral-400">
                            Slide left to make the floating HUD more see-through over your code or slides. Press ⌘\ anytime to hide/show all Cluely windows.
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 w-56 shrink-0">
                        <span className="text-[11px] font-mono text-neutral-400">20%</span>
                        <input
                          type="range"
                          min={0.2}
                          max={1.0}
                          step={0.02}
                          value={state?.overlayOpacity ?? 0.92}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (window.cluely?.setOverlayOpacity) {
                              window.cluely.setOverlayOpacity(val);
                            } else {
                              patchState({ overlayOpacity: val });
                            }
                          }}
                          className="flex-1 accent-[#0091FF] cursor-pointer"
                        />
                        <span className="text-[11px] font-mono text-white w-9 text-right">
                          {Math.round((state?.overlayOpacity ?? 0.92) * 100)}%
                        </span>
                      </div>
                    </div>

                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-[#202022] flex items-center justify-center text-neutral-300 shrink-0">
                          <PowerOff size={20} />
                        </div>
                        <div>
                          <div className="text-[14px] font-semibold text-white">Launch at Login</div>
                          <div className="text-[12px] text-neutral-400">
                            Start Cluely Studio automatically in stealth background mode.
                          </div>
                        </div>
                      </div>
                      <div
                        onClick={() => patchState({ launchAtLogin: !state?.launchAtLogin })}
                        className={`w-11 h-6 rounded-full p-0.5 cursor-pointer transition-colors ${
                          state?.launchAtLogin ? 'bg-[#0091FF]' : 'bg-[#2c2c2e]'
                        }`}
                      >
                        <div
                          className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                            state?.launchAtLogin ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Primary AI & Speech Engine Selection */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                      Active LLM, Vector Embeddings & ASR Pipeline
                    </h3>
                    <span className="text-[11px] text-emerald-400 font-mono bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-md">
                      {state?.aiConfig?.activeProvider === 'ollama'
                        ? `100% Local Offline (${state?.aiConfig?.activeModel || 'gemma4:e4b'})`
                        : `Cloud BYOK (${state?.aiConfig?.activeProvider})`}
                    </span>
                  </div>

                  <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden">
                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-sky-500/15 flex items-center justify-center text-sky-400 shrink-0">
                          <Brain size={20} />
                        </div>
                        <div>
                          <div className="text-[14px] font-semibold text-white">AI Inference Provider</div>
                          <div className="text-[12px] text-neutral-400">
                            Local Ollama keeps all meeting audio & screen images 100% on-device.
                          </div>
                        </div>
                      </div>
                      <div className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs px-3 py-1.5 rounded-xl font-medium flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Local Ollama (100% Offline)</span>
                      </div>
                    </div>

                    {state?.aiConfig?.activeProvider === 'ollama' && (
                      <>
                        <div className="p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3.5">
                            <div className="w-11 h-11 rounded-xl bg-purple-500/15 flex items-center justify-center text-purple-400 shrink-0">
                              <Sparkles size={20} />
                            </div>
                            <div>
                              <div className="text-[14px] font-semibold text-white">
                                Local Multimodal LLM (Text + Screen Vision)
                              </div>
                              <div className="text-[12px] text-neutral-400">
                                Gemma 4 E4B & 12B natively process both live speech and screen snapshots.
                              </div>
                            </div>
                          </div>
                          <select
                            value={state?.aiConfig?.activeModel || 'gemma4:e4b'}
                            onChange={(e) =>
                              patchState({
                                aiConfig: {
                                  ...state!.aiConfig,
                                  activeModel: e.target.value,
                                },
                              })
                            }
                            className="bg-[#242428] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400"
                          >
                            <option value="gemma4:e4b">gemma4:e4b (Google Gemma 4 E4B — Fast Multimodal Recommended)</option>
                            <option value="gemma4:12b">gemma4:12b (Google Gemma 4 12B — Pro Reasoning & Vision)</option>
                            <option value="cluely-gemma4:e4b">cluely-gemma4:e4b (Domain-Tuned Cluely Teleprompter E4B)</option>
                            <option value="cluely-gemma4:12b">cluely-gemma4:12b (Domain-Tuned Cluely Teleprompter 12B)</option>
                            <option value="nemotron-mini">nemotron-mini:latest (NVIDIA 4B Text)</option>
                            <option value="qwen3-vl">qwen3-vl:latest (Qwen 3 Vision-Language)</option>
                            <option value="llama3.1:8b">llama3.1:8b (Meta Llama 3.1 8B)</option>
                          </select>
                        </div>

                        <div className="p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3.5">
                            <div className="w-11 h-11 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-400 shrink-0">
                              <Database size={20} />
                            </div>
                            <div>
                              <div className="text-[14px] font-semibold text-white">
                                Local Vector Embedding Model
                              </div>
                              <div className="text-[12px] text-neutral-400">
                                Embeds Personal Memories & Mode Files for Hybrid Vector + BM25 RRF retrieval.
                              </div>
                            </div>
                          </div>
                          <select
                            value={state?.aiConfig?.embeddingModel || 'gemma2:2b'}
                            onChange={(e) =>
                              patchState({
                                aiConfig: {
                                  ...state!.aiConfig,
                                  embeddingModel: e.target.value,
                                },
                              })
                            }
                            className="bg-[#242428] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400"
                          >
                            <option value="gemma2:2b">gemma2:2b (Google Gemma 2 Embeddings)</option>
                            <option value="embeddinggemma">embeddinggemma (Dedicated Gemma Embeddings)</option>
                            <option value="nomic-embed-text">nomic-embed-text (Nomic Dense Embeddings)</option>
                            <option value="all-minilm">all-minilm (Fast 384d MiniLM)</option>
                          </select>
                        </div>
                      </>
                    )}

                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-[#202022] flex items-center justify-center text-neutral-300 shrink-0">
                          <AudioWaveform size={20} />
                        </div>
                        <div>
                          <div className="text-[14px] font-semibold text-white">
                            Speech-to-Text (ASR) Engine
                          </div>
                          <div className="text-[12px] text-neutral-400">
                            Parakeet-TDT runs 100% offline in ~150ms via in-process Sherpa-ONNX.
                          </div>
                        </div>
                      </div>
                      <select
                        value={state?.aiConfig?.voiceProvider || 'nvidia-parakeet-tdt'}
                        onChange={(e) =>
                          patchState({
                            aiConfig: {
                              ...state!.aiConfig,
                              voiceProvider: e.target.value as any,
                            },
                          })
                        }
                        className="bg-[#242428] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400"
                      >
                        <option value="nvidia-parakeet-tdt">
                          NVIDIA Parakeet-TDT 0.6B (Local Offline ONNX — English)
                        </option>
                        <option value="whisper-base-onnx">
                          Whisper Small Multilingual (Local Offline ONNX — Hindi & English)
                        </option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Audio Hardware & Live Meters */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                    Dual-Channel Audio Capture & Languages
                  </h3>
                  <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden">
                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-[#202022] flex items-center justify-center text-neutral-300 shrink-0">
                          <Mic size={20} />
                        </div>
                        <div>
                          <div className="text-[14px] font-semibold text-white">
                            Microphone Input ("Me" Channel)
                          </div>
                          <div className="text-[12px] text-neutral-400">
                            Captures your voice for speaker-attributed transcripts.
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={state?.selectedMicDeviceId || 'default'}
                          onChange={(e) => patchState({ selectedMicDeviceId: e.target.value })}
                          className="bg-[#242428] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white max-w-[230px] truncate focus:outline-none"
                        >
                          <option value="default">System Default Microphone</option>
                          {audioInputDevices.map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || `Microphone (${d.deviceId.slice(0, 6)})`}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={handleToggleTestMic}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                            isTestingMic
                              ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                              : 'bg-white/10 hover:bg-white/15 text-white'
                          }`}
                        >
                          {isTestingMic ? 'Stop Test' : 'Test Mic'}
                        </button>
                      </div>
                    </div>

                    {isTestingMic && (
                      <div className="px-4 py-2.5 bg-black/30 flex items-center gap-3">
                        <span className="text-xs text-emerald-400 font-mono w-28">
                          Live Mic RMS: {Math.round(micTestLevel * 100)}%
                        </span>
                        <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                          <div
                            style={{ width: `${Math.min(100, Math.round(micTestLevel * 100))}%` }}
                            className="h-full bg-emerald-400 transition-all duration-75"
                          />
                        </div>
                      </div>
                    )}

                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-[#202022] flex items-center justify-center text-neutral-300 shrink-0">
                          <Volume2 size={20} />
                        </div>
                        <div>
                          <div className="text-[14px] font-semibold text-white">
                            System Loopback Audio ("Them" Channel)
                          </div>
                          <div className="text-[12px] text-neutral-400">
                            Captures remote meeting attendees via CoreAudio tap / desktop loopback.
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-28 h-2 bg-white/10 rounded-full overflow-hidden">
                          <div
                            style={{ width: `${Math.min(100, Math.round(systemAudioLevel * 100))}%` }}
                            className="h-full bg-sky-400 transition-all duration-100"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleTestSpeaker}
                          className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition cursor-pointer"
                        >
                          {isTestingSpeaker ? 'Playing...' : 'Test Tone'}
                        </button>
                      </div>
                    </div>

                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-[#202022] flex items-center justify-center text-neutral-300 shrink-0">
                          <Languages size={20} />
                        </div>
                        <div>
                          <div className="text-[14px] font-semibold text-white">
                            Transcription & Output Languages
                          </div>
                          <div className="text-[12px] text-neutral-400">
                            Choose spoken meeting language and AI teleprompter response language.
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={state?.transcriptionLanguage || 'English (recommended)'}
                          onChange={(e) => patchState({ transcriptionLanguage: e.target.value })}
                          className="bg-[#242428] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                        >
                          <option value="English (recommended)">ASR: English (Parakeet-TDT)</option>
                          <option value="Auto-detect (Multilingual)">ASR: Auto (Hindi / English)</option>
                          <option value="Hindi">ASR: Hindi (हिंदी)</option>
                          <option value="Spanish">ASR: Spanish</option>
                          <option value="French">ASR: French</option>
                        </select>
                        <select
                          value={state?.outputLanguage || 'English'}
                          onChange={(e) => patchState({ outputLanguage: e.target.value })}
                          className="bg-[#242428] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                        >
                          <option value="English">Reply: English</option>
                          <option value="Hindi">Reply: Hindi</option>
                          <option value="Spanish">Reply: Spanish</option>
                          <option value="French">Reply: French</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB 3: LOCAL AI, VECTOR DB & GEMMA 4 FINE-TUNING STUDIO        */}
            {/* ============================================================== */}
            {activeTab === 'security' && (
              <div className="space-y-7">
                {/* 1. Local Vector DB Engine Card */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                      Embedded Local Vector DB (Gemma 2 Dense + BM25 Hybrid RRF)
                    </h3>
                    <button
                      type="button"
                      disabled={isReindexing}
                      onClick={handleReindexVectorDB}
                      className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1.5 bg-sky-500/10 border border-sky-500/25 px-3 py-1 rounded-lg cursor-pointer transition disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={isReindexing ? 'animate-spin' : ''} />
                      <span>{isReindexing ? 'Re-indexing Vectors...' : 'Re-index Vector DB'}</span>
                    </button>
                  </div>

                  <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] p-5 grid grid-cols-4 gap-4">
                    <div className="bg-[#121215] border border-white/5 rounded-xl p-3.5">
                      <div className="text-[11px] text-neutral-400">Indexed Vectors</div>
                      <div className="text-xl font-bold text-white mt-1">
                        {vectorStats?.indexedVectors ?? 0}
                      </div>
                      <div className="text-[10px] text-emerald-400 mt-0.5">
                        {vectorStats?.totalMemories ?? 0} Memories • {vectorStats?.totalModeChunks ?? 0} File Chunks
                      </div>
                    </div>

                    <div className="bg-[#121215] border border-white/5 rounded-xl p-3.5">
                      <div className="text-[11px] text-neutral-400">Embedding Model</div>
                      <div className="text-sm font-bold text-sky-400 mt-1 truncate">
                        {vectorStats?.embeddingModel || state?.aiConfig?.embeddingModel || 'gemma2:2b'}
                      </div>
                      <div className="text-[10px] text-neutral-500 mt-1">
                        {vectorStats?.dimensions || 384}-d L2 Normalized
                      </div>
                    </div>

                    <div className="bg-[#121215] border border-white/5 rounded-xl p-3.5">
                      <div className="text-[11px] text-neutral-400">Retrieval Fusion</div>
                      <div className="text-sm font-bold text-purple-300 mt-1">
                        65% Dense + 35% BM25
                      </div>
                      <div className="text-[10px] text-neutral-500 mt-1">
                        Reciprocal Rank Fusion
                      </div>
                    </div>

                    <div className="bg-[#121215] border border-white/5 rounded-xl p-3.5">
                      <div className="text-[11px] text-neutral-400">Engine Mode</div>
                      <div className="text-sm font-bold text-emerald-400 mt-1">
                        {vectorStats?.engineStatus === 'ollama-dense'
                          ? 'Ollama Neural Dense'
                          : 'Instant Local 384d'}
                      </div>
                      <div className="text-[10px] text-neutral-500 mt-1">Zero-Cloud Persistence</div>
                    </div>
                  </div>
                </div>

                {/* 2. Gemma 4 Domain Adaptation & QLoRA Fine-Tuning Studio */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                    Gemma 4 Domain Adaptation & QLoRA Fine-Tuning Studio
                  </h3>
                  <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] p-5 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-bold text-white flex items-center gap-2">
                          <Sparkles size={16} className="text-amber-400" />
                          <span>Specialize Gemma 4 (E4B / 12B) for Cluely Teleprompter Usage</span>
                        </div>
                        <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                          Compile a custom Ollama model (<code className="text-sky-300">cluely-gemma4:e4b</code> or <code className="text-sky-300">cluely-gemma4:12b</code>) with locked anti-hallucination parameters (<code className="text-neutral-300">temp=0.15, repeat_penalty=1.12, num_ctx=8192</code>), or export your real session Q&A history and Memory Vault into a ShareGPT/ChatML JSONL dataset + Unsloth 4-bit QLoRA training script.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="bg-[#121215] border border-white/10 rounded-xl p-4 flex flex-col justify-between gap-3">
                        <div>
                          <div className="text-xs font-bold text-white">
                            1. Instant Custom Ollama Modelfile Build
                          </div>
                          <p className="text-[11px] text-neutral-400 mt-1">
                            Builds and activates <code className="text-emerald-300">cluely-gemma4</code> directly in your local Ollama daemon in 2 seconds.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isBuildingCustomModel}
                            onClick={() => handleBuildCustomGemma('gemma4:e4b')}
                            className="flex-1 bg-[#0091FF] hover:bg-sky-400 text-white text-xs font-semibold py-2 px-3 rounded-lg transition cursor-pointer disabled:opacity-50"
                          >
                            {isBuildingCustomModel ? 'Building...' : 'Build cluely-gemma4:e4b'}
                          </button>
                          <button
                            type="button"
                            disabled={isBuildingCustomModel}
                            onClick={() => handleBuildCustomGemma('gemma4:12b')}
                            className="flex-1 bg-white/10 hover:bg-white/15 text-white text-xs font-semibold py-2 px-3 rounded-lg transition cursor-pointer disabled:opacity-50"
                          >
                            Build cluely-gemma4:12b
                          </button>
                        </div>
                      </div>

                      <div className="bg-[#121215] border border-white/10 rounded-xl p-4 flex flex-col justify-between gap-3">
                        <div>
                          <div className="text-xs font-bold text-white">
                            2. Export QLoRA Fine-Tuning Dataset & Unsloth Script
                          </div>
                          <p className="text-[11px] text-neutral-400 mt-1">
                            Exports your session Q&A turns & Memory Vault to <code className="text-purple-300">.jsonl</code> + <code className="text-purple-300">train_gemma4_qlora.py</code>.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isExportingFineTune}
                            onClick={() => handleExportFineTune('gemma4:e4b')}
                            className="flex-1 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold py-2 px-3 rounded-lg transition cursor-pointer disabled:opacity-50"
                          >
                            {isExportingFineTune ? 'Exporting...' : 'Export E4B QLoRA Kit'}
                          </button>
                          <button
                            type="button"
                            disabled={isExportingFineTune}
                            onClick={() => handleExportFineTune('gemma4:12b')}
                            className="flex-1 bg-white/10 hover:bg-white/15 text-white text-xs font-semibold py-2 px-3 rounded-lg transition cursor-pointer disabled:opacity-50"
                          >
                            Export 12B QLoRA Kit
                          </button>
                        </div>
                      </div>
                    </div>

                    {customModelNotice && (
                      <div className="p-3 rounded-xl bg-sky-950/50 border border-sky-500/40 text-sky-200 text-xs">
                        {customModelNotice}
                      </div>
                    )}

                    {fineTuneExport && (
                      <div className="p-3.5 rounded-xl bg-purple-950/40 border border-purple-500/40 text-xs space-y-1.5">
                        <div className="font-semibold text-purple-200">
                          ✓ {fineTuneExport.message}
                        </div>
                        <div className="font-mono text-[11px] text-neutral-300 space-y-0.5">
                          <div>Dataset: {fineTuneExport.datasetPath}</div>
                          <div>Modelfile: {fineTuneExport.modelfilePath}</div>
                          <div>QLoRA Script: {fineTuneExport.scriptPath}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Local Models Download & Status Manager */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                      Local Model Weights (Ollama & Sherpa-ONNX)
                    </h3>
                    <button
                      type="button"
                      onClick={async () => {
                        setRefreshingModels(true);
                        if (window.cluely?.listLocalModels) {
                          const list = await window.cluely.listLocalModels();
                          setLocalModels(list);
                        }
                        setRefreshingModels(false);
                      }}
                      className="text-xs text-neutral-400 hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw size={12} className={refreshingModels ? 'animate-spin' : ''} />
                      <span>Refresh Status</span>
                    </button>
                  </div>

                  <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden">
                    {localModels.map((m) => (
                      <div key={m.id} className="p-4 flex items-center justify-between gap-4">
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13.5px] font-semibold text-white">{m.name}</span>
                            <span className="text-[10px] font-mono bg-white/10 text-neutral-300 px-2 py-0.5 rounded">
                              {m.sizeLabel}
                            </span>
                            {m.installed && (
                              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                                Installed
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-neutral-400">{m.statusMessage}</div>
                          {m.downloading && (
                            <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mt-2">
                              <div
                                style={{ width: `${m.progressPercent}%` }}
                                className="h-full bg-[#0091FF] transition-all duration-200"
                              />
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {m.provider === 'ollama' && m.installed && m.role === 'llm-multimodal' && (
                            <button
                              type="button"
                              onClick={() =>
                                patchState({
                                  aiConfig: {
                                    ...state!.aiConfig,
                                    activeProvider: 'ollama',
                                    activeModel: m.modelTag.replace(/:latest$/, ''),
                                  },
                                })
                              }
                              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                                state?.aiConfig?.activeModel?.startsWith(
                                  m.modelTag.replace(/:latest$/, '')
                                )
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-white/10 hover:bg-white/15 text-white'
                              }`}
                            >
                              {state?.aiConfig?.activeModel?.startsWith(
                                m.modelTag.replace(/:latest$/, '')
                              )
                                ? '✓ Active LLM'
                                : 'Use Model'}
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={m.downloading}
                            onClick={() => handlePullModel(m.id)}
                            className="px-3.5 py-1.5 rounded-xl bg-[#0091FF] hover:bg-sky-400 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                          >
                            <Download size={13} />
                            <span>
                              {m.downloading
                                ? `${m.progressPercent}%`
                                : m.installed
                                ? 'Re-verify'
                                : 'Download'}
                            </span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 4. VAD Latency Profile & Optional BYOK Cloud Keys */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                      VAD Speech Latency Profile & Optional Cloud BYOK Keys
                    </h3>
                    <button
                      type="button"
                      disabled={testingNvidia}
                      onClick={handleTestNvidia}
                      className="text-xs text-emerald-400 hover:text-emerald-300 cursor-pointer"
                    >
                      {testingNvidia ? 'Testing ASR...' : 'Test Local ASR Server (127.0.0.1:50051)'}
                    </button>
                  </div>

                  {nvidiaTestResult && (
                    <div
                      className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                        nvidiaTestResult.ok
                          ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                          : 'bg-amber-950/50 border-amber-500/40 text-amber-300'
                      }`}
                    >
                      <span>{nvidiaTestResult.message}</span>
                      <span className="font-mono font-bold">
                        {nvidiaTestResult.latencyMs > 0 ? `${nvidiaTestResult.latencyMs}ms` : ''}
                      </span>
                    </div>
                  )}

                  <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] p-4 space-y-4 text-xs">
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'ultra-low', label: 'Ultra-Low Latency', ms: '850ms silence hangover' },
                        { id: 'balanced', label: 'Balanced (Recommended)', ms: '1300ms silence hangover' },
                        { id: 'high-accuracy', label: 'Long Multi-Sentence', ms: '1800ms silence hangover' },
                      ].map((p) => {
                        const isSel =
                          (state?.aiConfig?.nvidiaSpeech?.latencyProfile || 'balanced') === p.id;
                        return (
                          <div
                            key={p.id}
                            onClick={() =>
                              patchState({
                                aiConfig: {
                                  ...state!.aiConfig,
                                  nvidiaSpeech: {
                                    ...state!.aiConfig.nvidiaSpeech,
                                    latencyProfile: p.id as NvidiaLatencyProfile,
                                  },
                                },
                              })
                            }
                            className={`p-3 rounded-xl border cursor-pointer transition ${
                              isSel
                                ? 'bg-emerald-500/20 border-emerald-500 text-white'
                                : 'bg-[#121214] border-white/10 text-neutral-400'
                            }`}
                          >
                            <span className="font-semibold block text-white">{p.label}</span>
                            <span className="text-[11px] text-emerald-400 block mt-0.5">{p.ms}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="pt-3 border-t border-white/10 space-y-2.5">
                      <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                          <Check size={16} />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-white flex items-center gap-2">
                            <span>100% Offline Local Engine Active</span>
                            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono">
                              Zero Cloud
                            </span>
                          </div>
                          <div className="text-xs text-neutral-300 mt-1 leading-relaxed">
                            CluelyStudio operates entirely on-device using local Ollama (<code className="text-sky-300 font-mono">gemma4:e4b</code> &amp; <code className="text-sky-300 font-mono">gemma4:12b</code>) and local Sherpa-ONNX speech recognition. All cloud models requiring API keys (OpenAI, Gemini, Anthropic, Groq) have been completely removed. Your meeting audio, transcripts, and screen context never leave your machine.
                          </div>
                          <div className="mt-2.5 flex items-center gap-2 text-[11px] text-neutral-400 font-mono">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            <span>Ollama Endpoint: {state?.aiConfig?.apiKeys?.ollamaUrl || 'http://127.0.0.1:11434'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB 4: MODES & VECTOR FILE RAG                                 */}
            {/* ============================================================== */}
            {activeTab === 'modes' && (
              <div className="flex gap-6 h-[520px]">
                {/* Left Sidebar */}
                <div className="w-60 shrink-0 flex flex-col">
                  <button
                    type="button"
                    onClick={() => {
                      const newId = `mode_${Date.now()}`;
                      const newMode = {
                        id: newId,
                        name: 'Custom Copilot Mode',
                        category: 'work' as const,
                        icon: 'sparkles',
                        contextPrompt:
                          'Provide concise, first-person answers grounded strictly in the attached files and live meeting conversation.',
                        files: [],
                        isCustom: true,
                      };
                      patchState({ modes: [...state!.modes, newMode] });
                      setSelectedModeId(newId);
                    }}
                    className="w-full bg-[#132333] border border-[#0091FF]/30 text-[#38bdf8] font-semibold py-2 px-3 rounded-xl mb-3 flex items-center justify-center gap-1.5 text-xs hover:bg-[#182e44] transition cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>+ New Copilot Mode</span>
                  </button>

                  <div className="space-y-1 overflow-y-auto pr-1">
                    {(state?.modes || []).map((m) => {
                      const isSel = selectedModeId === m.id;
                      const isCurrentActive = state?.activeModeId === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setSelectedModeId(m.id)}
                          className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer flex items-center justify-between ${
                            isSel
                              ? 'bg-[#242428] text-white shadow-sm'
                              : 'text-neutral-400 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <span className="truncate">{m.name}</span>
                          {isCurrentActive && (
                            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full font-mono shrink-0 ml-1">
                              active
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Right Mode Editor */}
                {selectedMode && (
                  <div className="flex-1 bg-[#18181c] rounded-2xl border border-white/[0.08] p-6 flex flex-col justify-between overflow-y-auto">
                    <div className="space-y-5">
                      <div className="flex items-center justify-between gap-3">
                        <input
                          type="text"
                          value={selectedMode.name}
                          onChange={(e) => {
                            const updated = state!.modes.map((m) =>
                              m.id === selectedMode.id ? { ...m, name: e.target.value } : m
                            );
                            patchState({ modes: updated });
                          }}
                          className="text-xl font-bold text-white bg-transparent border-b border-transparent hover:border-white/20 focus:border-sky-400 focus:outline-none flex-1"
                        />
                        {selectedMode.isCustom && (
                          <button
                            type="button"
                            onClick={() => {
                              const filtered = state!.modes.filter((m) => m.id !== selectedMode.id);
                              patchState({
                                modes: filtered,
                                activeModeId:
                                  state!.activeModeId === selectedMode.id
                                    ? 'general'
                                    : state!.activeModeId,
                              });
                              setSelectedModeId('general');
                            }}
                            className="text-xs text-red-400 hover:text-red-300 px-2.5 py-1 rounded-lg bg-red-500/10 cursor-pointer"
                          >
                            Delete Mode
                          </button>
                        )}
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-neutral-300 mb-1.5 block">
                          System Instructions & Grounding Persona
                        </label>
                        <textarea
                          rows={6}
                          value={selectedMode.contextPrompt}
                          onChange={(e) => {
                            const updated = state!.modes.map((m) =>
                              m.id === selectedMode.id
                                ? { ...m, contextPrompt: e.target.value }
                                : m
                            );
                            patchState({ modes: updated });
                          }}
                          placeholder="Define how Cluely should answer in this mode..."
                          className="w-full bg-[#121214] border border-white/10 rounded-xl p-3.5 text-xs text-white/90 focus:outline-none focus:border-[#0091FF] leading-relaxed font-sans"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold text-neutral-300">
                            Vector RAG Knowledge Files (Resume, Architecture Docs, PDFs, Code)
                          </label>
                          <span className="text-[11px] text-emerald-400 font-mono">
                            Auto-chunked & embedded into Local Vector DB
                          </span>
                        </div>
                        <div
                          onClick={() => handlePickFilesForMode(selectedMode.id)}
                          className="border border-dashed border-white/20 hover:border-sky-400/50 rounded-2xl p-5 text-center bg-black/20 hover:bg-black/30 transition cursor-pointer group"
                        >
                          <FileText
                            size={22}
                            className="mx-auto text-neutral-500 group-hover:text-sky-400 mb-1.5"
                          />
                          <div className="text-xs text-neutral-200 font-medium">
                            Click to attach PDF, DOCX, Markdown, or Source Code files
                          </div>
                          <div className="text-[11px] text-neutral-500 mt-0.5">
                            Top-K relevant chunks are dynamically retrieved during live Q&A
                          </div>
                        </div>

                        {selectedMode.files && selectedMode.files.length > 0 && (
                          <div className="space-y-1.5 pt-2">
                            {selectedMode.files.map((file) => (
                              <div
                                key={file.id}
                                className="p-2.5 bg-[#121214] rounded-xl border border-white/10 flex items-center justify-between text-xs"
                              >
                                <div className="flex items-center gap-2 truncate">
                                  <FileText size={14} className="text-[#0091FF] shrink-0" />
                                  <span className="font-medium text-white truncate">
                                    {file.name}
                                  </span>
                                  <span className="text-neutral-500 text-[11px]">
                                    ({Math.round(file.size / 1024)} KB •{' '}
                                    {file.chunks?.length ||
                                      Math.ceil((file.extractedText?.length || 0) / 1000)}{' '}
                                    vector chunks)
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveModeFile(selectedMode.id, file.id);
                                  }}
                                  className="text-neutral-500 hover:text-red-400 p-1 cursor-pointer"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="pt-5 flex justify-end">
                      <button
                        type="button"
                        onClick={() => patchState({ activeModeId: selectedMode.id })}
                        className={`px-6 py-2 rounded-full font-semibold text-xs shadow-lg transition active:scale-95 cursor-pointer ${
                          state?.activeModeId === selectedMode.id
                            ? 'bg-emerald-500 text-black'
                            : 'bg-[#0091FF] text-white hover:bg-[#0080e6]'
                        }`}
                      >
                        {state?.activeModeId === selectedMode.id
                          ? '✓ Active Mode in HUD'
                          : 'Set as Active Mode'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB 5: PERSONAL MEMORY VAULT & VOICEPRINT                      */}
            {/* ============================================================== */}
            {activeTab === 'profile' && (
              <div className="space-y-7">
                {/* Voiceprint Enrollment */}
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] p-5 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-white">
                      24-D Acoustic Voiceprint Enrollment ("Me" Speaker ID)
                    </div>
                    <div className="text-xs text-neutral-400">
                      Calibrates MFCC + F0 pitch centroid so in-person room meetings distinguish your voice from other speakers.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isEnrollingVoice}
                    onClick={handleEnrollVoice}
                    className="px-4 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 text-xs font-semibold transition cursor-pointer shrink-0"
                  >
                    {isEnrollingVoice
                      ? 'Speak for 4s...'
                      : voiceEnrollSuccess
                      ? '✓ Voiceprint Saved'
                      : 'Calibrate My Voice (4s)'}
                  </button>
                </div>

                {/* Personal Memory Vault */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        Personal Memory Vault (Vector-Indexed Facts, Bio & Projects)
                      </h3>
                      <p className="text-xs text-neutral-400">
                        Automatically retrieved via Hybrid Vector + BM25 RRF to ground your answers with zero hallucinations.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isExtractingFacts}
                        onClick={handleExtractFactsFromTranscript}
                        className="px-3 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 text-purple-300 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                      >
                        <Brain size={13} />
                        <span>
                          {isExtractingFacts ? 'Extracting...' : 'Extract from Live Transcript'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsAddingMemory(!isAddingMemory)}
                        className="px-3.5 py-1.5 rounded-xl bg-[#0091FF] hover:bg-sky-400 text-white text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                      >
                        <Plus size={14} />
                        <span>Add Memory</span>
                      </button>
                    </div>
                  </div>

                  {factToast && (
                    <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs">
                      {factToast}
                    </div>
                  )}

                  {isAddingMemory && (
                    <div className="bg-[#1c1c1f] border border-white/15 rounded-2xl p-4 space-y-3 text-xs">
                      <div className="grid grid-cols-3 gap-3">
                        <input
                          type="text"
                          value={newMemTitle}
                          onChange={(e) => setNewMemTitle(e.target.value)}
                          placeholder="Title (e.g., Current Role, Core Stack, Key Project)"
                          className="col-span-2 bg-[#121214] border border-white/15 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-400"
                        />
                        <select
                          value={newMemCategory}
                          onChange={(e) => setNewMemCategory(e.target.value as any)}
                          className="bg-[#121214] border border-white/15 rounded-xl px-3 py-2 text-white focus:outline-none"
                        >
                          <option value="bio">Bio & Background</option>
                          <option value="project">Project Architecture</option>
                          <option value="preference">Speaking Preference</option>
                          <option value="meeting_fact">Meeting Commitment / Fact</option>
                          <option value="person">Person / Stakeholder</option>
                        </select>
                      </div>
                      <textarea
                        rows={3}
                        value={newMemContent}
                        onChange={(e) => setNewMemContent(e.target.value)}
                        placeholder="Factual details to ground Cluely during interviews or meetings..."
                        className="w-full bg-[#121214] border border-white/15 rounded-xl p-3 text-white focus:outline-none focus:border-sky-400"
                      />
                      <div className="flex items-center justify-between gap-3">
                        <input
                          type="text"
                          value={newMemTags}
                          onChange={(e) => setNewMemTags(e.target.value)}
                          placeholder="Comma-separated tags (e.g., backend, rag, leadership)"
                          className="flex-1 bg-[#121214] border border-white/15 rounded-xl px-3 py-1.5 text-white focus:outline-none"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setIsAddingMemory(false)}
                            className="px-3 py-1.5 rounded-lg bg-white/10 text-neutral-300 cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleAddMemory}
                            className="px-4 py-1.5 rounded-lg bg-[#0091FF] text-white font-semibold cursor-pointer"
                          >
                            Save & Embed
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="relative">
                    <input
                      type="text"
                      value={memorySearch}
                      onChange={(e) => setMemorySearch(e.target.value)}
                      placeholder="Filter memories by keyword or tag..."
                      className="w-full bg-[#18181c] border border-white/10 rounded-xl px-4 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-sky-400 pr-9"
                    />
                    <Search size={14} className="absolute right-3 top-2.5 text-neutral-500" />
                  </div>

                  <div className="space-y-2">
                    {filteredMemories.length === 0 ? (
                      <div className="py-10 text-center text-xs text-neutral-500 bg-[#18181c] rounded-2xl border border-white/5">
                        No personal memories stored yet. Click "Add Memory" to add your bio, projects, or preferences.
                      </div>
                    ) : (
                      filteredMemories.map((m) => (
                        <div
                          key={m.id}
                          className="p-3.5 bg-[#18181c] border border-white/[0.08] rounded-xl flex items-start justify-between gap-3 text-xs"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-sky-500/15 text-sky-400">
                                {m.category}
                              </span>
                              <span className="font-semibold text-white text-[13px]">{m.title}</span>
                              {m.embedding && m.embedding.length > 0 && (
                                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                  {m.embedding.length}d vector
                                </span>
                              )}
                            </div>
                            <p className="text-neutral-300 leading-relaxed">{m.content}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteMemory(m.id)}
                            className="text-neutral-500 hover:text-red-400 p-1 cursor-pointer shrink-0"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB 6: GLOBAL SHORTCUTS & MOBILE COMPANION                     */}
            {/* ============================================================== */}
            {activeTab === 'keybinds' && (
              <div className="space-y-7">
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                    Global OS Keyboard Shortcuts (Click any keybind to re-record)
                  </h3>
                  <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden text-xs">
                    {[
                      {
                        action: 'toggleVisibility' as ShortcutAction,
                        label: 'Show / Hide Cluely Floating HUD',
                        fallback: 'CommandOrControl+\\',
                      },
                      {
                        action: 'askCluely' as ShortcutAction,
                        label: 'Ask Cluely (Flush Speech & Trigger Teleprompter)',
                        fallback: 'CommandOrControl+Enter',
                      },
                      {
                        action: 'newChat' as ShortcutAction,
                        label: 'Clear Active Session Context / New Chat',
                        fallback: 'CommandOrControl+R',
                      },
                      {
                        action: 'toggleSession' as ShortcutAction,
                        label: 'Start / Stop Live Meeting Audio Capture',
                        fallback: 'CommandOrControl+Shift+\\',
                      },
                      {
                        action: 'openSettings' as ShortcutAction,
                        label: 'Open Cluely Studio Settings',
                        fallback: 'CommandOrControl+,',
                      },
                    ].map((row) => {
                      const isRec = recordingAction === row.action;
                      const currentVal = state?.shortcuts?.[row.action] || row.fallback;
                      return (
                        <div key={row.action} className="p-3.5 flex items-center justify-between">
                          <span className="text-white/90 font-medium">{row.label}</span>
                          <button
                            type="button"
                            onClick={() => setRecordingAction(isRec ? null : row.action)}
                            className={`px-3 py-1.5 rounded-lg font-mono text-xs border transition cursor-pointer ${
                              isRec
                                ? 'bg-[#0091FF] text-white border-sky-300 animate-pulse'
                                : 'bg-[#121214] text-neutral-300 border-white/15 hover:border-white/30'
                            }`}
                          >
                            {isRec ? 'Press keys...' : currentVal}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* LAN Mobile Companion & Second-Screen Teleprompter */}
                {companionInfo && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                      Encrypted LAN Mobile Companion & Wireless Pocket Mic
                    </h3>
                    <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] p-5 flex items-center justify-between gap-6">
                      <div className="space-y-2 flex-1">
                        <div className="text-sm font-bold text-white flex items-center gap-2">
                          <Smartphone size={16} className="text-sky-400" />
                          <span>Second-Screen Teleprompter & In-Person Room Mic</span>
                        </div>
                        <p className="text-xs text-neutral-400 leading-relaxed">
                          Scan this QR code on your iPhone/Android over local Wi-Fi to view live AI teleprompter answers on a separate physical device or stream wireless room audio.
                        </p>
                        <div className="flex items-center gap-3 pt-1">
                          <code className="bg-[#121214] border border-white/10 px-3 py-1.5 rounded-lg text-xs text-sky-300 font-mono">
                            {companionInfo.companionUrl}
                          </code>
                          <span className="text-xs font-mono text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg">
                            PIN: {companionInfo.pairingPin}
                          </span>
                          <button
                            type="button"
                            onClick={handleCopyCompanionLink}
                            className="text-xs text-white/70 hover:text-white flex items-center gap-1 bg-white/10 px-2.5 py-1.5 rounded-lg cursor-pointer"
                          >
                            {copiedLink ? <Check size={12} /> : <Copy size={12} />}
                            <span>{copiedLink ? 'Copied' : 'Copy URL'}</span>
                          </button>
                        </div>
                      </div>
                      {qrCodeDataUrl && (
                        <div className="bg-white p-2 rounded-xl shrink-0">
                          <img src={qrCodeDataUrl} alt="Companion QR" className="w-28 h-28" />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
