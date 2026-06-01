"use client";

import { useEffect, useRef, useState } from "react";
import type { ModelOption } from "../_lib/types";
import { BEACON_BLUE } from "../_lib/flags";

export const MODELS: ModelOption[] = [
  { id: "claude",  label: "Claude",  vendor: "Anthropic", available: true  },
  { id: "chatgpt", label: "ChatGPT", vendor: "OpenAI",    available: false },
  { id: "gemini",  label: "Gemini",  vendor: "Google",    available: false },
  { id: "copilot", label: "Copilot", vendor: "Microsoft", available: false },
];

export function ModelPicker({
  value,
  onChange,
}: {
  value:    string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const current = MODELS.find(m => m.id === value) || MODELS[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: BEACON_BLUE }}
        />
        <span>{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden">
          <div className="px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">
            Choose a model
          </div>
          {MODELS.map(m => (
            <button
              key={m.id}
              disabled={!m.available}
              onClick={() => { if (m.available) { onChange(m.id); setOpen(false); } }}
              className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 ${
                m.available
                  ? "hover:bg-slate-50 cursor-pointer"
                  : "opacity-50 cursor-not-allowed"
              } ${m.id === value ? "bg-[#E6EDF8]" : ""}`}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">{m.label}</div>
                <div className="text-[11px] text-slate-400 truncate">{m.vendor}</div>
              </div>
              {!m.available && (
                <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">Soon</span>
              )}
              {m.id === value && m.available && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M20 6L9 17L4 12" stroke={BEACON_BLUE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
          <div className="px-3 py-2 text-[10px] text-slate-400 border-t border-slate-100 bg-slate-50">
            Beacon routes every reply through its safeguarding pipeline.
          </div>
        </div>
      )}
    </div>
  );
}
