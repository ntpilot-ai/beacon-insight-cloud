"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notesStore } from "../../_lib/notes_store";
import type { Note } from "../../_lib/types";
import { DEFAULT_SUBJECTS } from "../../_lib/types";
import { NoteCard } from "../../_components/NoteCard";
import { SubjectRail } from "../../_components/SubjectRail";

const BEACON_BLUE = "#013B93";

export default function NotesIndex() {
  const [notes,   setNotes]   = useState<Note[]>([]);
  const [active,  setActive]  = useState<string | null>(null);
  const [query,   setQuery]   = useState("");

  useEffect(() => { setNotes(notesStore.list()); }, []);

  const subjects = useMemo(() => notesStore.subjects(), [notes]);

  const filtered = useMemo(() => {
    let list = notes;
    if (active)        list = list.filter(n => n.subject === active);
    if (query.trim())  list = list.filter(n => {
      const q = query.trim().toLowerCase();
      return n.title.toLowerCase().includes(q)
          || n.body.toLowerCase().includes(q)
          || n.subject.toLowerCase().includes(q);
    });
    return list;
  }, [notes, active, query]);

  function createBlankAndOpen() {
    const note = notesStore.create({
      title:   "Untitled note",
      subject: DEFAULT_SUBJECTS[0],
      body:    "",
      tags:    [],
    });
    window.location.href = `/horizon/notes/${note.id}`;
  }

  return (
    <div className="flex-1 flex min-h-0">
      <SubjectRail
        subjects={subjects}
        active={active}
        totalCount={notes.length}
        onPick={setActive}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="px-4 md:px-6 py-5 max-w-5xl mx-auto w-full">

          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-slate-800">
                {active ? active : "All notes"}
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {filtered.length} note{filtered.length === 1 ? "" : "s"}
              </p>
            </div>
            <button
              onClick={createBlankAndOpen}
              className="text-sm font-semibold text-white px-3.5 py-2 rounded-xl hover:opacity-95"
              style={{ backgroundColor: BEACON_BLUE }}
            >
              + New note
            </button>
          </div>

          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by title, content, or subject…"
            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#013B93]/20 focus:border-[#013B93] mb-5"
          />

          {filtered.length === 0 && notes.length === 0 && (
            <div className="bg-white border border-dashed border-slate-200 rounded-2xl px-6 py-10 text-center">
              <div className="text-base font-semibold text-slate-800 mb-1">No notes yet</div>
              <p className="text-sm text-slate-500 mb-4 max-w-md mx-auto">
                Save useful answers from <Link href="/horizon/chat" className="text-[#013B93] font-medium hover:underline">Chat</Link> as notes — or create one from scratch.
              </p>
              <button
                onClick={createBlankAndOpen}
                className="text-sm font-semibold text-white px-4 py-2 rounded-xl hover:opacity-95"
                style={{ backgroundColor: BEACON_BLUE }}
              >
                Create your first note
              </button>
            </div>
          )}

          {filtered.length === 0 && notes.length > 0 && (
            <div className="bg-white border border-dashed border-slate-200 rounded-2xl px-6 py-8 text-center text-sm text-slate-500">
              No notes match that filter.
            </div>
          )}

          {filtered.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map(n => <NoteCard key={n.id} note={n} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
