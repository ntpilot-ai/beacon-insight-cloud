"use client";

import Image from "next/image";
import { ModelPicker } from "./ModelPicker";
import { BEACON_BLUE } from "../_lib/flags";

export function ChatHeader({
  displayName,
  model,
  onModelChange,
  onToggleSidebar,
  onSignOut,
}: {
  displayName:     string;
  model:           string;
  onModelChange:   (id: string) => void;
  onToggleSidebar: () => void;
  onSignOut:       () => void;
}) {
  return (
    <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center justify-between shrink-0 shadow-sm gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onToggleSidebar}
          className="md:hidden w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-600 shrink-0"
          aria-label="Open chats"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M3 6H21M3 12H21M3 18H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: BEACON_BLUE }}
        >
          <Image src="/insight_icon.png" alt="BeaconChat" width={22} height={22} className="object-contain invert brightness-0 opacity-90" />
        </div>
        <div className="min-w-0">
          <div className="font-bold text-base truncate" style={{ color: BEACON_BLUE }}>BeaconChat</div>
          <div className="text-[11px] text-slate-400 truncate">Safe AI · Powered by Beacon Insight</div>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <ModelPicker value={model} onChange={onModelChange} />

        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-full font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Protected
        </div>

        <button
          onClick={onSignOut}
          className="hidden md:inline-block text-xs text-slate-500 hover:text-slate-800 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg transition-colors"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
