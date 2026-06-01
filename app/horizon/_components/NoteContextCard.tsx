"use client";

import Link from "next/link";
import type { Note } from "../_lib/types";

const BEACON_BLUE = "#013B93";

export function NoteContextCard({
  note,
  onDetach,
}: {
  note:     Note;
  onDetach: () => void;
}) {
  return (
    <div
      className="rounded-2xl border border-[#C6D4ED] bg-[#E6EDF8] px-4 py-3 flex items-start gap-3 mb-4"
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: BEACON_BLUE, color: "white" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M6 4H16L20 8V20C20 20.5 19.5 21 19 21H6C5.5 21 5 20.5 5 20V5C5 4.5 5.5 4 6 4Z M15 4V8H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#013B93]">
          Using note as context
        </div>
        <div className="text-sm font-semibold text-slate-800 truncate mt-0.5">
          {note.title}
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5">
          {note.subject} · <Link href={`/horizon/notes/${note.id}`} className="hover:underline">open note</Link>
        </div>
      </div>
      <button
        onClick={onDetach}
        className="w-7 h-7 rounded-lg hover:bg-white/60 flex items-center justify-center text-slate-500 shrink-0"
        aria-label="Detach note context"
        title="Detach this note from the conversation"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
