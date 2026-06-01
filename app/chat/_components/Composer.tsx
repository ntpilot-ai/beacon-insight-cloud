"use client";

import { useRef, useEffect } from "react";
import { BEACON_BLUE, BEACON_BLUE_HOVER } from "../_lib/flags";

export function Composer({
  value,
  onChange,
  onSend,
  onAttach,
  disabled,
  placeholder = "Ask anything…",
}: {
  value:        string;
  onChange:     (v: string) => void;
  onSend:       () => void;
  onAttach:     () => void;
  disabled:     boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 160) + "px";
  }, [value]);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) onSend();
    }
  }

  return (
    <div className="bg-white border-t border-slate-200 px-3 md:px-4 py-3 md:py-4 shrink-0">
      <div className="max-w-3xl mx-auto">
        <div className="flex gap-2 items-end bg-slate-50 border border-slate-200 rounded-2xl pl-2 pr-2 py-2 focus-within:border-[#013B93] focus-within:ring-2 focus-within:ring-[#013B93]/15 transition-all">

          <button
            type="button"
            onClick={onAttach}
            className="w-9 h-9 rounded-xl hover:bg-slate-200 text-slate-500 hover:text-slate-700 flex items-center justify-center shrink-0 transition-colors"
            aria-label="Attach image"
            title="Attach image"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M21.44 11.05L12.25 20.24C11.1242 21.3658 9.59723 21.9983 8.005 21.9983C6.41277 21.9983 4.88584 21.3658 3.76 20.24C2.63416 19.1142 2.00166 17.5872 2.00166 15.995C2.00166 14.4028 2.63416 12.8758 3.76 11.75L12.95 2.56C13.7006 1.80944 14.7186 1.38773 15.78 1.38773C16.8414 1.38773 17.8594 1.80944 18.61 2.56C19.3606 3.31056 19.7823 4.32859 19.7823 5.39C19.7823 6.45141 19.3606 7.46944 18.61 8.22L9.41 17.41C9.03472 17.7853 8.52573 17.9961 7.995 17.9961C7.46427 17.9961 6.95528 17.7853 6.58 17.41C6.20472 17.0347 5.99389 16.5257 5.99389 15.995C5.99389 15.4643 6.20472 14.9553 6.58 14.58L15.07 6.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <textarea
            ref={ref}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={1}
            className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none resize-none py-1.5 max-h-40"
            style={{ minHeight: "24px" }}
          />

          <button
            type="button"
            onClick={onSend}
            disabled={disabled || !value.trim()}
            className="w-9 h-9 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white transition-all shrink-0"
            style={{ backgroundColor: BEACON_BLUE }}
            onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = BEACON_BLUE_HOVER; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = BEACON_BLUE; }}
            aria-label="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-2.5 px-2">
          All conversations are monitored by Beacon Insight for safeguarding purposes.
        </p>
      </div>
    </div>
  );
}
