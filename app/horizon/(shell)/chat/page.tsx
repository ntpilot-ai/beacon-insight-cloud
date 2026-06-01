"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

import type { Message, Session } from "../../../chat/_lib/types";
import { useChatStream } from "../../../chat/_lib/useChatStream";
import { Conversation } from "../../../chat/_components/Conversation";
import { Composer } from "../../../chat/_components/Composer";

import { useHorizonMode } from "../../_lib/HorizonModeContext";
import { notesStore } from "../../_lib/notes_store";
import type { Note } from "../../_lib/types";

import { ChatHistoryPopover } from "../../_components/ChatHistoryPopover";
import { SaveToNotesSheet } from "../../_components/SaveToNotesSheet";
import { NoteContextCard } from "../../_components/NoteContextCard";
import { GuidedNotice } from "../../_components/GuidedNotice";
import { AmbientSignal } from "../../_components/AmbientSignal";

import { shouldShowAmbientSignal, emptyGateState, inferSubjectHint, type AmbientGateState } from "../../_lib/ambient_gate";
import { ambientProvider, type AmbientSignal as AmbientSignalT } from "../../_lib/ambient_signals";
import { stripDataUrlImages } from "../../_lib/notes_paste";

const BEACON_BLUE = "#013B93";
const CONNECTION_ERROR_REPLY = "Sorry, I had trouble connecting. Please try again in a moment.";

export default function HorizonChatPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { mode }     = useHorizonMode();

  const [studentId,      setStudentId]      = useState("");
  const [displayName,    setDisplayName]    = useState("");
  const [schoolId,       setSchoolId]       = useState("beacon-academy");
  const [initial,        setInitial]        = useState("S");

  const [sessions,       setSessions]       = useState<Session[]>([]);
  const [sessionId,      setSessionId]      = useState<string | null>(null);
  const [messages,       setMessages]       = useState<Message[]>([]);
  const [input,          setInput]          = useState("");
  const [sending,        setSending]        = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);

  const [historyOpen,    setHistoryOpen]    = useState(false);
  const [saveTarget,     setSaveTarget]     = useState<Message | null>(null);
  const [contextNote,    setContextNote]    = useState<Note | null>(null);

  const [ambientSignal,  setAmbientSignal]  = useState<AmbientSignalT | null>(null);
  const [ambientState,   setAmbientState]   = useState<AmbientGateState>(emptyGateState);

  const stream = useChatStream();

  // ── Bootstrap ────────────────────────────────────────────────────────────
  useEffect(() => {
    const sid  = sessionStorage.getItem("beaconChat_studentId");
    const name = sessionStorage.getItem("beaconChat_displayName");
    const sch  = sessionStorage.getItem("beaconChat_schoolId");
    if (!sid) return; // shell layout will redirect

    setStudentId(sid);
    setDisplayName(name || sid);
    setInitial(name?.[0]?.toUpperCase() || "S");
    if (sch) setSchoolId(sch);

    loadSessions(sid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Query-param effects: ?session=…, ?context_note=… ─────────────────────
  useEffect(() => {
    const reqSession = searchParams.get("session");
    if (reqSession && reqSession !== sessionId) {
      openSessionById(reqSession);
    }
    const reqNote = searchParams.get("context_note");
    if (reqNote) {
      const n = notesStore.get(reqNote);
      if (n) setContextNote(n);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ── Ambient signal evaluation ────────────────────────────────────────────
  // Runs after the assistant finishes streaming. Default silent: any failure
  // path returns no signal.
  useEffect(() => {
    if (sending) return;
    if (ambientSignal) return;
    if (messages.length === 0) return;

    const last = messages[messages.length - 1];
    if (last.role !== "assistant" || last.streaming) return;
    if (!last.content || last.content === CONNECTION_ERROR_REPLY) return;

    const result = shouldShowAmbientSignal({
      messages, contextNote, mode, state: ambientState,
    });
    if (!result.show || !result.context) return;

    const picked = ambientProvider.pick(result.context, ambientState.recentlyShownIds);
    if (!picked) return;

    setAmbientSignal(picked);
    setAmbientState(prev => ({
      shownCount:       prev.shownCount + 1,
      shownTopics:      new Set(prev.shownTopics).add(result.context!.subjectHint || "generic"),
      lastShownAtMs:    Date.now(),
      recentlyShownIds: [picked.id, ...prev.recentlyShownIds].slice(0, 4),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, messages]);

  async function loadSessions(sid: string) {
    const { data } = await supabase
      .from("chat_sessions")
      .select("id, title, updated_at, created_at")
      .eq("student_id", sid)
      .order("updated_at", { ascending: false })
      .limit(50);
    setSessions((data as Session[]) || []);
  }

  async function openSessionById(id: string) {
    setLoadingSession(true);
    setSessionId(id);

    const { data } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("session_id", id)
      .order("created_at", { ascending: true });

    const loaded: Message[] = (data || []).map((m: any) => ({
      id:        m.id,
      role:      m.role as Message["role"],
      content:   m.content,
      state:     m.blocked ? "block" : "normal",
      risk:      m.risk,
      matched:   m.matched,
      timestamp: new Date(m.created_at),
    }));

    setMessages(loaded);
    setLoadingSession(false);
  }

  function startNewChat() {
    setSessionId(null);
    setMessages([]);
    setInput("");
    setContextNote(null);
    setAmbientSignal(null);
    setAmbientState(emptyGateState());
    router.replace("/horizon/chat");
  }

  // Clear any visible ambient signal whenever the student sends — it belongs
  // to the exchange that produced it, not the next one.
  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setAmbientSignal(null);

    // If a note context is attached, prepend it (visible to the student).
    // Strip data-URL images from the note body before sending — they bloat
    // the prompt and the text-only API can't read them.
    const outbound = contextNote
      ? `[Context from my note "${contextNote.title}"]\n${stripDataUrlImages(contextNote.body)}\n\n${trimmed}`
      : trimmed;

    const userMsg: Message = {
      id:        "u-" + Date.now(),
      role:      "user",
      content:   trimmed,                         // display the student's typed text
      state:     "normal",
      timestamp: new Date(),
    };

    const assistantId = "a-" + Date.now();
    const assistantStub: Message = {
      id:        assistantId,
      role:      "assistant",
      content:   "",
      state:     "normal",
      streaming: true,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg, assistantStub]);
    setSending(true);
    setInput("");

    const history = messages
      .filter(m => m.state !== "block")
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));

    await stream.send(
      {
        message:   outbound,
        sessionId,
        studentId,
        schoolId,
        model:     "claude",
        history,
      },
      {
        onMeta: (meta) => {
          if (meta.sessionId && !sessionId) {
            setSessionId(meta.sessionId);
            loadSessions(studentId);
          } else {
            loadSessions(studentId);
          }
          if (meta.blocked) {
            setMessages(prev =>
              prev.map(m =>
                m.id === userMsg.id
                  ? { ...m, state: "block", matched: meta.matched, risk: meta.risk }
                  : m,
              ),
            );
          }
        },
        onToken: (chunk) => {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId ? { ...m, content: m.content + chunk } : m,
            ),
          );
        },
        onComplete: () => {
          setMessages(prev =>
            prev.map(m => (m.id === assistantId ? { ...m, streaming: false } : m)),
          );
          setSending(false);
        },
        onError: (err) => {
          console.error("Chat stream error:", err);
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? { ...m, streaming: false, content: CONNECTION_ERROR_REPLY }
                : m,
            ),
          );
          setSending(false);
        },
      },
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Chat-surface header: New chat + History */}
      <div className="bg-white border-b border-slate-100 px-3 md:px-5 py-2 flex items-center justify-between gap-2 shrink-0">
        <button
          onClick={startNewChat}
          className="flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg hover:opacity-95"
          style={{ backgroundColor: BEACON_BLUE }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          New chat
        </button>

        <div className="relative">
          <button
            onClick={() => setHistoryOpen(o => !o)}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
            aria-haspopup="menu"
            aria-expanded={historyOpen}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 7V12L15 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            History
            <span className="text-[10px] text-slate-500">({sessions.length})</span>
          </button>
          <ChatHistoryPopover
            open={historyOpen}
            sessions={sessions}
            activeId={sessionId}
            onSelect={(s) => router.push(`/horizon/chat?session=${s.id}`)}
            onClose={() => setHistoryOpen(false)}
          />
        </div>
      </div>

      <Conversation
        messages={messages}
        initial={initial}
        displayName={displayName}
        loading={false}
        loadingSession={loadingSession}
        onSend={(text) => send(text)}
        onSaveToNotes={(msg) => setSaveTarget(msg)}
        headerSlot={contextNote ? (
          <NoteContextCard note={contextNote} onDetach={() => setContextNote(null)} />
        ) : null}
        afterMessagesSlot={ambientSignal ? (
          <AmbientSignal signal={ambientSignal} onDismiss={() => setAmbientSignal(null)} />
        ) : null}
      />

      {/* While the chat is empty, the centred HeroComposer inside EmptyState
          is the primary input — hide the bottom composer to avoid two
          input fields competing. */}
      {messages.length > 0 && (
        <>
          <GuidedNotice />
          <Composer
            value={input}
            onChange={setInput}
            onSend={() => send(input)}
            onAttach={() => {
              const id = "s-" + Date.now();
              setMessages(prev => [...prev, {
                id, role: "system", state: "normal",
                content: "Image attachments are coming soon — Beacon's Sentinel layer will scan them before send.",
                timestamp: new Date(),
              }]);
            }}
            disabled={sending}
            placeholder={mode === "guided" ? "Ask a question — Horizon will guide you through it…" : "Ask anything…"}
          />
        </>
      )}

      <SaveToNotesSheet
        open={!!saveTarget}
        sourceContent={saveTarget?.content || ""}
        sourceSessionId={sessionId || undefined}
        sourceMessageId={saveTarget?.id}
        subjectHint={inferSubjectHint(messages, contextNote) || undefined}
        userQuestion={(() => {
          if (!saveTarget) return undefined;
          const idx = messages.findIndex(m => m.id === saveTarget.id);
          for (let i = idx - 1; i >= 0; i--) {
            if (messages[i].role === "user") return messages[i].content;
          }
          return undefined;
        })()}
        sessionTitle={sessions.find(s => s.id === sessionId)?.title}
        onClose={() => setSaveTarget(null)}
        onSaved={(noteId) => {
          setSaveTarget(null);
          router.push(`/horizon/notes/${noteId}`);
        }}
      />
    </div>
  );
}
