"use client";

import { useRef } from "react";

export interface ChatStreamRequest {
  message:   string;
  sessionId: string | null;
  studentId: string;
  schoolId:  string;
  model:     string;
  mode?:     "quiz";                 // optional API mode supplement
  history:   { role: string; content: string }[];
}

export interface ChatStreamMeta {
  sessionId: string;
  blocked:   boolean;
  risk:      string;
  matched:   string[];
}

export interface ChatStreamCallbacks {
  onMeta:     (meta: ChatStreamMeta) => void;
  onToken:    (chunk: string) => void;
  onComplete: (full: string) => void;
  onError:    (err: Error) => void;
}

/**
 * Today: calls /api/chat (non-streaming) and chunks the JSON reply client-side
 * to simulate token-by-token delivery. The callback shape mirrors a real SSE /
 * ReadableStream consumer, so swapping the backend later is a one-file change.
 */
export function useChatStream() {
  const cancelled = useRef(false);

  function cancel() {
    cancelled.current = true;
  }

  async function send(req: ChatStreamRequest, cb: ChatStreamCallbacks): Promise<void> {
    cancelled.current = false;

    try {
      const res = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          message:   req.message,
          sessionId: req.sessionId,
          studentId: req.studentId,
          schoolId:  req.schoolId,
          history:   req.history,
          mode:      req.mode,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `API error ${res.status}`);
      }

      const data = await res.json();

      cb.onMeta({
        sessionId: data.sessionId,
        blocked:   !!data.blocked,
        risk:      data.risk || "low",
        matched:   data.matched || [],
      });

      const full: string = data.reply || "";
      await chunkOut(full, cb, cancelled);

      if (!cancelled.current) cb.onComplete(full);
    } catch (err: any) {
      if (!cancelled.current) cb.onError(err);
    }
  }

  return { send, cancel };
}

async function chunkOut(
  full:      string,
  cb:        ChatStreamCallbacks,
  cancelled: React.MutableRefObject<boolean>,
) {
  // Split into word-ish tokens so the UI feels like real streaming.
  const tokens = full.match(/\s*\S+|\s+/g) || [full];
  for (const t of tokens) {
    if (cancelled.current) return;
    cb.onToken(t);
    await new Promise(r => setTimeout(r, 18));
  }
}
