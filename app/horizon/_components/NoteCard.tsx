"use client";

import Link from "next/link";
import type { Note } from "../_lib/types";

function relative(iso: string): string {
  const d    = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)        return "just now";
  if (diff < 3600)      return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)     return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function previewText(body: string): string {
  return body
    .replace(/^#+\s*/gm, "")
    .replace(/_\(.*?\)_/g, "")
    .replace(/[*_`>]/g, "")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 160);
}

export function NoteCard({ note }: { note: Note }) {
  return (
    <Link
      href={`/horizon/notes/${note.id}`}
      className="bg-white border border-slate-100 hover:border-[#013B93] hover:shadow-sm rounded-2xl px-4 py-3.5 transition-all block"
    >
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{note.subject}</span>
        {note.source_session_id && (
          <span className="text-[10px] font-medium text-[#013B93] bg-[#E6EDF8] px-1.5 py-0.5 rounded" title="Saved from a chat">from chat</span>
        )}
        {note.mode_when_saved === "guided" && (
          <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded" title="Saved in Guided mode">guided</span>
        )}
        {note.attachments && note.attachments.length > 0 && (
          <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-0.5" title={`${note.attachments.length} attachment${note.attachments.length === 1 ? "" : "s"}`}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M21.44 11.05L12.25 20.24C11.1242 21.3658 9.59723 21.9983 8.005 21.9983C6.41277 21.9983 4.88584 21.3658 3.76 20.24C2.63416 19.1142 2.00166 17.5872 2.00166 15.995C2.00166 14.4028 2.63416 12.8758 3.76 11.75L12.95 2.56C13.7006 1.80944 14.7186 1.38773 15.78 1.38773C16.8414 1.38773 17.8594 1.80944 18.61 2.56C19.3606 3.31056 19.7823 4.32859 19.7823 5.39C19.7823 6.45141 19.3606 7.46944 18.61 8.22L9.41 17.41C9.03472 17.7853 8.52573 17.9961 7.995 17.9961C7.46427 17.9961 6.95528 17.7853 6.58 17.41C6.20472 17.0347 5.99389 16.5257 5.99389 15.995C5.99389 15.4643 6.20472 14.9553 6.58 14.58L15.07 6.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {note.attachments.length}
          </span>
        )}
      </div>
      <div className="text-sm font-semibold text-slate-800 mb-1 line-clamp-1">{note.title}</div>
      <div className="text-xs text-slate-500 line-clamp-3 leading-snug mb-2">{previewText(note.body)}</div>
      <div className="text-[11px] text-slate-400">{relative(note.updated_at)}</div>
    </Link>
  );
}
