"use client";

import { useEffect, useRef, useState } from "react";
import { useHorizonMode } from "../_lib/HorizonModeContext";
import { HORIZON_MODE_COPY } from "../_lib/types";

const BEACON_BLUE = "#013B93";
const AEGIS_GREEN = "#10B981";

export function ModeIndicator() {
  const { mode, setMode } = useHorizonMode();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const current = HORIZON_MODE_COPY[mode];
  const isGuided = mode === "guided";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-colors"
        style={{
          backgroundColor: isGuided ? "#E6EDF8" : "#ECFDF5",
          borderColor:     isGuided ? "#C6D4ED" : "#A7F3D0",
          color:           isGuided ? BEACON_BLUE : "#065F46",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current.explainer}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
          <circle cx="6" cy="6" r="3" fill={isGuided ? BEACON_BLUE : AEGIS_GREEN} />
        </svg>
        <span>{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden">
          <div className="px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">
            How much help do you want?
          </div>
          {(Object.keys(HORIZON_MODE_COPY) as Array<keyof typeof HORIZON_MODE_COPY>).map(key => {
            const copy   = HORIZON_MODE_COPY[key];
            const active = key === mode;
            const accent = key === "guided" ? BEACON_BLUE : AEGIS_GREEN;
            return (
              <button
                key={key}
                onClick={() => { setMode(key); setOpen(false); }}
                className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 ${active ? "bg-slate-50" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
                  <span className="text-sm font-semibold text-slate-800">{copy.label}</span>
                  {active && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="ml-auto" aria-hidden>
                      <path d="M20 6L9 17L4 12" stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-snug pl-4">{copy.explainer}</p>
              </button>
            );
          })}
          <div className="px-3 py-2 text-[10px] text-slate-400 border-t border-slate-100 bg-slate-50">
            Your teacher may set this automatically for some lessons in future.
          </div>
        </div>
      )}
    </div>
  );
}
