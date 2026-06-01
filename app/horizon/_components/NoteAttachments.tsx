"use client";

import { useRef, useState } from "react";
import type { NoteAttachment } from "../_lib/types";
import { ImageLightbox } from "./ImageLightbox";
import { handleImageFile, handleImageDrop } from "../_lib/notes_paste";

const BEACON_BLUE = "#013B93";

export function NoteAttachments({
  attachments,
  onAdd,
  onRemove,
  compact = false,
}: {
  attachments: NoteAttachment[];
  onAdd:       (att: NoteAttachment) => void;
  onRemove:    (id: string) => void;
  compact?:    boolean;
}) {
  const [lightbox, setLightbox] = useState<NoteAttachment | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function pickFile() {
    fileRef.current?.click();
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) await handleImageFile(f, onAdd);
    if (fileRef.current) fileRef.current.value = "";
  }

  const thumbSize = compact ? "w-16 h-16" : "w-20 h-20";

  return (
    <div
      className={`relative transition-all ${dragOver ? "ring-4 ring-[#013B93]/20 rounded-xl" : ""}`}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
      onDragOver={(e)  => { e.preventDefault(); e.stopPropagation(); }}
      onDragLeave={(e) => {
        // Only clear when the cursor actually leaves this block,
        // not when crossing into a child element.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        handleImageDrop(e, onAdd);
      }}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 rounded-xl bg-[#013B93]/5 border-2 border-dashed border-[#013B93] flex items-center justify-center">
          <div className="bg-white rounded-xl px-3 py-1.5 shadow-md text-sm font-semibold text-[#013B93] flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15M17 8L12 3M12 3L7 8M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Drop image to attach
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M21.44 11.05L12.25 20.24C11.1242 21.3658 9.59723 21.9983 8.005 21.9983C6.41277 21.9983 4.88584 21.3658 3.76 20.24C2.63416 19.1142 2.00166 17.5872 2.00166 15.995C2.00166 14.4028 2.63416 12.8758 3.76 11.75L12.95 2.56C13.7006 1.80944 14.7186 1.38773 15.78 1.38773C16.8414 1.38773 17.8594 1.80944 18.61 2.56C19.3606 3.31056 19.7823 4.32859 19.7823 5.39C19.7823 6.45141 19.3606 7.46944 18.61 8.22L9.41 17.41C9.03472 17.7853 8.52573 17.9961 7.995 17.9961C7.46427 17.9961 6.95528 17.7853 6.58 17.41C6.20472 17.0347 5.99389 16.5257 5.99389 15.995C5.99389 15.4643 6.20472 14.9553 6.58 14.58L15.07 6.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Attachments
          {attachments.length > 0 && (
            <span className="text-slate-400 font-medium">· {attachments.length}</span>
          )}
        </div>
        <button
          type="button"
          onClick={pickFile}
          className="text-[11px] font-semibold text-[#013B93] bg-[#E6EDF8] hover:bg-[#D5E0F2] px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          Add image
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="hidden"
        />
      </div>

      {attachments.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic px-1 py-1">
          Paste, drag, or use Add image to attach screenshots and pictures to this note.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {attachments.map((att) => (
            <div key={att.id} className="relative group">
              <button
                type="button"
                onClick={() => setLightbox(att)}
                className={`${thumbSize} rounded-xl overflow-hidden border border-slate-200 hover:border-[#013B93] hover:shadow-sm transition-all bg-slate-100 flex items-center justify-center`}
                title={att.filename || "image"}
                aria-label={`View ${att.filename || "image"}`}
              >
                <img
                  src={att.data_url}
                  alt={att.filename || "image"}
                  className="w-full h-full object-cover"
                />
              </button>
              <button
                type="button"
                onClick={() => onRemove(att.id)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-slate-200 shadow-sm text-slate-500 hover:text-red-600 hover:border-red-300 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                aria-label="Remove image"
                title="Remove"
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                  <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <ImageLightbox
          src={lightbox.data_url}
          alt={lightbox.filename}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
