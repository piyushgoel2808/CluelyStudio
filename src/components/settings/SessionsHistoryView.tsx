import React, { useState, useMemo, useEffect } from 'react';
import {
  ArrowLeft,
  Search,
  Calendar,
  FileText,
  Copy,
  Check,
  Plus,
  Play,
  Sparkles,
  Trash2,
  Brain,
  CheckCircle2,
  ListChecks,
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
  const [notesInput, setNotesInput] = useState<string>('');
  const [titleInput, setTitleInput] = useState<string>('');
  const [isGeneratingNotes, setIsGeneratingNotes] = useState<boolean>(false);
  const [isExtractingFacts, setIsExtractingFacts] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const pastSessions = useMemo(() => {
    return state?.pastSessions || [];
  }, [state?.pastSessions]);

  const selectedSession = useMemo(() => {
    if (!selectedSessionId) return null;
    return pastSessions.find((s) => s.id === selectedSessionId) || null;
  }, [selectedSessionId, pastSessions]);

  useEffect(() => {
    if (selectedSession) {
      setNotesInput(selectedSession.notes || '');
      setTitleInput(selectedSession.title || 'Meeting Session');
    }
  }, [selectedSession?.id, selectedSession?.notes, selectedSession?.title]);

  const formatDateHeader = (timestamp: number) => {
    const d = new Date(timestamp);
    const day = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    const dateNum = d.getDate();
    const year = d.getFullYear();
    return `${day}, ${month} ${dateNum}, ${year}`;
  };

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    const hours = d.getHours().toString().padStart(2, '0');
    const mins = d.getMinutes().toString().padStart(2, '0');
    return `${hours}:${mins}`;
  };

  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return '< 1m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return pastSessions;
    const q = searchQuery.toLowerCase();
    return pastSessions.filter((s) => {
      const matchTitle = s.title.toLowerCase().includes(q);
      const matchNotes = (s.notes || '').toLowerCase().includes(q);
      const matchSummary = (s.summary || '').toLowerCase().includes(q);
      const matchTranscript = s.transcripts?.some((t) => t.text.toLowerCase().includes(q));
      const matchAssist = s.assistEvents?.some(
        (a) => a.userPrompt.toLowerCase().includes(q) || a.aiResponse.toLowerCase().includes(q)
      );
      return matchTitle || matchNotes || matchSummary || matchTranscript || matchAssist;
    });
  }, [pastSessions, searchQuery]);

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

  const handleCopyFullSessionReport = () => {
    if (!selectedSession) return;
    const parts: string[] = [];
    parts.push(`# ${selectedSession.title}`);
    parts.push(`Date: ${new Date(selectedSession.startTime).toLocaleString()}`);
    if (selectedSession.summary) {
      parts.push(`\n## Executive Summary\n${selectedSession.summary}`);
    }
    if (selectedSession.notes) {
      parts.push(`\n## Session Notes\n${selectedSession.notes}`);
    }
    if (selectedSession.actionItems && selectedSession.actionItems.length > 0) {
      parts.push(`\n## Action Items\n${selectedSession.actionItems.map((i) => `- [ ] ${i}`).join('\n')}`);
    }
    if (selectedSession.assistEvents && selectedSession.assistEvents.length > 0) {
      parts.push(`\n## AI Copilot Q&A Log`);
      for (const a of selectedSession.assistEvents) {
        parts.push(`### [${a.formattedOffset}] ${a.userPrompt}\n${a.aiResponse}\n`);
      }
    }
    if (selectedSession.transcripts && selectedSession.transcripts.length > 0) {
      parts.push(`\n## Full Transcript`);
      for (const t of selectedSession.transcripts) {
        parts.push(`${t.formattedTimestamp || ''} [${t.speakerLabel || t.role}]: ${t.text}`);
      }
    }

    navigator.clipboard.writeText(parts.join('\n'));
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2000);
  };

  const handleSaveNotesAndTitle = async () => {
    if (!selectedSession || !window.cluely?.updateSessionNotes) return;
    await window.cluely.updateSessionNotes(selectedSession.id, notesInput, titleInput.trim() || selectedSession.title);
    setStatusMsg('Saved session title & notes');
    setTimeout(() => setStatusMsg(null), 2500);
  };

  const handleGenerateNotes = async () => {
    if (!selectedSession || !window.cluely?.generateSessionNotes) return;
    setIsGeneratingNotes(true);
    setStatusMsg(null);
    try {
      const updated = await window.cluely.generateSessionNotes(selectedSession.id);
      if (updated) {
        setNotesInput(updated.notes || '');
        setTitleInput(updated.title || selectedSession.title);
        setStatusMsg('Generated structured notes, summary & action items via local AI');
      }
    } catch {
      setStatusMsg('Failed to generate notes');
    } finally {
      setIsGeneratingNotes(false);
      setTimeout(() => setStatusMsg(null), 3500);
    }
  };

  const handleExtractFacts = async () => {
    if (!selectedSession || !window.cluely?.extractMemoriesFromTranscript) return;
    setIsExtractingFacts(true);
    setStatusMsg(null);
    try {
      const extracted = await window.cluely.extractMemoriesFromTranscript(selectedSession.transcripts || []);
      setStatusMsg(`Extracted ${extracted.length} permanent facts into Local Vector DB`);
    } catch {
      setStatusMsg('Failed to extract facts');
    } finally {
      setIsExtractingFacts(false);
      setTimeout(() => setStatusMsg(null), 3500);
    }
  };

  const handleDeleteSession = async (sessionId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (window.cluely?.deleteSession) {
      await window.cluely.deleteSession(sessionId);
    } else {
      const filtered = pastSessions.filter((s) => s.id !== sessionId);
      await patchState({ pastSessions: filtered });
    }
    if (selectedSessionId === sessionId) {
      setSelectedSessionId(null);
    }
  };

  const handleStartNewSession = async () => {
    if (window.cluely?.startSession) {
      await window.cluely.startSession();
      const updated = await window.cluely.getState();
      if (updated.currentSessionId) {
        setSelectedSessionId(updated.currentSessionId);
      }
      return;
    }
    const newSession: MeetingSession = {
      id: `sess_${Date.now()}`,
      title: `Meeting Session — ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      startTime: Date.now(),
      durationSeconds: 0,
      transcripts: [],
      assistEvents: [],
      notes: '',
      actionItems: [],
      keyDecisions: [],
      status: 'active',
    };
    await patchState({
      pastSessions: [newSession, ...pastSessions],
      currentSessionId: newSession.id,
      isSessionActive: true,
      transcripts: [],
    });
    setSelectedSessionId(newSession.id);
  };

  const handleResumeSession = (session: MeetingSession) => {
    patchState({
      currentSessionId: session.id,
      isSessionActive: true,
      transcripts: session.transcripts || [],
    });
    window.cluely?.toggleOverlay();
  };

  // =========================================================================
  // VIEW 1: SESSION WORKSPACE DETAIL VIEW (NOTES, SUMMARY, Q&A & TRANSCRIPT)
  // =========================================================================
  if (selectedSession) {
    const sessionDateBadge = new Date(selectedSession.startTime).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    return (
      <div className="flex flex-col h-full bg-[#101012] text-white">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-3 flex-1 mr-4">
            <button
              type="button"
              onClick={() => setSelectedSessionId(null)}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition cursor-pointer shrink-0"
              title="Back to All Sessions"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="flex-1">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onBlur={handleSaveNotesAndTitle}
                className="text-lg font-bold text-white bg-transparent border-b border-transparent hover:border-white/20 focus:border-sky-400 focus:outline-none w-full"
              />
              <div className="flex items-center gap-2 mt-1">
                <span className="flex items-center gap-1 bg-white/10 text-white/80 text-[11px] font-medium px-2 py-0.5 rounded-md">
                  <Calendar size={11} className="text-white/60" /> {sessionDateBadge}
                </span>
                <span className="text-[11px] text-neutral-400 font-mono">
                  Duration: {formatDuration(selectedSession.durationSeconds)}
                </span>
                <span className="text-[11px] text-sky-400 font-mono">
                  • {selectedSession.transcripts?.length || 0} Utterances •{' '}
                  {selectedSession.assistEvents?.length || 0} AI Assists
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isGeneratingNotes}
              onClick={handleGenerateNotes}
              className="flex items-center gap-1.5 text-xs text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-50"
            >
              <Sparkles size={13} />
              <span>{isGeneratingNotes ? 'Synthesizing...' : 'AI Auto-Summary & Notes'}</span>
            </button>

            <button
              type="button"
              disabled={isExtractingFacts || (selectedSession.transcripts?.length || 0) === 0}
              onClick={handleExtractFacts}
              className="flex items-center gap-1.5 text-xs text-purple-300 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-40"
            >
              <Brain size={13} />
              <span>{isExtractingFacts ? 'Indexing...' : 'Extract to Vector DB'}</span>
            </button>

            <button
              type="button"
              onClick={handleCopyFullSessionReport}
              className="flex items-center gap-1.5 text-xs text-white/80 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition cursor-pointer"
            >
              {copiedTranscript ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              <span>{copiedTranscript ? 'Copied Markdown' : 'Export Markdown'}</span>
            </button>
          </div>
        </div>

        {statusMsg && (
          <div className="mt-3 px-3.5 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
            <span>{statusMsg}</span>
            <CheckCircle2 size={14} />
          </div>
        )}

        {/* Two-Column Personal Assistant Workspace: Left = Notes & Summary, Right = Chronological Timeline */}
        <div className="flex-1 grid grid-cols-12 gap-5 overflow-hidden py-4">
          {/* Left Column (5 cols): Executive Summary, Action Items & Editable Notes */}
          <div className="col-span-5 flex flex-col gap-3 overflow-y-auto pr-1">
            {selectedSession.summary && (
              <div className="bg-[#18181c] border border-white/10 rounded-xl p-3.5 space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-400">
                  Executive Summary
                </div>
                <p className="text-xs text-neutral-200 leading-relaxed">{selectedSession.summary}</p>
              </div>
            )}

            {selectedSession.actionItems && selectedSession.actionItems.length > 0 && (
              <div className="bg-[#18181c] border border-white/10 rounded-xl p-3.5 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <ListChecks size={13} />
                  <span>Action Items & Next Steps</span>
                </div>
                <ul className="space-y-1 text-xs text-neutral-200">
                  {selectedSession.actionItems.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex-1 flex flex-col bg-[#18181c] border border-white/10 rounded-xl p-3.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  Session Notes (Markdown)
                </span>
                <button
                  type="button"
                  onClick={handleSaveNotesAndTitle}
                  className="text-[11px] text-sky-400 hover:text-sky-300 font-medium cursor-pointer"
                >
                  Save Notes
                </button>
              </div>
              <textarea
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                onBlur={handleSaveNotesAndTitle}
                placeholder="Write meeting notes here, or click 'AI Auto-Summary & Notes' above to synthesize notes from the conversation..."
                className="flex-1 w-full bg-[#121215] border border-white/10 rounded-lg p-3 text-xs text-white/90 placeholder-neutral-500 focus:outline-none focus:border-sky-400 leading-relaxed resize-none"
              />
            </div>
          </div>

          {/* Right Column (7 cols): Interleaved Transcript & AI Copilot Q&A */}
          <div className="col-span-7 flex flex-col bg-[#16161a] border border-white/10 rounded-xl p-4 overflow-hidden">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 pb-2.5 border-b border-white/[0.08] flex items-center justify-between">
              <span>Chronological Transcript & AI Copilot Responses</span>
              <span className="font-mono text-[10px] text-neutral-500">
                {timelineItems.length} events
              </span>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-3 pr-1">
              {timelineItems.length === 0 ? (
                <div className="py-12 text-center text-white/40 text-xs">
                  No spoken transcript or AI assist events recorded in this session yet.
                </div>
              ) : (
                timelineItems.map((item, idx) => {
                  if (item.type === 'transcript') {
                    const t = item.data;
                    const offsetSec = Math.floor((item.offsetMs || 0) / 1000);
                    const mins = Math.floor(offsetSec / 60);
                    const secs = offsetSec % 60;
                    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

                    return (
                      <div key={`tr_${t.id || idx}`} className="flex items-start gap-3 text-[13px]">
                        <span className="text-[11px] font-mono text-neutral-500 shrink-0 w-9 pt-0.5 select-none">
                          {timeStr}
                        </span>
                        <span
                          className={`text-[11px] font-bold uppercase shrink-0 pt-0.5 w-20 truncate ${
                            t.role === 'me' ? 'text-emerald-400' : 'text-sky-400'
                          }`}
                        >
                          {t.speakerLabel || (t.role === 'me' ? 'ME' : 'THEM')}
                        </span>
                        <p className="text-white/90 leading-relaxed font-normal flex-1">{t.text}</p>
                      </div>
                    );
                  } else {
                    const a = item.data;
                    return (
                      <div
                        key={`as_${a.id}`}
                        className="my-2 bg-[#1e1e24] border border-sky-500/30 rounded-xl p-3 text-xs space-y-2 shadow-md ml-6"
                      >
                        <div className="flex items-center justify-between text-[11px] text-neutral-400">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-sky-300 font-semibold bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20 shrink-0">
                              {a.formattedOffset}
                            </span>
                            <span className="text-white/80 font-medium flex items-center gap-1 shrink-0">
                              <Sparkles size={11} className="text-sky-400" />
                              {a.modeName || 'Copilot'}
                            </span>
                            <span className="bg-white/10 text-neutral-200 px-2 py-0.5 rounded font-mono text-[10px] truncate">
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
                            className="text-white/50 hover:text-white flex items-center gap-1 cursor-pointer transition shrink-0 ml-2"
                          >
                            {copiedAssistId === a.id ? (
                              <Check size={11} className="text-emerald-400" />
                            ) : (
                              <Copy size={11} />
                            )}
                            <span>{copiedAssistId === a.id ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>

                        <div className="text-white/95 bg-[#121215] rounded-lg p-2.5 font-normal leading-relaxed border border-white/[0.06] whitespace-pre-wrap font-sans">
                          {a.aiResponse}
                        </div>
                      </div>
                    );
                  }
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-3 border-t border-white/[0.08] flex items-center justify-between">
          <button
            type="button"
            onClick={(e) => handleDeleteSession(selectedSession.id, e)}
            className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-3 py-1.5 rounded-lg transition cursor-pointer"
          >
            <Trash2 size={13} />
            <span>Delete Session</span>
          </button>

          <button
            type="button"
            onClick={() => handleResumeSession(selectedSession)}
            className="flex items-center gap-1.5 text-xs font-semibold text-white bg-[#0091FF] hover:bg-sky-400 px-4 py-1.5 rounded-lg transition shadow cursor-pointer active:scale-95"
          >
            <Play size={12} className="fill-current" />
            <span>Resume Session in HUD</span>
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: SESSIONS & HISTORY LIST VIEW
  // =========================================================================
  return (
    <div className="flex flex-col h-full bg-[#101012] text-white">
      <div className="relative mb-5 flex items-center gap-3">
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
            placeholder="Search across all session titles, transcripts, notes, and AI answers..."
            className="w-full bg-[#1a1a1e] border border-white/[0.08] rounded-xl px-4 py-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-sky-500 transition pr-10"
          />
          <Search size={15} className="absolute right-3.5 top-2.5 text-neutral-500 pointer-events-none" />
        </div>

        <button
          type="button"
          onClick={handleStartNewSession}
          className="flex items-center gap-1.5 bg-[#0091FF] hover:bg-sky-400 text-white text-xs font-semibold px-3.5 py-2.5 rounded-xl transition cursor-pointer shrink-0 shadow"
        >
          <Plus size={14} />
          <span>New Session</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-6 pr-1 custom-scrollbar">
        {groupedSessions.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <FileText size={28} className="mx-auto text-neutral-600" />
            <div className="text-sm font-medium text-white/70">
              {searchQuery ? 'No sessions match your search query.' : 'No recorded sessions yet'}
            </div>
            <p className="text-xs text-neutral-500 max-w-md mx-auto">
              Start speaking in a meeting or press ⌘↵ in the floating HUD to automatically record transcripts, AI answers, and session notes.
            </p>
          </div>
        ) : (
          groupedSessions.map(([dateHeader, sessions]) => (
            <div key={dateHeader}>
              <div className="text-[11px] font-semibold text-neutral-500 tracking-wider uppercase mb-2">
                {dateHeader}
              </div>

              <div className="space-y-2">
                {sessions.map((sess) => (
                  <div
                    key={sess.id}
                    onClick={() => setSelectedSessionId(sess.id)}
                    className="bg-[#18181c] hover:bg-[#202026] border border-white/[0.06] hover:border-white/15 rounded-xl px-4 py-3 flex items-center justify-between transition cursor-pointer group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center text-sky-400 shrink-0">
                        <FileText size={17} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13.5px] font-semibold text-white group-hover:text-sky-300 transition truncate">
                            {sess.title}
                          </span>
                          {sess.status === 'active' && (
                            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold shrink-0">
                              ● Active
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-neutral-400 flex items-center gap-3 mt-0.5 truncate">
                          <span>{sess.transcripts?.length || 0} transcript turns</span>
                          <span>•</span>
                          <span>{sess.assistEvents?.length || 0} AI answers</span>
                          {sess.summary && (
                            <>
                              <span>•</span>
                              <span className="truncate text-neutral-300">{sess.summary}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs shrink-0 ml-4">
                      <span className="bg-white/10 text-white/75 font-mono text-[11px] px-2 py-0.5 rounded-md">
                        {formatDuration(sess.durationSeconds)}
                      </span>
                      <span className="text-neutral-500 font-mono text-[11px] w-12 text-right">
                        {formatTime(sess.startTime)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(sess.id, e)}
                        className="p-1.5 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition opacity-0 group-hover:opacity-100"
                        title="Delete Session"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
