"use client";

import { useHorizonMode } from "../_lib/HorizonModeContext";

const BEACON_BLUE = "#013B93";

export function GuidedNotice() {
  const { mode } = useHorizonMode();
  if (mode !== "guided") return null;

  return (
    <div className="max-w-3xl mx-auto px-4 mb-2">
      <div
        className="flex items-center gap-2 text-[11px] text-[#013B93] bg-[#E6EDF8] border border-[#C6D4ED] rounded-full px-3 py-1.5 w-fit"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke={BEACON_BLUE} strokeWidth="1.8" />
          <path d="M12 8V13M12 16L12.01 16" stroke={BEACON_BLUE} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span><strong className="font-semibold">Guided mode</strong> — Horizon will guide you through this rather than give direct answers.</span>
      </div>
    </div>
  );
}
