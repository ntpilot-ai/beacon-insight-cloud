"use client";

import Image from "next/image";
import type { Session } from "../_lib/types";
import { groupSessionsByDate } from "../_lib/groupSessions";
import { BEACON_BLUE, BEACON_BLUE_HOVER } from "../_lib/flags";

interface Props {
  sessions:    Session[];
  activeId:    string | null;
  displayName: string;
  schoolName:  string;
  yearGroup?:  string;
  open:        boolean;
  onSelect:    (s: Session) => void;
  onNew:       () => void;
  onClose:     () => void;
  onSignOut:   () => void;
}

export function ChatSidebar({
  sessions, activeId, displayName, schoolName, yearGroup,
  open, onSelect, onNew, onClose, onSignOut,
}: Props) {
  const groups = groupSessionsByDate(sessions);
  const initial = (displayName?.[0] || "S").toUpperCase();

  const sidebarBody = (
    <div className="h-full flex flex-col text-white" style={{ backgroundColor: BEACON_BLUE }}>
      {/* Brand row */}
      <div className="px-4 py-4 flex items-center justify-between gap-2 border-b border-white/10">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
            <Image src="/insight_icon.png" alt="Beacon" width={18} height={18} className="object-contain invert brightness-0" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm truncate">BeaconChat</div>
            <div className="text-[10px] text-white/60 truncate">Safe AI for schools</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="md:hidden w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/70 shrink-0"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* New chat */}
      <div className="px-3 py-3">
        <button
          onClick={() => { onNew(); onClose(); }}
          className="w-full flex items-center gap-2 bg-white text-sm font-semibold px-3.5 py-2.5 rounded-xl transition-all hover:opacity-95"
          style={{ color: BEACON_BLUE_HOVER }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          New chat
        </button>
      </div>

      {/* History */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {sessions.length === 0 && (
          <p className="text-xs text-white/50 text-center py-8 px-4">
            No chats yet. Start one and it'll appear here.
          </p>
        )}

        {groups.map(g => (
          <div key={g.label} className="mb-3">
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
              {g.label}
            </div>
            <div className="space-y-0.5">
              {g.sessions.map(s => {
                const active = activeId === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => { onSelect(s); onClose(); }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors ${
                      active
                        ? "bg-white/20 text-white"
                        : "text-white/80 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <div className="truncate font-medium">{s.title || "Untitled chat"}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Identity card */}
      <div className="px-3 py-3 border-t border-white/10">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl bg-white/10">
          <div className="w-9 h-9 rounded-full bg-white text-sm font-bold flex items-center justify-center shrink-0" style={{ color: BEACON_BLUE_HOVER }}>
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white truncate">{displayName || "Student"}</div>
            <div className="text-[10px] text-white/60 truncate">
              {yearGroup ? `${yearGroup} · ` : ""}{schoolName}
            </div>
          </div>
          <button
            onClick={onSignOut}
            title="Sign out"
            className="w-8 h-8 rounded-lg hover:bg-white/15 flex items-center justify-center text-white/70 hover:text-white shrink-0"
            aria-label="Sign out"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M9 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9M16 17L21 12M21 12L16 7M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`md:hidden fixed inset-0 bg-slate-900/50 z-30 transition-opacity ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden
      />

      {/* Mobile drawer */}
      <aside
        className={`md:hidden fixed top-0 left-0 bottom-0 w-72 z-40 transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarBody}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-72 shrink-0 h-full">
        {sidebarBody}
      </aside>
    </>
  );
}
