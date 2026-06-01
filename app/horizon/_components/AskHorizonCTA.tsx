"use client";

import Link from "next/link";
import { useHorizonMode } from "../_lib/HorizonModeContext";

const BEACON_BLUE = "#013B93";

export function AskHorizonCTA() {
  const { mode } = useHorizonMode();
  const sub = mode === "guided"
    ? "Ask any question — Horizon will guide you through it step by step."
    : "Ask any question — homework, research, writing, revision.";

  return (
    <Link
      href="/horizon/chat"
      className="block group rounded-2xl text-white p-6 md:p-7 shadow-sm hover:shadow-md transition-all"
      style={{ backgroundColor: BEACON_BLUE }}
    >
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M21 12C21 16.5 16.97 20 12 20C10.5 20 9.07 19.7 7.83 19.16L3 20L4.16 16.07C3.42 14.85 3 13.46 3 12C3 7.5 7.03 4 12 4C16.97 4 21 7.5 21 12Z" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-lg md:text-xl font-bold mb-1">Ask Horizon</div>
          <p className="text-sm text-white/85 leading-snug">{sub}</p>
        </div>
        <div className="hidden md:flex items-center text-white/70 group-hover:text-white transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M5 12H19M19 12L13 6M19 12L13 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
