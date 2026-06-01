"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { notesStore, defaultSaveBody, defaultSaveTitle, NotesStorageError } from "../_lib/notes_store";
import { DEFAULT_SUBJECTS, type NoteAttachment } from "../_lib/types";
import { useHorizonMode } from "../_lib/HorizonModeContext";
import { handleImagePaste, handleImageDrop } from "../_lib/notes_paste";
import { NoteAttachments } from "./NoteAttachments";

const BEACON_BLUE = "#013B93";

export function SaveToNotesSheet({
  open,
  sourceContent,
  sourceSessionId,
  sourceMessageId,
  subjectHint,
  userQuestion,
  sessionTitle,
  onClose,
  onSaved,
}: {
  open:             boolean;
  sourceContent:    string;
  sourceSessionId?: string;
  sourceMessageId?: string;
  subjectHint?:     string;        // inferred subject from chat context
  userQuestion?:    string;        // student's question that produced the reply
  sessionTitle?:    string;        // chat session's existing auto-title
  onClose:          () => void;
  onSaved:          (noteId: string) => void;
}) {
  const { mode } = useHorizonMode();
  const [title,       setTitle]       = useState("");
  const [subject,     setSubject]     = useState(DEFAULT_SUBJECTS[0]);
  const [body,        setBody]        = useState("");
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const [dragOver,    setDragOver]    = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [saveError,   setSaveError]   = useState<string | null>(null);

  // Track whether the student has manually touched a field so the async
  // Haiku-suggested values don't clobber their edits.
  const touched = useRef<{ title: boolean; subject: boolean }>({ title: false, subject: false });

  useEffect(() => {
    if (!open) return;

    // Seed with the heuristic fallback + inferred subject so the modal
    // shows something immediately while Haiku is on its way.
    setTitle(defaultSaveTitle(sourceContent));
    setSubject(
      subjectHint && DEFAULT_SUBJECTS.includes(subjectHint)
        ? subjectHint
        : "Other",
    );
    setBody(defaultSaveBody(sourceContent, mode));
    setAttachments([]);
    setSaveError(null);
    touched.current = { title: false, subject: false };

    // Fire the Haiku call. If the student starts typing or closes the
    // modal before it returns, we either skip the assignment or bail.
    const ac = new AbortController();
    setMetaLoading(true);
    fetch("/api/note-meta", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        aiContent:    sourceContent,
        userQuestion,
        sessionTitle,
      }),
      signal: ac.signal,
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        if (data.title && !touched.current.title) {
          setTitle(data.title);
        }
        // Only override subject if Haiku gave us something real and the
        // student hasn't picked their own already. Keep the keyword-sniff
        // hint if Haiku returned "Other" but we had a confident hint.
        if (data.subject && !touched.current.subject) {
          if (data.subject !== "Other" || !subjectHint) {
            setSubject(data.subject);
          }
        }
      })
      .catch(() => { /* aborted or network — silently keep fallbacks */ })
      .finally(() => setMetaLoading(false));

    return () => ac.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceContent]);

  function addAttachment(att: NoteAttachment) {
    setAttachments(prev => [...prev, att]);
  }
  function removeAttachment(id: string) {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }

  function save() {
    setSaveError(null);
    try {
      const note = notesStore.create({
        title:             title.trim() || "Untitled note",
        subject,
        body:              body.trim(),
        tags:              [],
        attachments,
        source_session_id: sourceSessionId,
        source_message_id: sourceMessageId,
        mode_when_saved:   mode,
      });
      onSaved(note.id);
    } catch (err) {
      // Stay on the modal so the student doesn't lose their work.
      if (err instanceof NotesStorageError) {
        setSaveError(err.message);
      } else {
        setSaveError("Couldn't save the note. Try again.");
      }
      console.error("SaveToNotesSheet.save failed", err);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-900/40" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-xl md:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] flex flex-col"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div className="text-base font-bold text-slate-800">Save to your notes</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {mode === "guided"
                ? "Guided mode — Horizon's saved a thinking scaffold for you. Edit it before saving."
                : "Edit any part before saving."}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-2">
              Title
              {metaLoading && (
                <span className="text-[10px] font-normal text-slate-400 normal-case tracking-normal flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#013B93] animate-pulse" />
                  Suggesting a title…
                </span>
              )}
            </label>
            <input
              value={title}
              onChange={e => { touched.current.title = true; setTitle(e.target.value); }}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#013B93]/20 focus:border-[#013B93]"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Subject</label>
            <select
              value={subject}
              onChange={e => { touched.current.subject = true; setSubject(e.target.value); }}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#013B93]/20 focus:border-[#013B93] bg-white"
            >
              {DEFAULT_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
            <NoteAttachments
              attachments={attachments}
              onAdd={addAttachment}
              onRemove={removeAttachment}
              compact
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Note</label>
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
                value={body}
                onChange={e => setBody(e.target.value)}
                onPaste={e => handleImagePaste(e, addAttachment)}
                rows={10}
                className={`w-full border rounded-xl px-3 py-2 text-sm focus:outline-none resize-y leading-relaxed transition-all ${
                  dragOver
                    ? "border-[#013B93] ring-4 ring-[#013B93]/20"
                    : "border-slate-200 focus:ring-2 focus:ring-[#013B93]/20 focus:border-[#013B93]"
                }`}
              />
              {dragOver && (
                <div className="pointer-events-none absolute inset-0 rounded-xl bg-[#013B93]/5 flex items-center justify-center">
                  <div className="bg-white border-2 border-[#013B93] rounded-xl px-4 py-2 shadow-md text-sm font-semibold text-[#013B93] flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15M17 8L12 3M12 3L7 8M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Drop image to attach
                  </div>
                </div>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              Edit the text before saving. Paste or drag an image to attach it.
            </p>
          </div>
        </div>

        {saveError && (
          <div className="px-5 pb-3 -mt-1">
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2.5 text-xs leading-snug">
              <div className="font-semibold mb-0.5">Couldn't save this note</div>
              <div>{saveError}</div>
              <div className="mt-2 flex items-center gap-3">
                <Link
                  href="/horizon/notes"
                  onClick={onClose}
                  className="text-[11px] font-semibold text-red-700 hover:text-red-900 underline underline-offset-2"
                >
                  Open Notes to free up space →
                </Link>
                {attachments.length > 0 && (
                  <button
                    onClick={() => { setAttachments([]); setSaveError(null); }}
                    className="text-[11px] font-semibold text-red-700 hover:text-red-900 underline underline-offset-2"
                  >
                    Remove this note's image{attachments.length === 1 ? "" : "s"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 rounded-xl"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-4 py-2 text-sm font-semibold text-white rounded-xl hover:opacity-95"
            style={{ backgroundColor: BEACON_BLUE }}
          >
            Save note
          </button>
        </div>
      </div>
    </div>
  );
}
