"use client";

import { ModeIndicator } from "./ModeIndicator";
import { IdentityMenu } from "./IdentityMenu";

export function TopBar({
  surfaceTitle,
  displayName,
  schoolName,
  onToggleNav,
  onSignOut,
}: {
  surfaceTitle: string;
  displayName:  string;
  schoolName:   string;
  onToggleNav:  () => void;
  onSignOut:    () => void;
}) {
  return (
    <header className="bg-white border-b border-slate-200 px-3 md:px-5 py-2.5 flex items-center justify-between gap-3 shrink-0 shadow-sm">
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={onToggleNav}
          className="md:hidden w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-600 shrink-0"
          aria-label="Open menu"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M3 6H21M3 12H21M3 18H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <h1 className="text-base md:text-lg font-bold text-slate-800 truncate">{surfaceTitle}</h1>
      </div>

      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <ModeIndicator />

        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-full font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Protected
        </div>

        <IdentityMenu displayName={displayName} schoolName={schoolName} onSignOut={onSignOut} />
      </div>
    </header>
  );
}
