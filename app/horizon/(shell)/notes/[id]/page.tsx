"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { notesStore, NotesStorageError } from "../../../_lib/notes_store";
import { handleImagePaste, handleImageDrop } from "../../../_lib/notes_paste";
import type { Note, NoteAttachment } from "../../../_lib/types";
import { DEFAULT_SUBJECTS } from "../../../_lib/types";
import { NoteAttachments } from "../../../_components/NoteAttachments";

const BEACON_BLUE = "#013B93";

export default function NoteEditor() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id     = params.id;

  const [note,      setNote]      = useState<Note | null>(null);
  const [missing,   setMissing]   = useState(false);
  const [dirty,     setDirty]     = useState(false);
  const [savedAt,   setSavedAt]   = useState<number | null>(null);
  const [dragOver,  setDragOver]  = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const n = notesStore.get(id);
    if (!n) { setMissing(true); return; }
    setNote(n);
  }, [id]);

  function update(patch: Partial<Note>) {
    setNote(prev => prev ? { ...prev, ...patch } : prev);
    setDirty(true);
  }

  function save() {
    if (!note) return;
    setSaveError(null);
    try {
      notesStore.update(note.id, {
        title:       note.title.trim() || "Untitled note",
        subject:     note.subject,
        body:        note.body,
        tags:        note.tags,
        attachments: note.attachments,
      });
      setDirty(false);
      setSavedAt(Date.now());
    } catch (err) {
      if (err instanceof NotesStorageError) {
        setSaveError(err.message);
      } else {
        setSaveError("Couldn't save the note. Try again.");
      }
      console.error("NoteEditor.save failed", err);
    }
  }

  function addAttachment(att: NoteAttachment) {
    setNote(prev => prev ? { ...prev, attachments: [...(prev.attachments || []), att] } : prev);
    setDirty(true);
  }

  function removeAttachment(attId: string) {
    setNote(prev => prev ? { ...prev, attachments: (prev.attachments || []).filter(a => a.id !== attId) } : prev);
    setDirty(true);
  }

  function destroy() {
    if (!note) return;
    if (!confirm("Delete this note? This can't be undone.")) return;
    notesStore.delete(note.id);
    router.replace("/horizon/notes");
  }

  if (missing) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="bg-white border border-slate-100 rounded-2xl px-6 py-8 text-center max-w-md">
          <div className="text-base font-semibold text-slate-800 mb-1">Note not found</div>
          <p className="text-sm text-slate-500 mb-4">It may have been deleted from this browser.</p>
          <Link href="/horizon/notes" className="text-sm font-semibold text-white px-3.5 py-2 rounded-xl inline-block" style={{ backgroundColor: BEACON_BLUE }}>
            Back to Notes
          </Link>
        </div>
      </div>
    );
  }

  if (!note) {
    return <div className="flex-1" />;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-4 md:px-6 py-5 flex-1 flex flex-col">

        {/* Header row */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <Link href="/horizon/notes" className="text-sm text-slate-500 hover:text-[#013B93] flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M12 19L5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            All notes
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href={`/horizon/chat?context_note=${note.id}`}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#E6EDF8] text-[#013B93] hover:bg-[#D5E0F2] transition-colors"
            >
              Ask Horizon about this
            </Link>
            <button
              onClick={destroy}
              className="text-xs text-slate-500 hover:text-red-600 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Metadata */}
        <div className="bg-white border border-slate-100 rounded-2xl px-4 py-3 mb-4 flex items-center gap-3 flex-wrap">
          <input
            value={note.title}
            onChange={e => update({ title: e.target.value })}
            className="flex-1 text-lg font-bold text-slate-800 bg-transparent focus:outline-none min-w-0"
            placeholder="Untitled note"
          />
          <select
            value={note.subject}
            onChange={e => update({ subject: e.target.value })}
            className="text-xs font-semibold uppercase tracking-wide bg-slate-100 text-slate-700 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#013B93]/20"
          >
            {DEFAULT_SUBJECTS.includes(note.subject)
              ? null
              : <option value={note.subject}>{note.subject}</option>}
            {DEFAULT_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {note.source_session_id && (
            <span className="text-[10px] font-medium text-[#013B93] bg-[#E6EDF8] px-1.5 py-0.5 rounded">from chat</span>
          )}
        </div>

        {/* Attachments */}
        <div className="bg-white border border-slate-100 rounded-2xl px-4 py-3 mb-4">
          <NoteAttachments
            attachments={note.attachments || []}
            onAdd={addAttachment}
            onRemove={removeAttachment}
          />
        </div>

        {/* Save row */}
        <div className="flex items-center justify-end gap-2 mb-3 text-xs text-slate-500">
          {savedAt && !dirty && !saveError && <span>Saved</span>}
          {dirty && <span className="text-amber-600">Unsaved changes</span>}
          <button
            onClick={save}
            disabled={!dirty}
            className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-40 hover:opacity-95"
            style={{ backgroundColor: BEACON_BLUE }}
          >
            Save
          </button>
        </div>

        {saveError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2.5 text-xs leading-snug mb-3">
            <div className="font-semibold mb-0.5">Couldn't save this note</div>
            {saveError}
          </div>
        )}

        {/* Body — plain text */}
        <div className="flex-1 min-h-[300px]">
          <div
            className="relative"
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
            onDragOver={(e)  => { e.preventDefault(); e.stopPropagation(); }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
              handleImageDrop(e, addAttachment);
            }}
          >
            <textarea
              value={note.body}
              onChange={e => update({ body: e.target.value })}
              onPaste={e => handleImagePaste(e, addAttachment)}
              placeholder="Start writing your note…"
              className={`w-full h-full min-h-[400px] border rounded-2xl px-4 py-3 text-sm text-slate-800 focus:outline-none resize-none bg-white transition-all leading-relaxed ${
                dragOver
                  ? "border-[#013B93] ring-4 ring-[#013B93]/20"
                  : "border-slate-200 focus:ring-2 focus:ring-[#013B93]/20 focus:border-[#013B93]"
              }`}
            />
            {dragOver && (
              <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[#013B93]/5 flex items-center justify-center">
                <div className="bg-white border-2 border-[#013B93] rounded-xl px-4 py-2.5 shadow-md text-sm font-semibold text-[#013B93] flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15M17 8L12 3M12 3L7 8M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Drop image to add to note
                </div>
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-2 pl-1">
            Paste, drag, or use <span className="font-semibold">Add image</span> to attach pictures. Images stay in this browser only.
          </p>
        </div>
      </div>
    </div>
  );
}
