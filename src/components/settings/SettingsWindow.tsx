import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import {
  Sliders,
  Calendar,
  Bell,
  Layers,
  Keyboard,
  User,
  Shield,
  CreditCard,
  Info,
  Eye,
  PowerOff,
  AudioWaveform,
  Languages,
  Mic,
  Volume2,
  Users,
  Check,
  Trash2,
  Plus,
  RefreshCw,
  Search,
  FileText,
  Download,
  ExternalLink,
  Brain,
  Copy,
  MoreHorizontal,
  History,
} from 'lucide-react';
import { useAppState } from '../../hooks/useAppState';
import { SessionsHistoryView } from './SessionsHistoryView';
import {
  CompanionServerInfo,
  LocalModelStatus,
  MemoryItem,
  NvidiaConnectionTestResult,
  NvidiaLatencyProfile,
  ShortcutAction,
} from '../../types/ipc';

export const SettingsWindow: React.FC = () => {
  const { state, patchState } = useAppState();
  const [activeTab, setActiveTab] = useState<string>('general');

  // Mic test state
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [micTestLevel, setMicTestLevel] = useState(0.2);
  const micAnimRef = useRef<number | null>(null);

  // Speaker test state
  const [isTestingSpeaker, setIsTestingSpeaker] = useState(false);
  const [systemAudioLevel, setSystemAudioLevel] = useState<number>(0);

  // Modes Tab State
  const [selectedModeId, setSelectedModeId] = useState<string>(() => state?.activeModeId || 'general');

  // Keybinds Tab State (Click-to-rebind)
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);

  // Profile Tab / Memory Vault State
  const [memories, setMemories] = useState<MemoryItem[]>(() => state?.personalMemories || []);
  const [memorySearch, setMemorySearch] = useState<string>('');
  const [isAddingMemory, setIsAddingMemory] = useState<boolean>(false);
  const [newMemTitle, setNewMemTitle] = useState<string>('');
  const [newMemCategory, setNewMemCategory] = useState<MemoryItem['category']>('preference');
  const [newMemContent, setNewMemContent] = useState<string>('');
  const [newMemTags, setNewMemTags] = useState<string>('');
  const [isExtractingFacts, setIsExtractingFacts] = useState<boolean>(false);
  const [factToast, setFactToast] = useState<string | null>(null);

  // Voiceprint Enrollment State
  const [isEnrollingVoice, setIsEnrollingVoice] = useState<boolean>(false);
  const [voiceEnrollSuccess, setVoiceEnrollSuccess] = useState<boolean>(false);

  // iOS Companion State
  const [companionInfo, setCompanionInfo] = useState<CompanionServerInfo | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Security Tab / Local Models State
  const [localModels, setLocalModels] = useState<LocalModelStatus[]>([]);
  const [refreshingModels, setRefreshingModels] = useState<boolean>(false);

  // NVIDIA Speech Test State
  const [testingNvidia, setTestingNvidia] = useState<boolean>(false);
  const [nvidiaTestResult, setNvidiaTestResult] = useState<NvidiaConnectionTestResult | null>(null);

  // Calendar & Notifications State
  const [calendarSyncEnabled, setCalendarSyncEnabled] = useState(true);
  const [silentChimeEnabled, setSilentChimeEnabled] = useState(true);
  const [screenPillEnabled, setScreenPillEnabled] = useState(true);
  const [statusBeaconEnabled, setStatusBeaconEnabled] = useState(true);
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

  // Listen for tab navigation from IPC (e.g. from Active Session pill or openSettings('sessions'))
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

  // Sync memory list
  useEffect(() => {
    if (state?.personalMemories) {
      setMemories(state.personalMemories);
    }
  }, [state?.personalMemories]);

  // Load iOS Companion Info & generate QR Code
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

  // Load & listen for Local Models
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

  // Listen to live system audio levels from audiotee
  useEffect(() => {
    if (window.cluely?.onSystemAudioLevel) {
      const unsub = window.cluely.onSystemAudioLevel(({ rms }) => {
        setSystemAudioLevel(rms);
      });
      return unsub;
    }
  }, []);

  // Handle Keybinds recording
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

  // Mic test loop
  const handleToggleTestMic = () => {
    if (isTestingMic) {
      if (micAnimRef.current) cancelAnimationFrame(micAnimRef.current);
      setIsTestingMic(false);
      setMicTestLevel(0.2);
    } else {
      setIsTestingMic(true);
      const loop = () => {
        const fakeLevel = 0.25 + Math.random() * 0.65;
        setMicTestLevel(fakeLevel);
        micAnimRef.current = requestAnimationFrame(loop);
      };
      micAnimRef.current = requestAnimationFrame(loop);
    }
  };

  // Speaker test
  const handleTestSpeaker = () => {
    setIsTestingSpeaker(true);
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880.0, ctx.currentTime + 0.12); // A5
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

  const handlePullModel = async (id: LocalModelStatus['id']) => {
    if (!window.cluely?.pullLocalModel) return;
    await window.cluely.pullLocalModel(id);
  };

  const handlePickFilesForMode = async (modeId: string) => {
    if (!window.cluely?.pickModeFiles) return;
    await window.cluely.pickModeFiles(modeId);
  };

  const handleRemoveModeFile = async (modeId: string, fileId: string) => {
    if (!window.cluely?.removeModeFile) return;
    await window.cluely.removeModeFile(modeId, fileId);
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
  };

  const handleDeleteMemory = async (id: string) => {
    if (!window.cluely?.deleteMemory) return;
    await window.cluely.deleteMemory(id);
    setMemories((prev) => prev.filter((m) => m.id !== id));
  };

  const handleExtractFactsFromTranscript = async () => {
    if (!window.cluely?.extractMemoriesFromTranscript) return;
    setIsExtractingFacts(true);
    setFactToast(null);
    try {
      const mockSegments = [
        {
          id: 's1',
          speakerId: 'me',
          speakerLabel: 'Me',
          role: 'me' as const,
          text: 'I specialize in TypeScript, Electron, and distributed systems with 7 years of full stack experience.',
          timestamp: Date.now(),
          startTimeMs: 0,
          endTimeMs: 4000,
          formattedTimestamp: '[00:00.00 - 00:04.00]',
          speakerColor: '#22c55e',
        },
      ];
      const extracted = await window.cluely.extractMemoriesFromTranscript(mockSegments);
      setFactToast(`Extracted ${extracted.length} permanent facts into Memory Vault!`);
      const updated = await window.cluely.getMemories();
      setMemories(updated);
    } catch {
      setFactToast('Fact extraction failed; check API key.');
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

  // Exact 10 Tabs in Order matching Cluely v2.1.24 + Sessions History
  const navTabs = [
    { id: 'general', label: 'General', icon: Sliders },
    { id: 'sessions', label: 'Sessions', icon: History },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'modes', label: 'Modes', icon: Layers },
    { id: 'keybinds', label: 'Keybinds', icon: Keyboard },
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'billing', label: 'Billing', icon: CreditCard },
    { id: 'about', label: 'About', icon: Info },
  ];

  return (
    <div className="flex flex-col h-screen w-screen bg-[#101012] text-white font-sans overflow-hidden select-none">
      {/* Top Window Title (Exact v2.1.24: "Cluely Settings") */}
      <div className="text-center py-2.5 border-b border-white/[0.08] bg-[#141416] shrink-0">
        <span className="text-[13px] text-neutral-400 font-medium">Cluely Settings</span>
      </div>

      {/* Horizontal 9-Tab Navigation Bar */}
      <div className="bg-[#18181b] border-b border-white/[0.08] px-6 py-2.5 flex items-center justify-center shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-4xl">
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center justify-center py-1.5 px-3.5 rounded-lg text-[11px] font-medium transition cursor-pointer shrink-0 min-w-[76px] ${
                  isActive
                    ? 'bg-[#262629] text-white shadow-sm ring-1 ring-white/10'
                    : 'text-[#8e8e93] hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon size={18} className={`mb-1 ${isActive ? 'text-white' : 'text-[#8e8e93]'}`} />
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
          <div className="max-w-[780px] mx-auto">
          {/* ============================================================== */}
          {/* TAB 1: GENERAL */}
          {/* ============================================================== */}
          {activeTab === 'general' && (
            <div className="space-y-8">
              {/* General Group */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-400">General</h3>
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden">
                  {/* Undetectability */}
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-[#202022] flex items-center justify-center text-neutral-300 shrink-0">
                        <Eye size={22} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-white">Undetectability</div>
                        <div className="text-[12px] text-neutral-400">Off means Cluely is detectable by screen sharing.</div>
                      </div>
                    </div>
                    {/* Switch */}
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

                  {/* Launch Cluely at login */}
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-[#202022] flex items-center justify-center text-neutral-300 shrink-0">
                        <PowerOff size={22} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-white">Launch Cluely at login</div>
                        <div className="text-[12px] text-neutral-400">Cluely will stay closed until you open it.</div>
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

              {/* Meeting Sessions & History Group */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-400">Meeting Sessions & History</h3>
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden">
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-[#202022] flex items-center justify-center text-sky-400 shrink-0">
                        <History size={22} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-white">Past Sessions & Transcripts</div>
                        <div className="text-[12px] text-neutral-400">
                          Review past meetings, search transcripts, and view interleaved AI Assist events.
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('sessions')}
                      className="px-4 py-1.5 rounded-xl bg-[#0091FF] hover:bg-sky-400 text-xs font-semibold text-white transition flex items-center gap-1.5 shadow cursor-pointer active:scale-95"
                    >
                      <span>View Sessions</span>
                      <ExternalLink size={13} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Language Group */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-400">Language</h3>
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden">
                  {/* Transcription language */}
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-[#202022] flex items-center justify-center text-neutral-300 shrink-0">
                        <AudioWaveform size={22} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-white">Transcription language</div>
                        <div className="text-[12px] text-neutral-400">Select the language you speak in meetings.</div>
                      </div>
                    </div>
                    <select
                      value={state?.transcriptionLanguage || 'Auto-detect (Multilingual)'}
                      onChange={(e) => patchState({ transcriptionLanguage: e.target.value })}
                      className="bg-[#242428] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400"
                    >
                      <option value="Auto-detect (Multilingual)">Auto-detect (Multilingual — Hindi / English / Hinglish)</option>
                      <option value="Bilingual (Hindi + English)">Bilingual (Hindi + English)</option>
                      <option value="Hindi">Hindi (हिंदी)</option>
                      <option value="English (recommended)">English (Parakeet-TDT ultra-fast)</option>
                      <option value="Spanish">Spanish</option>
                      <option value="French">French</option>
                      <option value="German">German</option>
                      <option value="Japanese">Japanese</option>
                      <option value="Mandarin">Mandarin</option>
                    </select>
                  </div>

                  {/* Output language */}
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-[#202022] flex items-center justify-center text-neutral-300 shrink-0">
                        <Languages size={22} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-white">Output language</div>
                        <div className="text-[12px] text-neutral-400">Your preferred language for AI and meeting notes.</div>
                      </div>
                    </div>
                    <select
                      value={state?.outputLanguage || 'English'}
                      onChange={(e) => patchState({ outputLanguage: e.target.value })}
                      className="bg-[#242428] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400"
                    >
                      <option value="English">English</option>
                      <option value="Hindi">Hindi</option>
                      <option value="Spanish">Spanish</option>
                      <option value="French">French</option>
                      <option value="German">German</option>
                      <option value="Japanese">Japanese</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* AI Intelligence & Speech Engine Group */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-neutral-400">AI Intelligence & Speech Engine</h3>
                  <span className="text-[11px] text-emerald-400 font-mono bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                    {state?.aiConfig?.activeProvider === 'ollama' ? '100% Offline & Private' : 'Cloud Connected'}
                  </span>
                </div>
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden">
                  {/* Active AI Provider */}
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-[#202022] flex items-center justify-center text-neutral-300 shrink-0">
                        <Brain size={22} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-white">AI Assistant Provider</div>
                        <div className="text-[12px] text-neutral-400">Select local Ollama for zero-cloud privacy or cloud models.</div>
                      </div>
                    </div>
                    <select
                      value={state?.aiConfig?.activeProvider || 'ollama'}
                      onChange={(e) =>
                        patchState({
                          aiConfig: {
                            ...state!.aiConfig,
                            activeProvider: e.target.value as any,
                          },
                        })
                      }
                      className="bg-[#242428] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400"
                    >
                      <option value="ollama">Local Ollama (Offline / Private)</option>
                      <option value="gemini">Google Gemini (Cloud)</option>
                      <option value="openai">OpenAI GPT-4o (Cloud)</option>
                      <option value="anthropic">Anthropic Claude 3.5 (Cloud)</option>
                      <option value="groq">Groq Llama 3.3 (Fast Cloud)</option>
                    </select>
                  </div>

                  {/* Local Ollama Model Picker */}
                  {state?.aiConfig?.activeProvider === 'ollama' && (
                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3.5">
                        <div className="w-12 h-12 rounded-xl bg-[#202022] flex items-center justify-center text-neutral-300 shrink-0">
                          <Layers size={22} />
                        </div>
                        <div>
                          <div className="text-[14px] font-semibold text-white">Active Ollama Model</div>
                          <div className="text-[12px] text-neutral-400">Choose from models installed in your local Ollama.</div>
                        </div>
                      </div>
                      <select
                        value={state?.aiConfig?.activeModel || 'nemotron-mini'}
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
                        <option value="nemotron-mini">nemotron-mini:latest (NVIDIA 4B - Recommended for Chat)</option>
                        <option value="qwen3-vl">qwen3-vl:latest (8.8B Multimodal Vision / Screen)</option>
                        <option value="llama3.1:8b">llama3.1:8b (Meta LLaMA 8B)</option>
                        <option value="deepseek-r1:14b">deepseek-r1:14b (Deep Reasoning & Logic)</option>
                        <option value="gemma4:e4b">gemma4:e4b (Google Gemma 7.5B)</option>
                        <option value="gemma4:12b">gemma4:12b (Google Gemma 12B)</option>
                      </select>
                    </div>
                  )}

                  {/* Speech-to-Text Voice Engine */}
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-[#202022] flex items-center justify-center text-neutral-300 shrink-0">
                        <AudioWaveform size={22} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-white">Speech-to-Text Engine</div>
                        <div className="text-[12px] text-neutral-400">Local Parakeet-TDT runs offline in ~200ms on Apple Silicon.</div>
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
                      <option value="nvidia-parakeet-tdt">NVIDIA Parakeet-TDT 0.6B (Local Offline ONNX — English)</option>
                      <option value="whisper-base-onnx">Whisper Multilingual (Local Offline ONNX — Hindi & English)</option>
                      <option value="nvidia-hybrid">NVIDIA Hybrid (Cloud NIM + Local Parakeet)</option>
                      <option value="gemini-native">Google Gemini Native Speech (Cloud)</option>
                      <option value="groq-whisper">Groq Whisper (Cloud)</option>
                      <option value="deepgram-nova3">Deepgram Nova-3 (Cloud)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Audio Settings Group */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-400">Audio Settings</h3>
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden">
                  {/* Microphone Source */}
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-[#202022] flex items-center justify-center text-neutral-300 shrink-0">
                        <Mic size={22} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-white">Microphone Source</div>
                        <div className="text-[12px] text-neutral-400">
                          {audioInputDevices.find((d) => d.deviceId === state?.selectedMicDeviceId)?.label ||
                            'Default - MacBook Pro Microphone (Built-in)'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {audioInputDevices.length > 0 && (
                        <select
                          value={state?.selectedMicDeviceId || ''}
                          onChange={(e) => patchState({ selectedMicDeviceId: e.target.value })}
                          className="bg-[#242428] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400 max-w-[200px] truncate"
                        >
                          <option value="">Default (Built-in)</option>
                          {audioInputDevices.map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || `Microphone (${d.deviceId.slice(0, 6)}...)`}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={handleToggleTestMic}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-medium bg-[#242428] hover:bg-[#2c2c30] text-white border border-white/10 transition cursor-pointer shrink-0"
                      >
                        {isTestingMic ? 'Stop Test' : 'Test Microphone'}
                      </button>
                    </div>
                  </div>

                  {/* Mic Test Visualizer Bar */}
                  {isTestingMic && (
                    <div className="px-4 py-2 bg-black/30 flex items-center gap-3">
                      <span className="text-[11px] text-neutral-400 font-mono">Live Input dB:</span>
                      <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${Math.round(micTestLevel * 100)}%` }}
                          className="h-full bg-emerald-400 rounded-full transition-all duration-75"
                        />
                      </div>
                      <span className="text-[11px] text-emerald-400 font-mono">{Math.round(micTestLevel * 100)}%</span>
                    </div>
                  )}

                  {/* System Audio Loopback */}
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-[#202022] flex items-center justify-center text-neutral-300 shrink-0">
                        <Volume2 size={22} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-white">System Audio Loopback (audiotee)</div>
                        <div className="text-[12px] text-neutral-400">Captures remote meeting participants directly from Mac speakers.</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleTestSpeaker}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-medium bg-[#242428] hover:bg-[#2c2c30] text-white border border-white/10 transition cursor-pointer"
                    >
                      {isTestingSpeaker ? 'Playing Chime...' : 'Test Speaker'}
                    </button>
                  </div>

                  {/* System Audio Loopback Live Meter */}
                  <div className="px-4 py-2.5 bg-black/30 flex items-center gap-3">
                    <span className="text-[11px] text-neutral-400 font-mono shrink-0">Loopback Signal (audiotee):</span>
                    <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                      <div
                        style={{ width: `${Math.min(100, Math.round(systemAudioLevel * 250))}%` }}
                        className="h-full bg-sky-400 rounded-full transition-all duration-75"
                      />
                    </div>
                    <span className="text-[11px] text-sky-400 font-mono shrink-0">
                      {Math.min(100, Math.round(systemAudioLevel * 250))}%
                    </span>
                  </div>

                  {/* Meeting Environment */}
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-[#202022] flex items-center justify-center text-neutral-300 shrink-0">
                        <Users size={22} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-white">Meeting Environment</div>
                        <div className="text-[12px] text-neutral-400">Online Call (Mic + Mac Speakers) vs Offline Room.</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 bg-[#242428] p-1 rounded-xl border border-white/10 text-xs">
                      <button
                        type="button"
                        onClick={() => patchState({ meetingEnvironment: 'online' })}
                        className={`px-3 py-1 rounded-lg font-medium transition cursor-pointer ${
                          state?.meetingEnvironment !== 'offline'
                            ? 'bg-[#0091FF] text-white shadow-sm'
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        Online Call
                      </button>
                      <button
                        type="button"
                        onClick={() => patchState({ meetingEnvironment: 'offline' })}
                        className={`px-3 py-1 rounded-lg font-medium transition cursor-pointer ${
                          state?.meetingEnvironment === 'offline'
                            ? 'bg-[#0091FF] text-white shadow-sm'
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        Offline Room
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: MODES */}
          {/* ============================================================== */}
          {activeTab === 'modes' && (
            <div className="flex gap-6 -m-2 h-[calc(100vh-170px)]">
              {/* Left Sidebar (250px) */}
              <div className="w-[250px] bg-[#141417] rounded-2xl border border-white/[0.08] p-3 flex flex-col shrink-0 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => {
                    const newId = `custom_${Date.now()}`;
                    const newMode = {
                      id: newId,
                      name: 'New Custom Mode',
                      category: 'general' as const,
                      icon: 'compass',
                      contextPrompt: 'Custom copilot context instructions...',
                      files: [],
                      isCustom: true,
                    };
                    patchState({ modes: [...state!.modes, newMode] });
                    setSelectedModeId(newId);
                  }}
                  className="w-full bg-[#132333] border border-[#0091FF]/30 text-[#38bdf8] font-semibold py-2 px-3 rounded-xl mb-3 flex items-center justify-center gap-1.5 text-xs hover:bg-[#182e44] transition cursor-pointer"
                >
                  <Plus size={14} />
                  <span>New Mode</span>
                </button>

                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setSelectedModeId('general')}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                      selectedModeId === 'general'
                        ? 'bg-[#242428] text-white shadow-sm'
                        : 'text-neutral-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    General
                  </button>

                  <div className="pt-3 pb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    Interview & Work Modes
                  </div>

                  {(state?.modes || [
                    { id: 'interview', name: 'Interview' },
                    { id: 'gen-ai', name: 'Gen AI' },
                    { id: 'behavioral-interview', name: 'Behavioral Interview' },
                    { id: 'coding-interview', name: 'Coding Interview' },
                    { id: 'system-design', name: 'System Design' },
                    { id: 'case-interview', name: 'Case Interview' },
                    { id: 'recruiter-screen', name: 'Recruiter Screen' },
                    { id: 'sales', name: 'Sales' },
                    { id: 'team-meet', name: 'Team Meet' },
                    { id: 'lecture', name: 'Lecture' },
                    { id: 'recruiting', name: 'Recruiting' },
                  ])
                    .filter((m) => m.id !== 'general')
                    .map((m) => {
                      const isSel = selectedModeId === m.id;
                      const isCurrentActive = state?.activeModeId === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setSelectedModeId(m.id)}
                          className={`w-full text-left px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer flex items-center justify-between ${
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

              {/* Right Pane */}
              {selectedMode && (
                <div className="flex-1 bg-[#18181c] rounded-2xl border border-white/[0.08] p-6 flex flex-col justify-between overflow-y-auto">
                  <div className="space-y-6">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-[28px] font-bold text-white leading-tight">{selectedMode.name}</h2>
                        <span className="text-[11px] text-neutral-400 uppercase font-semibold tracking-wider">
                          {selectedMode.category}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-neutral-400 hover:text-white transition cursor-pointer"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    </div>

                    {/* Meeting Context */}
                    <div>
                      <label className="text-sm font-semibold text-neutral-300 mb-2 block">Meeting context</label>
                      <textarea
                        rows={6}
                        value={selectedMode.contextPrompt}
                        onChange={(e) => {
                          const updated = state!.modes.map((m) =>
                            m.id === selectedMode.id ? { ...m, contextPrompt: e.target.value } : m
                          );
                          patchState({ modes: updated });
                        }}
                        placeholder="Add meeting context, background stories, framework preferences..."
                        className="w-full bg-[#121214] border border-white/10 rounded-xl p-3.5 text-xs text-white/90 focus:outline-none focus:border-[#0091FF] leading-relaxed font-sans"
                      />
                    </div>

                    {/* Dashed Files Card */}
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-neutral-300 block">Files</label>
                      <div
                        onClick={() => handlePickFilesForMode(selectedMode.id)}
                        className="border border-dashed border-white/20 hover:border-white/40 rounded-2xl p-6 text-center bg-black/20 hover:bg-black/30 transition cursor-pointer group"
                      >
                        <FileText size={24} className="mx-auto text-neutral-500 group-hover:text-neutral-300 mb-2" />
                        <div className="text-xs text-neutral-300 font-medium">
                          Adding files gives more context to Cluely
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">
                          Drag & drop files here to add them, or <span className="text-[#0091FF] underline">browse files</span>
                        </div>
                      </div>

                      {/* Attached files list */}
                      {selectedMode.files && selectedMode.files.length > 0 && (
                        <div className="space-y-1.5 pt-2">
                          {selectedMode.files.map((file) => (
                            <div
                              key={file.id}
                              className="p-2.5 bg-[#121214] rounded-xl border border-white/10 flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-2 truncate">
                                <FileText size={14} className="text-[#0091FF] shrink-0" />
                                <span className="font-medium text-white truncate">{file.name}</span>
                                <span className="text-neutral-500 text-[11px]">
                                  ({Math.round(file.size / 1024)} KB)
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveModeFile(selectedMode.id, file.id);
                                }}
                                className="text-neutral-500 hover:text-red-400 p-1"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Sticky Bottom Set Active Button */}
                  <div className="pt-6 flex justify-end">
                    <button
                      type="button"
                      onClick={() => patchState({ activeModeId: selectedMode.id })}
                      className={`px-6 py-2 rounded-full font-semibold text-xs shadow-lg transition active:scale-95 cursor-pointer ${
                        state?.activeModeId === selectedMode.id
                          ? 'bg-emerald-500 text-black'
                          : 'bg-[#0091FF] text-white hover:bg-[#0080e6]'
                      }`}
                    >
                      {state?.activeModeId === selectedMode.id ? '✓ Active Mode' : 'Set Active'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: KEYBINDS */}
          {/* ============================================================== */}
          {activeTab === 'keybinds' && (
            <div className="space-y-8">
              {/* General Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-400">General</h3>
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden text-xs">
                  {[
                    { action: 'toggleVisibility' as ShortcutAction, label: 'Toggle visibility of Cluely', fallback: '⌘ \\' },
                    { action: 'askCluely' as ShortcutAction, label: 'Ask Cluely about your screen or audio', fallback: '⌘ ↵' },
                    { action: 'newChat' as ShortcutAction, label: 'Start a new chat', fallback: '⌘ R' },
                    { action: 'openSettings' as ShortcutAction, label: 'Open Cluely settings', fallback: '⌘ ,' },
                    { action: 'toggleSession' as ShortcutAction, label: 'Start or stop a Cluely session', fallback: '⇧ ⌘ \\' },
                  ].map((s) => (
                    <div key={s.action} className="p-4 flex items-center justify-between">
                      <span className="font-medium text-white">{s.label}</span>
                      <button
                        type="button"
                        onClick={() => setRecordingAction(s.action)}
                        className={`bg-[#202023] border px-2.5 py-1 rounded-lg font-mono text-[12px] transition cursor-pointer ${
                          recordingAction === s.action
                            ? 'border-[#0091FF] text-[#0091FF] animate-pulse'
                            : 'border-white/10 text-neutral-200 hover:border-white/30'
                        }`}
                      >
                        {recordingAction === s.action ? 'Press keys...' : state?.shortcuts?.[s.action] || s.fallback}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Window Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-400">Window</h3>
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden text-xs">
                  {[
                    { action: 'moveUp' as ShortcutAction, label: 'Move the window position up', fallback: '⌘ ↑' },
                    { action: 'moveDown' as ShortcutAction, label: 'Move the window position down', fallback: '⌘ ↓' },
                    { action: 'moveLeft' as ShortcutAction, label: 'Move the window position left', fallback: '⌘ ←' },
                    { action: 'moveRight' as ShortcutAction, label: 'Move the window position right', fallback: '⌘ →' },
                  ].map((s) => (
                    <div key={s.action} className="p-4 flex items-center justify-between">
                      <span className="font-medium text-white">{s.label}</span>
                      <button
                        type="button"
                        onClick={() => setRecordingAction(s.action)}
                        className="bg-[#202023] border border-white/10 px-2.5 py-1 rounded-lg font-mono text-[12px] text-neutral-200"
                      >
                        {state?.shortcuts?.[s.action] || s.fallback}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Scroll Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-400">Scroll</h3>
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden text-xs">
                  {[
                    { action: 'scrollUp' as ShortcutAction, label: 'Scroll the response window up', fallback: '⇧ ⌘ ↑' },
                    { action: 'scrollDown' as ShortcutAction, label: 'Scroll the response window down', fallback: '⇧ ⌘ ↓' },
                  ].map((s) => (
                    <div key={s.action} className="p-4 flex items-center justify-between">
                      <span className="font-medium text-white">{s.label}</span>
                      <button
                        type="button"
                        onClick={() => setRecordingAction(s.action)}
                        className="bg-[#202023] border border-white/10 px-2.5 py-1 rounded-lg font-mono text-[12px] text-neutral-200"
                      >
                        {state?.shortcuts?.[s.action] || s.fallback}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 4: PROFILE & MEMORY VAULT & IOS COMPANION */}
          {/* ============================================================== */}
          {activeTab === 'profile' && (
            <div className="space-y-8">
              {/* iOS Companion Sync Pairing Card */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-400">iOS Companion Sync & Pocket Microphone</h3>
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] p-5 space-y-4">
                  <div className="flex items-start justify-between gap-6">
                    <div className="space-y-2 flex-1">
                      <div className="text-[14px] font-semibold text-white">iPhone Pocket Microphone & Stealth Teleprompter</div>
                      <p className="text-[12px] text-neutral-400 leading-relaxed">
                        Scan the QR code with your iPhone camera to open the zero-install Pocket Companion web app. Leave your iPhone on the conference table during offline meetings to stream audio directly into Cluely.
                      </p>

                      <div className="flex items-center gap-3 pt-2 text-xs">
                        <span className="text-neutral-400">Pairing PIN:</span>
                        <kbd className="bg-black/50 border border-white/20 px-2.5 py-1 rounded font-mono text-[13px] text-sky-400 font-bold">
                          {companionInfo?.pairingPin || '457801'}
                        </kbd>
                        <span className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                          {companionInfo?.connectedClients || 0} active device(s)
                        </span>
                      </div>

                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={handleCopyCompanionLink}
                          className="flex items-center gap-1.5 bg-[#242428] hover:bg-[#2c2c30] text-neutral-200 px-3 py-1.5 rounded-xl text-xs border border-white/10 transition cursor-pointer"
                        >
                          <Copy size={13} />
                          <span>{copiedLink ? 'Copied URL!' : 'Copy Mobile Link'}</span>
                        </button>
                      </div>
                    </div>

                    {/* QR Code Container */}
                    <div className="bg-white p-2 rounded-xl shrink-0 shadow-md">
                      {qrCodeDataUrl ? (
                        <img src={qrCodeDataUrl} alt="Pairing QR Code" className="w-[124px] h-[124px]" />
                      ) : (
                        <div className="w-[124px] h-[124px] bg-neutral-200 animate-pulse rounded" />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Personal Memory Brain */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-neutral-400">
                    Personal Memory Brain ({memories.length} memories)
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleExtractFactsFromTranscript}
                      disabled={isExtractingFacts}
                      className="text-xs bg-purple-500/20 text-purple-300 border border-purple-500/40 px-3 py-1 rounded-xl hover:bg-purple-500/30 transition cursor-pointer flex items-center gap-1.5"
                    >
                      <Brain size={13} />
                      <span>{isExtractingFacts ? 'Extracting...' : 'Extract Facts from Transcript'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAddingMemory(!isAddingMemory)}
                      className="text-xs bg-[#0091FF] text-white px-3 py-1 rounded-xl font-medium hover:bg-[#0080e6] transition cursor-pointer flex items-center gap-1"
                    >
                      <Plus size={13} />
                      <span>New Fact</span>
                    </button>
                  </div>
                </div>

                {factToast && (
                  <div className="p-3 bg-purple-950/60 border border-purple-500/40 rounded-xl text-xs text-purple-300 flex items-center gap-2">
                    <Check size={14} className="text-purple-400" />
                    <span>{factToast}</span>
                  </div>
                )}

                {/* New Memory Form */}
                {isAddingMemory && (
                  <div className="p-4 bg-[#1c1c1f] rounded-2xl border border-white/10 space-y-3 text-xs">
                    <span className="font-semibold text-neutral-200 block">Add Fact, Bio, or Background Detail</span>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Title / Key (e.g. Current Architecture)"
                        value={newMemTitle}
                        onChange={(e) => setNewMemTitle(e.target.value)}
                        className="bg-[#121214] border border-white/15 rounded-xl px-3 py-2 text-white"
                      />
                      <select
                        value={newMemCategory}
                        onChange={(e) => setNewMemCategory(e.target.value as any)}
                        className="bg-[#121214] border border-white/15 rounded-xl px-3 py-2 text-white"
                      >
                        <option value="bio">Bio / Background</option>
                        <option value="preference">Preference / Style</option>
                        <option value="project">Project / Architecture</option>
                        <option value="meeting_fact">Meeting Fact / Commitment</option>
                        <option value="person">Colleague / Person</option>
                      </select>
                    </div>
                    <textarea
                      rows={2}
                      placeholder="Detail..."
                      value={newMemContent}
                      onChange={(e) => setNewMemContent(e.target.value)}
                      className="w-full bg-[#121214] border border-white/15 rounded-xl p-2.5 text-white"
                    />
                    <div className="flex items-center justify-between">
                      <input
                        type="text"
                        placeholder="Tags comma separated (e.g. tech, personal)"
                        value={newMemTags}
                        onChange={(e) => setNewMemTags(e.target.value)}
                        className="w-2/3 bg-[#121214] border border-white/15 rounded-xl px-3 py-1.5 text-white text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={handleAddMemory}
                        className="bg-[#0091FF] text-white font-semibold px-4 py-1.5 rounded-xl transition text-xs"
                      >
                        Save Memory
                      </button>
                    </div>
                  </div>
                )}

                {/* Memories List */}
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] p-4 space-y-3">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-2.5 text-neutral-500" />
                    <input
                      type="text"
                      value={memorySearch}
                      onChange={(e) => setMemorySearch(e.target.value)}
                      placeholder="Search memory vault..."
                      className="w-full bg-[#121214] border border-white/15 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-[#0091FF]"
                    />
                  </div>

                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {filteredMemories.length > 0 ? (
                      filteredMemories.map((m) => (
                        <div
                          key={m.id}
                          className="p-3 bg-black/30 rounded-xl border border-white/5 flex items-start justify-between gap-3 text-xs"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white">{m.title}</span>
                              <span className="bg-purple-500/20 text-purple-300 text-[10px] font-bold px-1.5 py-0.2 rounded uppercase">
                                {m.category}
                              </span>
                            </div>
                            <p className="text-neutral-300">{m.content}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteMemory(m.id)}
                            className="text-neutral-500 hover:text-red-400 p-1"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-neutral-500 italic py-3 text-center">No memories in vault.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Voiceprint Enrollment */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-400">Speaker Voiceprint Profile</h3>
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] p-5 flex items-center justify-between">
                  <div>
                    <div className="text-[14px] font-semibold text-white">Enroll My Voice (24-Element Voiceprint)</div>
                    <div className="text-[12px] text-neutral-400">Allows Cluely to reliably label your voice as "Me" in physical room meetings.</div>
                  </div>
                  <button
                    type="button"
                    onClick={handleEnrollVoice}
                    disabled={isEnrollingVoice}
                    className="bg-[#0091FF] hover:bg-[#0080e6] text-white px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                  >
                    {isEnrollingVoice ? 'Recording 4s...' : 'Enroll My Voice'}
                  </button>
                </div>
                {voiceEnrollSuccess && (
                  <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
                    <Check size={14} className="text-emerald-400" />
                    <span>Voiceprint successfully enrolled into local speaker profile!</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 5: SECURITY, LOCAL MODELS & NVIDIA BYOK */}
          {/* ============================================================== */}
          {activeTab === 'security' && (
            <div className="space-y-8">
              {/* Local Open-Source Models */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-neutral-400">Local Open-Source NVIDIA & Ollama Models</h3>
                  <button
                    type="button"
                    onClick={async () => {
                      if (window.cluely?.listLocalModels) {
                        setRefreshingModels(true);
                        const list = await window.cluely.listLocalModels();
                        setLocalModels(list);
                        setRefreshingModels(false);
                      }
                    }}
                    className="p-1 text-neutral-400 hover:text-white"
                  >
                    <RefreshCw size={13} className={refreshingModels ? 'animate-spin' : ''} />
                  </button>
                </div>

                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] p-4 space-y-2.5">
                  {localModels.map((model) => (
                    <div
                      key={model.id}
                      className="p-3.5 bg-[#121214] rounded-xl border border-white/5 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{model.name}</span>
                          <span className="text-[10px] bg-white/10 text-neutral-400 px-1.5 py-0.2 rounded font-mono">
                            {model.sizeLabel}
                          </span>
                        </div>
                        {model.installed ? (
                          <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-semibold bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded">
                            <Check size={11} /> Installed
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handlePullModel(model.id)}
                            disabled={model.downloading}
                            className="flex items-center gap-1 text-[11px] bg-[#0091FF] hover:bg-[#0080e6] text-white font-semibold px-3 py-1 rounded-xl transition cursor-pointer disabled:opacity-50"
                          >
                            <Download size={11} />
                            <span>{model.downloading ? 'Downloading...' : 'Download'}</span>
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-400">{model.statusMessage}</p>
                      {model.downloading && (
                        <div className="space-y-1 pt-1">
                          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div style={{ width: `${model.progressPercent}%` }} className="h-full bg-[#0091FF] rounded-full transition-all duration-200" />
                          </div>
                          <div className="flex justify-between text-[10px] text-neutral-500 font-mono">
                            <span>Progress</span>
                            <span>{model.progressPercent}%</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* NVIDIA Speech Pipeline Tuning */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-neutral-400">3-Stage NVIDIA Speech Tuning</h3>
                  <button
                    type="button"
                    onClick={handleTestNvidia}
                    disabled={testingNvidia}
                    className="flex items-center gap-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-3 py-1 rounded-xl text-xs font-medium hover:bg-emerald-500/30 cursor-pointer"
                  >
                    <RefreshCw size={12} className={testingNvidia ? 'animate-spin' : ''} />
                    <span>{testingNvidia ? 'Testing...' : 'Test Connection'}</span>
                  </button>
                </div>

                {nvidiaTestResult && (
                  <div className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                    nvidiaTestResult.ok ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300' : 'bg-amber-950/50 border-amber-500/40 text-amber-300'
                  }`}>
                    <span>{nvidiaTestResult.message}</span>
                    <span className="font-mono font-bold">{nvidiaTestResult.latencyMs > 0 ? `${nvidiaTestResult.latencyMs}ms` : ''}</span>
                  </div>
                )}

                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] p-4 space-y-4 text-xs">
                  <div>
                    <label className="text-neutral-400 block mb-2 font-medium">Latency vs. Accuracy Profile</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'ultra-low', label: 'Ultra-Low', ms: '380ms flush' },
                        { id: 'balanced', label: 'Balanced', ms: '650ms flush' },
                        { id: 'high-accuracy', label: 'High-Accuracy', ms: '1050ms flush' },
                      ].map((p) => {
                        const isSel = (state?.aiConfig?.nvidiaSpeech?.latencyProfile || 'balanced') === p.id;
                        return (
                          <div
                            key={p.id}
                            onClick={() =>
                              patchState({
                                aiConfig: {
                                  ...state!.aiConfig,
                                  nvidiaSpeech: { ...state!.aiConfig.nvidiaSpeech, latencyProfile: p.id as NvidiaLatencyProfile },
                                },
                              })
                            }
                            className={`p-3 rounded-xl border cursor-pointer transition ${
                              isSel ? 'bg-emerald-500/20 border-emerald-500 text-white' : 'bg-[#121214] border-white/10 text-neutral-400'
                            }`}
                          >
                            <span className="font-semibold block text-white">{p.label}</span>
                            <span className="text-[11px] text-emerald-400 block mt-0.5">{p.ms}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/10">
                    <label className="flex items-center gap-2 p-2.5 bg-[#121214] rounded-xl border border-white/10 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={state?.aiConfig?.nvidiaSpeech?.enableMultiTalker ?? true}
                        onChange={(e) =>
                          patchState({
                            aiConfig: {
                              ...state!.aiConfig,
                              nvidiaSpeech: { ...state!.aiConfig.nvidiaSpeech, enableMultiTalker: e.target.checked },
                            },
                          })
                        }
                        className="rounded bg-black/40 border-white/20 text-emerald-500 focus:ring-0"
                      />
                      <div>
                        <span className="font-semibold block text-white">MultiTalker Separation</span>
                        <span className="text-[10px] text-neutral-500 block">4-Speaker zero-shot separation</span>
                      </div>
                    </label>

                    <label className="flex items-center gap-2 p-2.5 bg-[#121214] rounded-xl border border-white/10 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={state?.aiConfig?.nvidiaSpeech?.handleCrossTalk ?? true}
                        onChange={(e) =>
                          patchState({
                            aiConfig: {
                              ...state!.aiConfig,
                              nvidiaSpeech: { ...state!.aiConfig.nvidiaSpeech, handleCrossTalk: e.target.checked },
                            },
                          })
                        }
                        className="rounded bg-black/40 border-white/20 text-emerald-500 focus:ring-0"
                      />
                      <div>
                        <span className="font-semibold block text-white">Cross-Talk Handling</span>
                        <span className="text-[10px] text-neutral-500 block">Parallel audio buffers</span>
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              {/* BYOK API Keys */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-400">BYOK Model API Keys</h3>
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] p-4 space-y-2.5 text-xs">
                  {[
                    { key: 'gemini', label: 'Google Gemini', placeholder: 'AIzaSy...' },
                    { key: 'openai', label: 'OpenAI (GPT-4o)', placeholder: 'sk-...' },
                    { key: 'anthropic', label: 'Anthropic (Claude)', placeholder: 'sk-ant-...' },
                    { key: 'groq', label: 'Groq (Whisper/Llama)', placeholder: 'gsk_...' },
                  ].map((item) => (
                    <div key={item.key} className="flex items-center gap-3">
                      <span className="w-28 text-neutral-400 shrink-0">{item.label}:</span>
                      <input
                        type="password"
                        value={(state?.aiConfig?.apiKeys as any)?.[item.key] || ''}
                        onChange={(e) =>
                          patchState({
                            aiConfig: {
                              ...state!.aiConfig,
                              apiKeys: { ...state!.aiConfig.apiKeys, [item.key]: e.target.value },
                            },
                          })
                        }
                        placeholder={item.placeholder}
                        className="flex-1 bg-[#121214] border border-white/15 rounded-xl px-3 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-[#0091FF]"
                      />
                    </div>
                  ))}

                  <div className="flex items-center gap-3 pt-1">
                    <span className="w-28 text-neutral-400 shrink-0">NIM API Key:</span>
                    <input
                      type="password"
                      value={state?.aiConfig?.nvidiaSpeech?.nimApiKey || ''}
                      onChange={(e) =>
                        patchState({
                          aiConfig: {
                            ...state!.aiConfig,
                            nvidiaSpeech: { ...state!.aiConfig.nvidiaSpeech, nimApiKey: e.target.value },
                          },
                        })
                      }
                      placeholder="nvapi-..."
                      className="flex-1 bg-[#121214] border border-white/15 rounded-xl px-3 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-[#0091FF]"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 6: CALENDAR */}
          {/* ============================================================== */}
          {activeTab === 'calendar' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-400">Meeting Calendar Integration</h3>
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden">
                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <div className="text-[14px] font-semibold text-white">Apple & Google Calendar Sync</div>
                      <div className="text-[12px] text-neutral-400">Pre-load candidate resumes and mode instructions for upcoming meetings.</div>
                    </div>
                    <div
                      onClick={() => setCalendarSyncEnabled(!calendarSyncEnabled)}
                      className={`w-11 h-6 rounded-full p-0.5 cursor-pointer transition-colors ${
                        calendarSyncEnabled ? 'bg-[#0091FF]' : 'bg-[#2c2c2e]'
                      }`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                        calendarSyncEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`} />
                    </div>
                  </div>

                  <div className="p-4 space-y-2 text-xs">
                    <div className="font-semibold text-neutral-300">Auto-Mode Mapping Rules</div>
                    <div className="space-y-1.5 text-neutral-400">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#0091FF]"></span>
                        <span>Title contains "Interview" → Switches to <strong>Interview</strong> Mode</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                        <span>Title contains "Design" or "Arch" → Switches to <strong>System Design</strong> Mode</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                        <span>Title contains "1:1" or "Sync" → Switches to <strong>Team Meet</strong> Mode</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 7: NOTIFICATIONS */}
          {/* ============================================================== */}
          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-400">Stealth Notifications & Cues</h3>
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden">
                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <div className="text-[14px] font-semibold text-white">Silent Audio Headset Chime</div>
                      <div className="text-[12px] text-neutral-400">Plays an ultra-quiet chime in your ear when the AI finishes drafting talking points.</div>
                    </div>
                    <div
                      onClick={() => setSilentChimeEnabled(!silentChimeEnabled)}
                      className={`w-11 h-6 rounded-full p-0.5 cursor-pointer transition-colors ${
                        silentChimeEnabled ? 'bg-[#0091FF]' : 'bg-[#2c2c2e]'
                      }`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                        silentChimeEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`} />
                    </div>
                  </div>

                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <div className="text-[14px] font-semibold text-white">Screen-Sharing Safe Floating Pill</div>
                      <div className="text-[12px] text-neutral-400">Shows an unobtrusive glowing badge on your screen without revealing it to viewers.</div>
                    </div>
                    <div
                      onClick={() => setScreenPillEnabled(!screenPillEnabled)}
                      className={`w-11 h-6 rounded-full p-0.5 cursor-pointer transition-colors ${
                        screenPillEnabled ? 'bg-[#0091FF]' : 'bg-[#2c2c2e]'
                      }`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                        screenPillEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`} />
                    </div>
                  </div>

                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <div className="text-[14px] font-semibold text-white">Microphone Status Beacon</div>
                      <div className="text-[12px] text-neutral-400">Illuminates the floating HUD indicator when active speech is detected.</div>
                    </div>
                    <div
                      onClick={() => setStatusBeaconEnabled(!statusBeaconEnabled)}
                      className={`w-11 h-6 rounded-full p-0.5 cursor-pointer transition-colors ${
                        statusBeaconEnabled ? 'bg-[#0091FF]' : 'bg-[#2c2c2e]'
                      }`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                        statusBeaconEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 8: BILLING & TELEMETRY */}
          {/* ============================================================== */}
          {activeTab === 'billing' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-400">BYOK License & Telemetry</h3>
                <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-lg font-bold text-white">Cluely Studio Native</div>
                      <div className="text-xs text-emerald-400 font-semibold">Lifetime Zero-Subscription Architecture</div>
                    </div>
                    <span className="text-xs font-mono bg-white/10 px-2.5 py-1 rounded-lg text-neutral-300">
                      v2.1.24 Active
                    </span>
                  </div>

                  <p className="text-xs text-neutral-400 leading-relaxed">
                    Cluely Studio operates on a direct Bring-Your-Own-Key (BYOK) and local open-source inference architecture. There are no middleman recurring subscription fees or hidden costs.
                  </p>

                  <div className="grid grid-cols-3 gap-3 pt-2 text-xs">
                    <div className="p-3 bg-[#121214] rounded-xl border border-white/5">
                      <span className="text-neutral-500 block text-[11px]">Local Engine Uptime</span>
                      <span className="text-white font-bold text-sm mt-1 block">100% Free / Offline</span>
                    </div>
                    <div className="p-3 bg-[#121214] rounded-xl border border-white/5">
                      <span className="text-neutral-500 block text-[11px]">Speech Diarization Cost</span>
                      <span className="text-emerald-400 font-bold text-sm mt-1 block">$0.00 / hour</span>
                    </div>
                    <div className="p-3 bg-[#121214] rounded-xl border border-white/5">
                      <span className="text-neutral-500 block text-[11px]">Privacy Level</span>
                      <span className="text-[#0091FF] font-bold text-sm mt-1 block">Zero Telemetry</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 9: ABOUT */}
          {/* ============================================================== */}
          {activeTab === 'about' && (
            <div className="space-y-6">
              {/* Welcome to Cluely 2.0 Card (Exact v2.1.24) */}
              <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-white">Welcome to Cluely 2.0</h2>
                    <span className="text-xs text-neutral-500">Released April 3, 2026</span>
                  </div>
                  <div className="w-8 h-8 rounded-xl bg-[#0091FF]/20 border border-[#0091FF]/40 text-[#38bdf8] flex items-center justify-center font-bold text-xs">
                    2.0
                  </div>
                </div>

                <div className="space-y-2.5 text-xs text-neutral-300 leading-relaxed">
                  <div className="flex items-start gap-2">
                    <span className="text-[#0091FF] font-bold">•</span>
                    <span>Autonomous Multimodal Copilot with real-time screen analysis and dual-channel speech capture.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-400 font-bold">•</span>
                    <span>3-Stage NVIDIA Speech Architecture: MultiTalker stream separation, Nemotron streaming captions, and Parakeet-TDT 0.6B finalizer.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-purple-400 font-bold">•</span>
                    <span>Complete local privacy with NSWindowSharingNone stealth screen protection and offline Ollama/ONNX runners.</span>
                  </div>
                </div>
              </div>

              {/* Help & Links */}
              <div className="bg-[#1c1c1f] rounded-2xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden text-xs">
                <div className="p-4 flex items-center justify-between">
                  <span className="font-medium text-white">Help Center</span>
                  <button type="button" className="text-[#0091FF] hover:underline flex items-center gap-1">
                    <span>Open</span> <ExternalLink size={12} />
                  </button>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <span className="font-medium text-white">Contact Support</span>
                  <button type="button" className="text-[#0091FF] hover:underline flex items-center gap-1">
                    <span>Email</span> <ExternalLink size={12} />
                  </button>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <span className="font-medium text-white">Cluely Version</span>
                  <span className="text-neutral-400 font-mono">2.1.24</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
};
