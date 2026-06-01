"use client";

import type { Note, HorizonMode } from "./types";

const KEY = "horizon_notes_v1";

function read(): Note[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Note[];
  } catch {
    return [];
  }
}

/** Custom error so callers can distinguish quota issues from other failures. */
export class NotesStorageError extends Error {
  kind: "quota" | "unavailable" | "unknown";
  constructor(kind: NotesStorageError["kind"], message: string) {
    super(message);
    this.kind = kind;
    this.name = "NotesStorageError";
  }
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number };
  // Chrome/Safari/Edge: QuotaExceededError, code 22.
  // Firefox: NS_ERROR_DOM_QUOTA_REACHED, code 1014.
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}

function write(notes: Note[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(notes));
  } catch (err) {
    if (isQuotaError(err)) {
      throw new NotesStorageError(
        "quota",
        "Your browser ran out of room to save this note. Try removing an image attachment, deleting an old note, or saving without images.",
      );
    }
    throw new NotesStorageError(
      "unknown",
      "Couldn't save the note. Try again, or remove an attachment.",
    );
  }
}

function uid(): string {
  return "n-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export const notesStore = {
  list(): Note[] {
    return read().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },

  recent(limit = 3): Note[] {
    return this.list().slice(0, limit);
  },

  get(id: string): Note | null {
    return read().find(n => n.id === id) || null;
  },

  create(input: Omit<Note, "id" | "created_at" | "updated_at">): Note {
    const now = new Date().toISOString();
    const note: Note = { ...input, id: uid(), created_at: now, updated_at: now };
    write([note, ...read()]);
    return note;
  },

  update(id: string, patch: Partial<Omit<Note, "id" | "created_at">>): Note | null {
    const all = read();
    const i = all.findIndex(n => n.id === id);
    if (i < 0) return null;
    const updated = { ...all[i], ...patch, updated_at: new Date().toISOString() };
    all[i] = updated;
    write(all);
    return updated;
  },

  delete(id: string) {
    write(read().filter(n => n.id !== id));
  },

  subjects(): { subject: string; count: number }[] {
    const counts: Record<string, number> = {};
    for (const n of read()) counts[n.subject] = (counts[n.subject] || 0) + 1;
    return Object.entries(counts)
      .map(([subject, count]) => ({ subject, count }))
      .sort((a, b) => b.count - a.count);
  },

  search(q: string): Note[] {
    const needle = q.trim().toLowerCase();
    if (!needle) return this.list();
    return this.list().filter(n =>
      n.title.toLowerCase().includes(needle) ||
      n.body.toLowerCase().includes(needle) ||
      n.subject.toLowerCase().includes(needle) ||
      n.tags.some(t => t.toLowerCase().includes(needle)),
    );
  },
};

/**
 * Default body when saving from chat. Notes are plain text — markdown
 * syntax from the AI's reply gets flattened so what the student sees in
 * their note matches what they'd write themselves.
 */
export function defaultSaveBody(aiContent: string, _mode: HorizonMode): string {
  return markdownToPlainText(aiContent).trim();
}

/**
 * Fallback title when the /api/note-meta endpoint hasn't returned yet
 * (or fails). The endpoint generates a much better title with Haiku;
 * this is the safety net so the field is never empty on open.
 */
export function defaultSaveTitle(aiContent: string): string {
  const flat = markdownToPlainText(aiContent);
  const firstLine = flat.split(/\n/).map(l => l.trim()).find(Boolean) || "Untitled note";
  return firstLine.slice(0, 80);
}

/**
 * Flatten markdown to plain text. Not a full parser — a curated set of
 * regex passes that handle what the chat AI typically produces (headings,
 * bold/italic, lists, links, code fences, blockquotes).
 *
 * Conventions:
 * - Headings → plain lines (the `##` markers go, the text stays).
 * - Bullets → "• " (more readable than `-` or `*` in plain text).
 * - Numbered lists → kept as "1. item".
 * - Links → "text (url)" so the URL isn't lost.
 * - Image markdown → dropped entirely (we don't put inline images in plain
 *   text notes; attachments handle images now).
 * - Code fences → fence markers go, code content kept.
 */
export function markdownToPlainText(md: string): string {
  if (!md) return "";
  return md
    // Image markdown — drop entirely (attachments are separate)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // Fenced code blocks — keep content, drop fences
    .replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)\n?```/g, "$1")
    // Inline code
    .replace(/`([^`]+)`/g, "$1")
    // Links → "text (url)"; if url same as text, just text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) =>
      text === url ? text : `${text} (${url})`,
    )
    // Bold + italic combined (***...***)
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/___([^_]+)___/g, "$1")
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    // Italic
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1$2")
    // Headings — strip the `#` markers
    .replace(/^#{1,6}\s+/gm, "")
    // Blockquotes
    .replace(/^\s*>\s?/gm, "")
    // Bullets (- * +) → "• "
    .replace(/^(\s*)[-*+]\s+/gm, "$1• ")
    // Horizontal rules
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    // Collapse 3+ blank lines into a single blank line
    .replace(/\n{3,}/g, "\n\n");
}
