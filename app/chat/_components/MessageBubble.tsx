"use client";

import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../_lib/types";
import { SHOW_CHECKED_BY_BEACON, BEACON_BLUE } from "../_lib/flags";

function StreamingCaret() {
  return (
    <span className="inline-block w-1.5 h-4 ml-0.5 align-text-bottom bg-slate-400 animate-pulse rounded-sm" />
  );
}

function CheckedByBeacon() {
  if (!SHOW_CHECKED_BY_BEACON) return null;
  return (
    <span className="flex items-center gap-1 text-[11px] text-slate-400">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Checked by Beacon
    </span>
  );
}

function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="prose-beacon text-sm leading-relaxed text-slate-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p:    ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul:   ({ children }) => <ul className="list-disc pl-5 mb-2 last:mb-0 space-y-1">{children}</ul>,
          ol:   ({ children }) => <ol className="list-decimal pl-5 mb-2 last:mb-0 space-y-1">{children}</ol>,
          li:   ({ children }) => <li>{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
          em:   ({ children }) => <em className="italic">{children}</em>,
          h1:   ({ children }) => <h1 className="text-base font-bold text-slate-900 mt-3 mb-2 first:mt-0">{children}</h1>,
          h2:   ({ children }) => <h2 className="text-base font-bold text-slate-900 mt-3 mb-2 first:mt-0">{children}</h2>,
          h3:   ({ children }) => <h3 className="text-sm font-bold text-slate-900 mt-3 mb-1.5 first:mt-0">{children}</h3>,
          a:    ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#013B93] underline underline-offset-2 hover:opacity-80">
              {children}
            </a>
          ),
          code: ({ inline, children, ...props }: any) =>
            inline ? (
              <code className="bg-slate-100 text-slate-800 rounded px-1 py-0.5 text-[0.85em] font-mono">{children}</code>
            ) : (
              <code className="block" {...props}>{children}</code>
            ),
          pre:  ({ children }) => (
            <pre className="bg-slate-900 text-slate-100 rounded-xl px-4 py-3 my-2 overflow-x-auto text-[0.8em] font-mono leading-relaxed">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-3 border-slate-300 pl-3 italic text-slate-600 my-2">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="text-xs border-collapse">{children}</table>
            </div>
          ),
          th:   ({ children }) => <th className="border border-slate-200 px-2 py-1 bg-slate-50 font-semibold text-left">{children}</th>,
          td:   ({ children }) => <td className="border border-slate-200 px-2 py-1">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function MessageBubble({
  msg,
  initial,
  onSaveToNotes,
}: {
  msg:            Message;
  initial:        string;
  onSaveToNotes?: () => void;
}) {
  if (msg.role === "system") {
    return (
      <div className="flex justify-center my-3">
        <span className="text-xs text-slate-400 bg-slate-100 px-3 py-1 rounded-full">{msg.content}</span>
      </div>
    );
  }

  const isUser = msg.role === "user";

  return (
    <div className={`flex gap-3 mb-5 ${isUser ? "flex-row-reverse" : ""}`}>
      {!isUser && (
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1"
          style={{ backgroundColor: BEACON_BLUE }}
        >
          <Image src="/insight_icon.png" alt="Beacon" width={18} height={18} className="object-contain invert brightness-0 opacity-90" />
        </div>
      )}
      {isUser && (
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0 mt-1 text-white text-xs font-bold">
          {initial}
        </div>
      )}

      <div className={`max-w-[78%] flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`px-4 py-3 rounded-2xl shadow-sm text-sm leading-relaxed ${
            isUser
              ? "text-white rounded-tr-sm"
              : "bg-white border border-slate-100 rounded-tl-sm"
          }`}
          style={isUser ? { backgroundColor: BEACON_BLUE } : undefined}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap">{msg.content}</div>
          ) : (
            <>
              <MarkdownBody text={msg.content || ""} />
              {msg.streaming && <StreamingCaret />}

              {!msg.streaming && msg.content && onSaveToNotes && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex justify-end">
                  <button
                    type="button"
                    onClick={onSaveToNotes}
                    className="flex items-center gap-1.5 text-[12px] font-semibold text-[#013B93] bg-[#E6EDF8] hover:bg-[#D5E0F2] px-3 py-1.5 rounded-full transition-colors"
                    title="Save this reply to your notes"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H16L21 8V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21Z M17 21V13H7V21 M7 3V8H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Save to notes
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {!isUser && !msg.streaming && msg.content && (
          <div className="flex items-center gap-3 mt-1 pl-1">
            <CheckedByBeacon />
          </div>
        )}

        <span className="text-[10px] text-slate-400 px-1">
          {msg.timestamp.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex gap-3 mb-5">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1"
        style={{ backgroundColor: BEACON_BLUE }}
      >
        <Image src="/insight_icon.png" alt="Beacon" width={18} height={18} className="object-contain invert brightness-0 opacity-90" />
      </div>
      <div className="bg-white border border-slate-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center h-5">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-slate-300 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
