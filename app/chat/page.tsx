"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";

interface Message {
  id:        string;
  role:      "user" | "assistant" | "system";
  content:   string;
  risk?:     string;
  blocked?:  boolean;
  matched?:  string[];
  timestamp: Date;
}

interface Session {
  id:         string;
  title:      string;
  updated_at: string;
  created_at: string;
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex gap-3 mb-4">
      <div className="w-8 h-8 rounded-full bg-[#06B6D4] flex items-center justify-center shrink-0 mt-1">
        <Image src="/insight_icon.png" alt="Beacon" width={18} height={18} className="object-contain" />
      </div>
      <div className="bg-white border border-slate-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center h-5">
          {[0,1,2].map(i => (
            <div key={i} className="w-2 h-2 rounded-full bg-slate-300 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Chat message ──────────────────────────────────────────────────────────────
function ChatMessage({ msg, initial }: { msg: Message; initial: string }) {
  const isUser    = msg.role === "user";
  const isBlocked = msg.blocked;

  if (msg.role === "system") {
    return (
      <div className="flex justify-center my-3">
        <span className="text-xs text-slate-400 bg-slate-100 px-3 py-1 rounded-full">{msg.content}</span>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 mb-4 ${isUser ? "flex-row-reverse" : ""}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-[#06B6D4] flex items-center justify-center shrink-0 mt-1">
          <Image src="/insight_icon.png" alt="Beacon" width={18} height={18} className="object-contain" />
        </div>
      )}
      {isUser && (
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0 mt-1 text-white text-xs font-bold">
          {initial}
        </div>
      )}

      <div className={`max-w-[70%] flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
        {isBlocked && (
          <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1.5 rounded-xl mb-1">
            🛡 Blocked by Beacon safeguarding
            {msg.matched?.length ? ` · matched: ${msg.matched.join(", ")}` : ""}
          </div>
        )}
        <div className={`px-4 py-3 rounded-2xl shadow-sm text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? isBlocked
              ? "bg-red-50 border border-red-200 text-red-700 rounded-tr-sm"
              : "bg-[#06B6D4] text-white rounded-tr-sm"
            : "bg-white border border-slate-100 text-slate-700 rounded-tl-sm"
        }`}>
          {msg.content}
        </div>
        <span className="text-[10px] text-slate-400 px-1">
          {msg.timestamp.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}

// ── Session sidebar ───────────────────────────────────────────────────────────
function SessionSidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  studentId,
}: {
  sessions:  Session[];
  activeId:  string | null;
  onSelect:  (s: Session) => void;
  onNew:     () => void;
  studentId: string;
}) {
  return (
    <div className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col h-full">

      {/* Header */}
      <div className="px-4 py-4 border-b border-slate-100">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 bg-[#06B6D4] hover:bg-[#0891b2] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all"
        >
          <span className="text-lg leading-none">+</span> New Chat
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-auto py-2">
        {sessions.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-6 px-4">No previous chats yet</p>
        )}
        {sessions.map(s => (
          <button
            key={s.id}
            onClick={() => onSelect(s)}
            className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-50 ${
              activeId === s.id ? "bg-cyan-50 border-l-2 border-l-[#06B6D4]" : ""
            }`}
          >
            <div className="text-sm font-medium text-slate-700 truncate">{s.title || "Untitled chat"}</div>
            <div className="text-xs text-slate-400 mt-0.5">
              {new Date(s.updated_at).toLocaleDateString("en-GB", {
                day: "numeric", month: "short",
                hour: "2-digit", minute: "2-digit"
              })}
            </div>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-slate-100">
        <p className="text-[10px] text-slate-300 text-center">All chats monitored by Beacon</p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ChatPage() {
  const router    = useRouter();
  const [messages, setMessages]     = useState<Message[]>([]);
  const [sessions, setSessions]     = useState<Session[]>([]);
  const [input, setInput]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [studentId, setStudentId]   = useState("");
  const [displayName, setDisplayName] = useState("");
  const [schoolId, setSchoolId]     = useState("beacon-academy");
  const [initial, setInitial]       = useState("S");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const sid  = sessionStorage.getItem("beaconChat_studentId");
    const name = sessionStorage.getItem("beaconChat_displayName");
    const sch  = sessionStorage.getItem("beaconChat_schoolId");
    if (!sid) { router.replace("/chat/login"); return; }
    setStudentId(sid);
    setDisplayName(name || sid);
    setInitial(name?.[0]?.toUpperCase() || "S");
    if (sch) setSchoolId(sch);
    loadSessions(sid);
    startNewChat(name || sid);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function loadSessions(sid: string) {
    const { data } = await supabase
      .from("chat_sessions")
      .select("id, title, updated_at, created_at")
      .eq("student_id", sid)
      .order("updated_at", { ascending: false })
      .limit(30);
    setSessions((data as Session[]) || []);
  }

  function startNewChat(name?: string) {
    setSessionId(null);
    setMessages([{
      id:        "welcome-" + Date.now(),
      role:      "assistant",
      content:   `Hi ${name || displayName}! 👋 I'm BeaconChat, your school's safe AI assistant.\n\nI can help you with homework, research, understanding topics and much more. What would you like to learn about today?`,
      timestamp: new Date(),
    }]);
    inputRef.current?.focus();
  }

  async function loadSession(session: Session) {
    setLoadingSession(true);
    setSessionId(session.id);

    const { data } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("session_id", session.id)
      .order("created_at", { ascending: true });

    const loaded: Message[] = (data || []).map((m: any) => ({
      id:        m.id,
      role:      m.role as "user" | "assistant",
      content:   m.content,
      risk:      m.risk,
      blocked:   m.blocked,
      matched:   m.matched,
      timestamp: new Date(m.created_at),
    }));

    setMessages(loaded);
    setLoadingSession(false);
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const userMsg: Message = {
      id:        Date.now().toString(),
      role:      "user",
      content:   text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const history = messages
        .filter(m => m.role !== "system" && !m.blocked)
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId, studentId, schoolId, history }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `API error ${res.status}`);
      }

      const data = await res.json();

      if (data.blocked) {
        setMessages(prev => prev.map(m =>
          m.id === userMsg.id ? { ...m, blocked: true, risk: data.risk, matched: data.matched } : m
        ));
      }

      // Store returned session ID
      if (data.sessionId && !sessionId) {
        setSessionId(data.sessionId);
        loadSessions(studentId);
      } else if (sessionId) {
        // Refresh session list to update timestamps
        loadSessions(studentId);
      }

      setMessages(prev => [...prev, {
        id:        Date.now().toString() + "-reply",
        role:      "assistant",
        content:   data.reply || "Sorry, something went wrong.",
        timestamp: new Date(),
      }]);

    } catch (err: any) {
      console.error("Chat error:", err);
      setMessages(prev => [...prev, {
        id:        Date.now().toString() + "-err",
        role:      "assistant",
        content:   "Sorry, I had trouble connecting. Please try again.",
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="flex h-screen bg-[#F0F2F8]">

      {/* Session sidebar */}
      <SessionSidebar
        sessions={sessions}
        activeId={sessionId}
        onSelect={loadSession}
        onNew={() => startNewChat()}
        studentId={studentId}
      />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#06B6D4] flex items-center justify-center">
              <Image src="/insight_icon.png" alt="BeaconChat" width={22} height={22} className="object-contain" />
            </div>
            <div>
              <div className="font-bold text-[#06B6D4] text-base">BeaconChat</div>
              <div className="text-xs text-slate-400">Safe AI · Powered by Beacon Insight</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Protected
            </div>
            <div className="text-sm text-slate-500 font-medium">{displayName}</div>
            <button
              onClick={() => { sessionStorage.clear(); router.replace("/chat/login"); }}
              className="text-xs text-slate-400 hover:text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-auto px-4 py-6 max-w-3xl mx-auto w-full">
          {loadingSession ? (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              Loading conversation...
            </div>
          ) : (
            <>
              {messages.map(msg => (
                <ChatMessage key={msg.id} msg={msg} initial={initial} />
              ))}
              {loading && <TypingIndicator />}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="bg-white border-t border-slate-200 px-4 py-4 shrink-0">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-3 items-end bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 focus-within:border-[#06B6D4] focus-within:ring-2 focus-within:ring-[#06B6D4]/10 transition-all">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask me anything..."
                rows={1}
                className="flex-1 bg-transparent text-sm text-slate-700 placeholder-slate-400 focus:outline-none resize-none max-h-32"
                style={{ minHeight: "24px" }}
                onInput={e => {
                  const t = e.target as HTMLTextAreaElement;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 128) + "px";
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                className="w-9 h-9 rounded-xl bg-[#06B6D4] hover:bg-[#0891b2] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white transition-all shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
            <p className="text-center text-[10px] text-slate-300 mt-2">
              All conversations are monitored by Beacon Insight for safeguarding purposes
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
