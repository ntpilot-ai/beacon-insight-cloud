"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { notesStore } from "../_lib/notes_store";
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
    .replace(/[*_`>]/g, "")
    .replace(/\n+/g, " ")
    .slice(0, 120);
}

export function RecentNotes() {
  const [items, setItems] = useState<Note[]>([]);

  useEffect(() => {
    setItems(notesStore.recent(3));
  }, []);

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700">Your notes</h2>
        <Link href="/horizon/notes" className="text-xs text-[#013B93] hover:underline font-medium">
          Open Notes →
        </Link>
      </div>

      {items.length === 0 && (
        <div className="bg-white border border-slate-100 rounded-2xl px-5 py-6 text-center text-sm text-slate-500">
          You haven't saved any notes yet. From a chat reply, hit <span className="font-semibold">Save to notes</span> to capture useful answers here.
        </div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {items.map(n => (
            <Link
              key={n.id}
              href={`/horizon/notes/${n.id}`}
              className="bg-white border border-slate-100 hover:border-[#013B93] hover:shadow-sm rounded-2xl px-4 py-3.5 transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{n.subject}</span>
                {n.source_session_id && (
                  <span className="text-[10px] font-medium text-[#013B93] bg-[#E6EDF8] px-1.5 py-0.5 rounded" title="Saved from a chat">from chat</span>
                )}
              </div>
              <div className="text-sm font-semibold text-slate-800 mb-1 line-clamp-1">{n.title}</div>
              <div className="text-xs text-slate-500 line-clamp-2 leading-snug mb-2">{previewText(n.body)}</div>
              <div className="text-[11px] text-slate-400">{relative(n.updated_at)}</div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
