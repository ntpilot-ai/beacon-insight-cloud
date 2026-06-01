"use client";

import { useEffect, useImperativeHandle, useRef, forwardRef, useState } from "react";
import { BEACON_BLUE, BEACON_BLUE_HOVER } from "../_lib/flags";

export interface HeroComposerHandle {
  /** Fill the textarea with a template and select the placeholder substring
   *  (the part inside the [brackets]) so the student types straight over it. */
  applyTemplate: (template: string) => void;
  focus: () => void;
}

/**
 * Empty-state hero composer. Bigger, centred, the primary affordance when
 * a chat hasn't started yet. Once a message lands, this hides and the
 * bottom Composer takes over.
 */
export const HeroComposer = forwardRef<
  HeroComposerHandle,
  {
    onSend:      (text: string) => void;
    placeholder?: string;
  }
>(function HeroComposer({ onSend, placeholder = "Type a question or topic…" }, ref) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow
  useEffect(() => {
    const t = taRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 200) + "px";
  }, [value]);

  useEffect(() => { taRef.current?.focus(); }, []);

  useImperativeHandle(ref, () => ({
    applyTemplate: (template: string) => {
      setValue(template);
      // After React commits the value, select the [placeholder] portion.
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.focus();
        const match = template.match(/\[[^\]]+\]/);
        if (match && match.index !== undefined) {
          ta.setSelectionRange(match.index, match.index + match[0].length);
        } else {
          ta.setSelectionRange(template.length, template.length);
        }
      });
    },
    focus: () => taRef.current?.focus(),
  }), []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        className="flex gap-2 items-end bg-white border-2 border-slate-200 rounded-2xl pl-4 pr-2 py-2.5 focus-within:border-[#013B93] focus-within:ring-4 focus-within:ring-[#013B93]/10 transition-all shadow-sm"
      >
        <textarea
          ref={taRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          className="flex-1 bg-transparent text-base text-slate-800 placeholder-slate-400 focus:outline-none resize-none py-2 max-h-52 leading-relaxed"
          style={{ minHeight: "28px" }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim()}
          className="w-10 h-10 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white transition-all shrink-0"
          style={{ backgroundColor: BEACON_BLUE }}
          onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = BEACON_BLUE_HOVER; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = BEACON_BLUE; }}
          aria-label="Send"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <p className="text-[11px] text-slate-400 mt-2 text-center">
        Press Enter to send · or pick a starting point below
      </p>
    </div>
  );
});
