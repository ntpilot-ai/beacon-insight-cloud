"use client";

import { useEffect, useRef } from "react";
import type { Session } from "../../chat/_lib/types";
import { groupSessionsByDate } from "../../chat/_lib/groupSessions";

export function ChatHistoryPopover({
  open,
  sessions,
  activeId,
  onSelect,
  onClose,
}: {
  open:     boolean;
  sessions: Session[];
  activeId: string | null;
  onSelect: (s: Session) => void;
  onClose:  () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);

  if (!open) return null;

  const groups = groupSessionsByDate(sessions);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 w-80 max-h-[70vh] bg-white border border-slate-200 rounded-2xl shadow-lg z-20 flex flex-col overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-800">Your chats</div>
        <div className="text-[11px] text-slate-500 mt-0.5">Pick one to keep going.</div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {sessions.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-8 px-4">
            No previous chats yet.
          </p>
        )}

        {groups.map(g => (
          <div key={g.label} className="mb-2">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
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
                        ? "bg-[#E6EDF8] text-[#013B93]"
                        : "text-slate-700 hover:bg-slate-50"
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
    </div>
  );
}
