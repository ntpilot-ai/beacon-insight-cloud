/**
 * Image input helper for Notes — paste + drag-and-drop + file-picker.
 *
 * v1: pasted/dropped images become first-class **attachments** on the Note
 * (NoteAttachment[]), not inline markdown. The body stays clean text. A
 * v2 Supabase-backed notes layer should swap the inline data URL for a
 * blob-storage URL — only this file changes.
 *
 * Legacy markdown image syntax (`![alt](data:image/…)`) is still rendered
 * by old notes that pre-date this refactor. stripDataUrlImages() is kept
 * for the chat-context handoff so any such legacy bodies don't bloat the
 * outbound prompt.
 */

import type { NoteAttachment } from "./types";

const MAX_DATA_URL_CHARS = 3_500_000;     // ~2.5MB binary after base64
const TOO_LARGE_MESSAGE =
  "That image is too large to add to your notes.\n\n" +
  "Try a smaller image (under about 2 MB) — for example a screenshot " +
  "rather than a full-resolution photo.";

/** Strip legacy inline image markdown when a note is sent as chat context. */
export function stripDataUrlImages(markdown: string): string {
  return markdown.replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/g, "[image omitted]");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function uid(): string {
  return "att-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/**
 * Resize the image to fit inside maxDimension on its long edge and re-encode
 * as JPEG at quality 0.85. Skips the work if the image is already small
 * enough OR if the runtime doesn't support the canvas APIs (very old
 * browsers / SSR). Returns the original blob if anything fails — caller's
 * existing MAX_DATA_URL_CHARS guard will catch any still-too-big result.
 */
async function downscaleImage(
  blob:         Blob,
  maxDimension = 1280,
  quality      = 0.85,
): Promise<Blob> {
  if (typeof window === "undefined") return blob;
  if (typeof document === "undefined") return blob;
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return blob;

  // GIFs and SVGs are special — don't re-encode them.
  if (blob.type === "image/gif" || blob.type === "image/svg+xml") return blob;

  const objectUrl = URL.createObjectURL(blob);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload  = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src     = objectUrl;
    });

    if (img.width <= maxDimension && img.height <= maxDimension && blob.size < 400_000) {
      // Small both in pixels and bytes — no point recompressing.
      return blob;
    }

    const ratio    = Math.min(maxDimension / img.width, maxDimension / img.height, 1);
    const w        = Math.max(1, Math.round(img.width  * ratio));
    const h        = Math.max(1, Math.round(img.height * ratio));

    const canvas   = document.createElement("canvas");
    canvas.width   = w;
    canvas.height  = h;
    const ctx      = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(img, 0, 0, w, h);

    const resized = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", quality);
    });

    if (!resized) return blob;
    // If for some reason resizing made it bigger (rare edge case), keep original.
    return resized.size < blob.size ? resized : blob;
  } catch {
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function blobToAttachment(blob: Blob, filename?: string): Promise<NoteAttachment | null> {
  const usable  = await downscaleImage(blob);
  const dataUrl = await blobToDataUrl(usable);

  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    alert(TOO_LARGE_MESSAGE);
    return null;
  }

  return {
    id:         uid(),
    kind:       "image",
    data_url:   dataUrl,
    filename:   filename || "image",
    byte_size:  usable.size,
    created_at: new Date().toISOString(),
  };
}

export type AddAttachment = (att: NoteAttachment) => void;

/**
 * Paste handler — when the clipboard contains an image, calls addAttachment
 * with a NoteAttachment built from the clipboard blob and stops the default
 * paste (so the bytes don't also get pasted as text into the textarea).
 * Returns true if it handled the paste.
 */
export async function handleImagePaste(
  e:             React.ClipboardEvent<HTMLTextAreaElement>,
  addAttachment: AddAttachment,
): Promise<boolean> {
  const items = e.clipboardData?.items;
  if (!items || items.length === 0) return false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.type.startsWith("image/")) continue;

    e.preventDefault();
    const blob = item.getAsFile();
    if (!blob) {
      console.warn("notes_paste: clipboard item reported image/* but getAsFile() returned null", item);
      return true;
    }

    try {
      const att = await blobToAttachment(blob);
      if (att) addAttachment(att);
      return true;
    } catch (err) {
      console.error("notes_paste: image paste failed", err, { blobType: blob.type, blobSize: blob.size });
      alert("Couldn't paste that image. Try again, or use a different one.");
      return true;
    }
  }

  return false;
}

/**
 * Drop handler — accepts an image dragged from the OS or another tab.
 * Returns true if it handled the drop.
 */
export async function handleImageDrop(
  e:             React.DragEvent<HTMLElement>,
  addAttachment: AddAttachment,
): Promise<boolean> {
  e.preventDefault();

  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return false;

  let imageFile: File | null = null;
  for (let i = 0; i < files.length; i++) {
    if (files[i].type.startsWith("image/")) { imageFile = files[i]; break; }
  }
  if (!imageFile) {
    console.warn("notes_paste: drop had no image file", { fileTypes: Array.from(files).map(f => f.type) });
    return false;
  }

  try {
    const att = await blobToAttachment(imageFile, imageFile.name);
    if (att) addAttachment(att);
    return true;
  } catch (err) {
    console.error("notes_paste: image drop failed", err, { name: imageFile.name, type: imageFile.type, size: imageFile.size });
    alert("Couldn't add that image. Try again, or use a different one.");
    return true;
  }
}

/** File-picker handler — used by the "+ Add image" button. */
export async function handleImageFile(
  file:          File,
  addAttachment: AddAttachment,
): Promise<void> {
  if (!file.type.startsWith("image/")) {
    alert("That doesn't look like an image file.");
    return;
  }
  try {
    const att = await blobToAttachment(file, file.name);
    if (att) addAttachment(att);
  } catch (err) {
    console.error("notes_paste: image file failed", err);
    alert("Couldn't add that image. Try again, or use a different one.");
  }
}
