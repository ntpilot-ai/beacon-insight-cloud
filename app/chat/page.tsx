"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

interface Message {
  id:        string;
  role:      "user" | "assistant" | "system";
  content:   string;
  risk?:     string;
  blocked?:  boolean;
  matched?:  string[];
  timestamp: Date;
}

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

function ChatMessage({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
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
      {/* Avatar */}
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-[#06B6D4] flex items-center justify-center shrink-0 mt-1">
          <Image src="/insight_icon.png" alt="Beacon" width={18} height={18} className="object-contain" />
        </div>
      )}
      {isUser && (
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0 mt-1 text-white text-xs font-bold">
          {/* First letter of student name */}
          {typeof window !== "undefined" ? (sessionStorage.getItem("beaconChat_displayName")?.[0]?.toUpperCase() || "S") : "S"}
        </div>
      )}

      <div className={`max-w-[70%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        {/* Blocked warning */}
        {isBlocked && (
          <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1.5 rounded-xl mb-1">
            🛡 Blocked by Beacon safeguarding
            {msg.matched?.length ? ` · matched: ${msg.matched.join(", ")}` : ""}
          </div>
        )}

        {/* Bubble */}
        <div className={`px-4 py-3 rounded-2xl shadow-sm text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? isBlocked
              ? "bg-red-50 border border-red-200 text-red-700 rounded-tr-sm"
              : "bg-[#06B6D4] text-white rounded-tr-sm"
            : "bg-white border border-slate-100 text-slate-700 rounded-tl-sm"
        }`}>
          {msg.content}
        </div>

        {/* Timestamp */}
        <span className="text-[10px] text-slate-400 px-1">
          {msg.timestamp.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const router    = useRouter();
  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [studentId, setStudentId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [schoolId, setSchoolId]   = useState("beacon-academy");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Check auth
    const sid  = sessionStorage.getItem("beaconChat_studentId");
    const name = sessionStorage.getItem("beaconChat_displayName");
    const sch  = sessionStorage.getItem("beaconChat_schoolId");
    if (!sid) { router.replace("/chat/login"); return; }
    setStudentId(sid);
    setDisplayName(name || sid);
    if (sch) setSchoolId(sch);

    // Welcome message
    setMessages([{
      id:        "welcome",
      role:      "assistant",
      content:   `Hi ${name || sid}! 👋 I'm BeaconChat, your school's safe AI assistant. I can help you with homework, research, understanding topics, and much more.\n\nWhat would you like to learn about today?`,
      timestamp: new Date(),
    }]);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    // Add user message immediately
    const userMsg: Message = {
      id:        Date.now().toString(),
      role:      "user",
      content:   text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      // Build history for context (last 10 exchanges)
      const history = messages
        .filter(m => m.role !== "system" && !m.blocked)
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:   text,
          sessionId,
          studentId,
          schoolId,
          history,
        }),
      });

      const data = await res.json();

      // Update user message with risk info if blocked
      if (data.blocked) {
        setMessages(prev => prev.map(m =>
          m.id === userMsg.id
            ? { ...m, blocked: true, risk: data.risk, matched: data.matched }
            : m
        ));
      }

      // Add assistant response
      const assistantMsg: Message = {
        id:        Date.now().toString() + "-reply",
        role:      "assistant",
        content:   data.reply || "Sorry, something went wrong.",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);

      // Store session ID for subsequent messages
      if (data.sessionId && !sessionId) setSessionId(data.sessionId);

    } catch {
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

  function handleSignOut() {
    sessionStorage.clear();
    router.replace("/chat/login");
  }

  return (
    <div className="flex flex-col h-screen bg-[#F0F2F8]">

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
            onClick={handleSignOut}
            className="text-xs text-slate-400 hover:text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-auto px-4 py-6 max-w-3xl mx-auto w-full">
        {messages.map(msg => <ChatMessage key={msg.id} msg={msg} />)}
        {loading && <TypingIndicator />}
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
  );
}
