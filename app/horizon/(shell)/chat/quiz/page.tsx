"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import type { Message } from "../../../../chat/_lib/types";
import { useChatStream } from "../../../../chat/_lib/useChatStream";
import { Conversation } from "../../../../chat/_components/Conversation";
import { Composer } from "../../../../chat/_components/Composer";

import { notesStore } from "../../../_lib/notes_store";
import { QuizBanner } from "../../../_components/QuizBanner";

const BEACON_BLUE = "#013B93";
const CONNECTION_ERROR_REPLY = "Sorry, I had trouble connecting. Please try again in a moment.";

export default function QuizPage() {
  const router = useRouter();

  const [studentId,   setStudentId]   = useState("");
  const [displayName, setDisplayName] = useState("");
  const [schoolId,    setSchoolId]    = useState("beacon-academy");
  const [initial,     setInitial]     = useState("S");

  const [topic,       setTopic]       = useState<string | null>(null);
  const [topicDraft,  setTopicDraft]  = useState("");

  const [sessionId,   setSessionId]   = useState<string | null>(null);
  const [messages,    setMessages]    = useState<Message[]>([]);
  const [input,       setInput]       = useState("");
  const [sending,     setSending]     = useState(false);

  const stream = useChatStream();

  // Recent subjects from Notes — used as one-tap topic chips
  const recentSubjects = useMemo(() => {
    if (typeof window === "undefined") return [] as string[];
    return notesStore.subjects().slice(0, 4).map(s => s.subject);
  }, []);

  useEffect(() => {
    const sid  = sessionStorage.getItem("beaconChat_studentId");
    const name = sessionStorage.getItem("beaconChat_displayName");
    const sch  = sessionStorage.getItem("beaconChat_schoolId");
    if (!sid) return; // shell layout will redirect

    setStudentId(sid);
    setDisplayName(name || sid);
    setInitial(name?.[0]?.toUpperCase() || "S");
    if (sch) setSchoolId(sch);
  }, []);

  function startQuiz(t: string) {
    const trimmed = t.trim();
    if (!trimmed) return;
    setTopic(trimmed);
    // Kick off the quiz with an opening message from the student — the AI's
    // quiz-mode system prompt will pick it up from here.
    send(`Quiz me on: ${trimmed}. Start with the first question.`, trimmed);
  }

  function stopQuiz() {
    if (!confirm("Stop this quiz and return to the chat homepage?")) return;
    router.push("/horizon/chat");
  }

  async function send(text: string, topicOverride?: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const userMsg: Message = {
      id:        "u-" + Date.now(),
      role:      "user",
      content:   trimmed,
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
        message:   trimmed,
        sessionId,
        studentId,
        schoolId,
        model:     "claude",
        mode:      "quiz",
        history,
      },
      {
        onMeta: (meta) => {
          if (meta.sessionId && !sessionId) setSessionId(meta.sessionId);
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
        onError: () => {
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

  // ── Pre-quiz topic picker ────────────────────────────────────────────────
  if (!topic) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-10 overflow-y-auto">
        <div className="w-full max-w-xl text-center">
          <Link href="/horizon/chat" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-[#013B93] mb-6">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M12 19L5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to chat
          </Link>

          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 text-2xl shadow-sm" style={{ backgroundColor: BEACON_BLUE, color: "white" }}>
            ✓
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800 mb-2">Quiz me</h1>
          <p className="text-sm text-slate-500 mb-7 max-w-md mx-auto">
            Pick a topic or subject. Horizon will ask a handful of questions one at a time, mark each answer, and give you a quick summary at the end.
          </p>

          <form
            onSubmit={(e) => { e.preventDefault(); startQuiz(topicDraft); }}
            className="flex gap-2 mb-4"
          >
            <input
              autoFocus
              type="text"
              value={topicDraft}
              onChange={e => setTopicDraft(e.target.value)}
              placeholder="e.g. The water cycle, GCSE algebra basics, Romeo and Juliet…"
              className="flex-1 bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-[#013B93] focus:ring-4 focus:ring-[#013B93]/10 shadow-sm"
            />
            <button
              type="submit"
              disabled={!topicDraft.trim()}
              className="px-5 py-3 rounded-2xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
              style={{ backgroundColor: BEACON_BLUE }}
            >
              Start quiz
            </button>
          </form>

          {recentSubjects.length > 0 && (
            <div className="mt-2">
              <div className="text-[11px] text-slate-400 mb-2">Or pick a recent subject</div>
              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                {recentSubjects.map(s => (
                  <button
                    key={s}
                    onClick={() => { setTopicDraft(s); startQuiz(s); }}
                    className="text-xs font-medium px-3 py-1.5 rounded-full bg-slate-100 hover:bg-[#E6EDF8] hover:text-[#013B93] text-slate-700 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Active quiz: banner + conversation + composer ────────────────────────
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <QuizBanner topic={topic} onStop={stopQuiz} />

      <Conversation
        messages={messages}
        initial={initial}
        displayName={displayName}
        loading={false}
        loadingSession={false}
        onSend={(text) => send(text)}
        emptyState={
          <div className="text-sm text-slate-400 py-10 text-center">
            Starting your quiz on <span className="font-semibold text-slate-600">{topic}</span>…
          </div>
        }
      />

      <Composer
        value={input}
        onChange={setInput}
        onSend={() => send(input)}
        onAttach={() => { /* no-op in quiz */ }}
        disabled={sending}
        placeholder="Type your answer…"
      />
    </div>
  );
}
