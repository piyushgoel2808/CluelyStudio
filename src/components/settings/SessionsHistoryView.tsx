import React, { useState, useMemo } from 'react';
import {
  ArrowLeft,
  Search,
  Calendar,
  FileText,
  Copy,
  Check,
  RotateCw,
  Plus,
  Play,
  Sparkles,
} from 'lucide-react';
import { AppState, MeetingSession } from '../../types/ipc';

interface SessionsHistoryViewProps {
  state: AppState | null;
  patchState: (delta: Partial<AppState>) => Promise<AppState | null | undefined>;
  onBackToSettings?: () => void;
}

export const SessionsHistoryView: React.FC<SessionsHistoryViewProps> = ({
  state,
  patchState,
  onBackToSettings,
}) => {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedTranscript, setCopiedTranscript] = useState<boolean>(false);
  const [copiedAssistId, setCopiedAssistId] = useState<string | null>(null);
  const [showSummaryModal, setShowSummaryModal] = useState<boolean>(false);

  const pastSessions = useMemo(() => {
    return state?.pastSessions || [];
  }, [state?.pastSessions]);

  const selectedSession = useMemo(() => {
    if (!selectedSessionId) return null;
    return pastSessions.find((s) => s.id === selectedSessionId) || null;
  }, [selectedSessionId, pastSessions]);

  // Format date grouping header (e.g. "SAT, SEP 19, 2026")
  const formatDateHeader = (timestamp: number) => {
    const d = new Date(timestamp);
    const day = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    const dateNum = d.getDate();
    const year = d.getFullYear();
    return `${day}, ${month} ${dateNum}, ${year}`;
  };

  // Format clock time (e.g. "14:35")
  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    const hours = d.getHours().toString().padStart(2, '0');
    const mins = d.getMinutes().toString().padStart(2, '0');
    return `${hours}:${mins}`;
  };

  // Format duration (e.g. "1h 20m" or "57m" or "16m")
  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return '1m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) {
      return `${h}h ${m}m`;
    }
    return `${Math.max(1, m)}m`;
  };

  // Filter sessions by search query
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return pastSessions;
    const q = searchQuery.toLowerCase();
    return pastSessions.filter((s) => {
      const matchTitle = s.title.toLowerCase().includes(q);
      const matchTranscript = s.transcripts?.some((t) => t.text.toLowerCase().includes(q));
      const matchAssist = s.assistEvents?.some(
        (a) => a.userPrompt.toLowerCase().includes(q) || a.aiResponse.toLowerCase().includes(q)
      );
      return matchTitle || matchTranscript || matchAssist;
    });
  }, [pastSessions, searchQuery]);

  // Group filtered sessions by date
  const groupedSessions = useMemo(() => {
    const map = new Map<string, MeetingSession[]>();
    for (const session of filteredSessions) {
      const dateKey = formatDateHeader(session.startTime);
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(session);
    }
    return Array.from(map.entries());
  }, [filteredSessions]);

  // Combine & sort transcript utterances and AI Assist events chronologically
  const timelineItems = useMemo(() => {
    if (!selectedSession) return [];

    type TimelineItem =
      | { type: 'transcript'; offsetMs: number; data: (typeof selectedSession.transcripts)[number] }
      | { type: 'assist'; offsetMs: number; data: NonNullable<typeof selectedSession.assistEvents>[number] };

    const items: TimelineItem[] = [];

    (selectedSession.transcripts || []).forEach((t) => {
      items.push({
        type: 'transcript',
        offsetMs: t.startTimeMs || 0,
        data: t,
      });
    });

    (selectedSession.assistEvents || []).forEach((a) => {
      items.push({
        type: 'assist',
        offsetMs: a.offsetSeconds * 1000,
        data: a,
      });
    });

    items.sort((a, b) => a.offsetMs - b.offsetMs);
    return items;
  }, [selectedSession]);

  // Copy full transcript text
  const handleCopyTranscript = () => {
    if (!selectedSession) return;
    const lines = (selectedSession.transcripts || []).map((t) => {
      const offset = Math.floor((t.startTimeMs || 0) / 1000);
      const mins = Math.floor(offset / 60);
      const secs = offset % 60;
      const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
      return `${timeStr} [${t.speakerLabel || 'Speaker'}]: ${t.text}`;
    });

    if (selectedSession.assistEvents && selectedSession.assistEvents.length > 0) {
      lines.push('\n--- AI ASSIST RESPONSES ---');
      for (const a of selectedSession.assistEvents) {
        lines.push(`[${a.formattedOffset}] Q: ${a.userPrompt}\nA: ${a.aiResponse}\n`);
      }
    }

    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2000);
  };

  // Start fresh chat / session
  const handleStartNewSession = () => {
    const newSession: MeetingSession = {
      id: `sess_${Date.now()}`,
      title: 'Untitled session',
      startTime: Date.now(),
      durationSeconds: 0,
      transcripts: [],
      assistEvents: [],
      status: 'active',
    };
    patchState({
      pastSessions: [newSession, ...pastSessions],
      currentSessionId: newSession.id,
      isSessionActive: true,
      transcripts: [],
    });
    setSelectedSessionId(newSession.id);
  };

  // Resume active session
  const handleResumeSession = (session: MeetingSession) => {
    patchState({
      currentSessionId: session.id,
      isSessionActive: true,
      transcripts: session.transcripts || [],
    });
    window.cluely?.toggleOverlay();
  };

  // =========================================================================
  // VIEW 1: DETAIL VIEW FOR SELECTED SESSION (Matching Image 3)
  // =========================================================================
  if (selectedSession) {
    const sessionDateBadge = new Date(selectedSession.startTime).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
    });

    return (
      <div className="flex flex-col h-full bg-[#101012] text-white">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelectedSessionId(null)}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition cursor-pointer"
              title="Back to Sessions"
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                {selectedSession.title}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="flex items-center gap-1 bg-white/10 text-white/80 text-[11px] font-medium px-2 py-0.5 rounded-md">
                  <Calendar size={11} className="text-white/60" /> {sessionDateBadge}
                </span>
                <span className="bg-white/10 text-white/80 text-[11px] font-medium px-2 py-0.5 rounded-md">
                  👤 Me
                </span>
                <span className="text-[11px] text-neutral-400 font-mono">
                  Duration: {formatDuration(selectedSession.durationSeconds)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyTranscript}
              className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition cursor-pointer"
            >
              {copiedTranscript ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              <span>{copiedTranscript ? 'Copied Transcript' : 'Copy Transcript'}</span>
            </button>
          </div>
        </div>

        {/* User Account Chip */}
        <div className="py-3 flex items-center justify-between border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs border border-emerald-500/30">
              ME
            </div>
            <div>
              <span className="text-xs font-semibold text-white block">Me</span>
              <span className="text-[11px] text-neutral-400 font-mono">
                piyushgoel2888@gmail.com
              </span>
            </div>
          </div>
          <span className="text-xs text-neutral-400 font-semibold uppercase tracking-wider">
            TRANSCRIPT & AI RESPONSES
          </span>
        </div>

        {/* Chronological Transcript Utterances & AI Assist Events (Interleaved) */}
        <div className="flex-1 overflow-y-auto py-4 space-y-3.5 pr-2 custom-scrollbar">
          {timelineItems.length === 0 && (
            <div className="py-12 text-center text-white/40 text-xs">
              No transcript or AI assist entries recorded for this session yet.
            </div>
          )}

          {timelineItems.map((item, idx) => {
            if (item.type === 'transcript') {
              const t = item.data;
              const offsetSec = Math.floor((item.offsetMs || 0) / 1000);
              const mins = Math.floor(offsetSec / 60);
              const secs = offsetSec % 60;
              const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

              return (
                <div key={`tr_${t.id || idx}`} className="flex items-start gap-3 text-[13px] group">
                  <span className="text-[11px] font-mono text-neutral-500 shrink-0 w-8 pt-0.5 select-none">
                    {timeStr}
                  </span>
                  <span className="text-[11px] font-bold text-sky-400 uppercase shrink-0 pt-0.5">
                    {t.speakerLabel || 'ME'}
                  </span>
                  <p className="text-white/90 leading-relaxed font-normal">{t.text}</p>
                </div>
              );
            } else {
              const a = item.data;
              return (
                <div
                  key={`as_${a.id}`}
                  className="my-3 bg-[#18181c] border border-sky-500/25 rounded-xl p-3.5 text-xs space-y-2 shadow-lg relative ml-6"
                >
                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sky-300 font-semibold bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20">
                        {a.formattedOffset}
                      </span>
                      <span className="text-white/80 font-medium flex items-center gap-1">
                        <Sparkles size={11} className="text-sky-400" />
                        Mode: {a.modeName || 'Copilot'}
                      </span>
                      <span className="bg-white/10 text-neutral-300 px-2 py-0.5 rounded font-mono text-[10px]">
                        {a.userPrompt}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(a.aiResponse);
                        setCopiedAssistId(a.id);
                        setTimeout(() => setCopiedAssistId(null), 2000);
                      }}
                      className="text-white/50 hover:text-white flex items-center gap-1 cursor-pointer transition"
                    >
                      {copiedAssistId === a.id ? (
                        <Check size={11} className="text-emerald-400" />
                      ) : (
                        <Copy size={11} />
                      )}
                      <span>{copiedAssistId === a.id ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>

                  <div className="text-white/95 bg-[#121214] rounded-lg p-2.5 font-normal leading-relaxed border border-white/[0.06] whitespace-pre-wrap font-sans">
                    {a.aiResponse}
                  </div>
                </div>
              );
            }
          })}
        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSelectedSessionId(null)}
            className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition cursor-pointer"
          >
            <ArrowLeft size={13} />
            <span>Back to Sessions</span>
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowSummaryModal(true)}
              className="flex items-center gap-1.5 text-xs text-white/80 hover:text-white bg-white/10 hover:bg-white/15 px-3 py-1.5 rounded-lg transition cursor-pointer"
            >
              <FileText size={13} />
              <span>Show Summary</span>
            </button>

            <button
              type="button"
              onClick={() => handleResumeSession(selectedSession)}
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-[#0091FF] hover:bg-sky-400 px-3.5 py-1.5 rounded-lg transition shadow cursor-pointer active:scale-95"
            >
              <Play size={12} className="fill-current" />
              <span>Resume session</span>
            </button>
          </div>
        </div>

        {/* Summary Modal */}
        {showSummaryModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-[#1c1c20] border border-white/10 rounded-2xl p-5 max-w-lg w-full shadow-2xl space-y-3">
              <h3 className="text-base font-bold text-white">Meeting Summary</h3>
              <p className="text-xs text-neutral-300 leading-relaxed">
                {selectedSession.summary ||
                  'No automatic AI summary generated yet for this session. Use the Recap action in live overlay to create instant structured takeaways.'}
              </p>
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowSummaryModal(false)}
                  className="text-xs text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: SESSIONS & HISTORY LIST VIEW (Matching Images 1, 2, 4)
  // =========================================================================
  return (
    <div className="flex flex-col h-full bg-[#101012] text-white">
      {/* Search Bar at Top */}
      <div className="relative mb-5 flex items-center gap-2">
        {onBackToSettings && (
          <button
            type="button"
            onClick={onBackToSettings}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition cursor-pointer shrink-0"
            title="Back"
          >
            <ArrowLeft size={16} />
          </button>
        )}

        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Ask or search anything"
            className="w-full bg-[#1a1a1e] border border-white/[0.08] rounded-xl px-4 py-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-sky-500 transition pr-10"
          />
          <Search size={15} className="absolute right-3.5 top-3 text-neutral-500 pointer-events-none" />
        </div>
      </div>

      {/* Main List Scroll View */}
      <div className="flex-1 overflow-y-auto space-y-6 pr-1 custom-scrollbar">
        {/* UPCOMING Section */}
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500 tracking-wider uppercase mb-2">
            <span>UPCOMING</span>
            <RotateCw size={11} className="text-neutral-500 cursor-pointer hover:text-white" />
          </div>

          <div className="bg-[#18181c] border border-white/[0.06] rounded-xl p-3 flex items-center gap-3 text-xs text-neutral-300 hover:border-white/10 transition cursor-pointer">
            <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-neutral-400">
              <Calendar size={16} />
            </div>
            <span className="font-medium text-white/90">Connect your calendar</span>
          </div>
        </div>

        {/* Grouped Sessions by Date */}
        {groupedSessions.length === 0 ? (
          <div className="py-12 text-center text-white/40 text-xs">
            {searchQuery ? 'No sessions matching search query.' : 'No recorded sessions yet.'}
          </div>
        ) : (
          groupedSessions.map(([dateHeader, sessions]) => (
            <div key={dateHeader}>
              <div className="text-[11px] font-semibold text-neutral-500 tracking-wider uppercase mb-2">
                {dateHeader}
              </div>

              <div className="space-y-1.5">
                {sessions.map((sess) => (
                  <div
                    key={sess.id}
                    onClick={() => setSelectedSessionId(sess.id)}
                    className="bg-[#18181c] hover:bg-[#202025] border border-white/[0.06] hover:border-white/10 rounded-xl px-3.5 py-3 flex items-center justify-between transition cursor-pointer group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-neutral-400 group-hover:text-white transition">
                        <FileText size={16} />
                      </div>
                      <div>
                        <span className="text-[13px] font-medium text-white/95 group-hover:text-white transition block">
                          {sess.title}
                        </span>
                        {sess.status === 'active' && (
                          <span className="inline-block mt-0.5 text-[10px] text-emerald-400 font-semibold">
                            ● Live Active
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs">
                      <span className="bg-white/10 text-white/70 font-mono text-[11px] px-2 py-0.5 rounded-md">
                        {formatDuration(sess.durationSeconds)}
                      </span>
                      <span className="text-neutral-500 font-mono text-[11px] w-12 text-right">
                        {formatTime(sess.startTime)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer (Matching Image 1: Open ↵ and + New chat ⌘ R) */}
      <div className="pt-4 mt-2 border-t border-white/[0.08] flex items-center justify-between text-xs text-neutral-400 select-none">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-sky-400" />
          <span className="text-white/80 font-medium">Cluely Session Manager</span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleStartNewSession}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/15 text-white px-3 py-1.5 rounded-lg transition font-medium cursor-pointer"
          >
            <Plus size={13} />
            <span>New chat</span>
            <span className="text-[10px] text-neutral-400 ml-1 font-mono">⌘ R</span>
          </button>
        </div>
      </div>
    </div>
  );
};
