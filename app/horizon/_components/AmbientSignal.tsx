"use client";

import type { AmbientSignal as Signal } from "../_lib/ambient_signals";

/**
 * Per ambient-social-v1-spec.md + design decisions 2026-05-26:
 * - Mirrors an assistant turn structurally (own avatar + content block on
 *   the LEFT, opposite the student bubbles on the right) so visually it
 *   reads as a third participant joining the conversation rather than a
 *   footnote under the AI.
 * - Avatar uses Pulse Amber (#F59E0B / #B45309 — master design system's
 *   "behaviour & learning insight" engine colour) and a small people glyph
 *   to mark it as cohort-attributed, not AI-attributed.
 * - Per the vision: NO claim of live presence or headcounts. Byline is an
 *   honest aggregate over time ("From past students"), not real-time peer
 *   activity.
 * - Calm/informative; never modal, never a banner; dismissible.
 */
export function AmbientSignal({
  signal,
  onDismiss,
}: {
  signal:    Signal;
  onDismiss: () => void;
}) {
  return (
    <div className="flex gap-3 mb-5 md:-ml-12 lg:-ml-20">
      {/* Peer-cohort avatar — mirrors AI avatar shape so it reads as a turn */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 bg-[#FEF3C7] border border-[#F59E0B]/60"
        aria-hidden
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-[#B45309]">
          <circle cx="8" cy="9" r="3" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="17" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M2.5 19c0-2.8 2.5-5 5.5-5s5.5 2.2 5.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M14 17c0-1.9 1.5-3.5 3.5-3.5s3.5 1.6 3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </div>

      {/* Content block */}
      <div className="max-w-[78%] flex flex-col gap-1 items-start">
        <div className="bg-[#FFFBEB] border border-[#F59E0B]/30 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#B45309]">
              From past students
            </span>
            <button
              onClick={onDismiss}
              className="ml-auto -mt-0.5 w-5 h-5 rounded hover:bg-amber-100/60 flex items-center justify-center text-amber-700/60 hover:text-amber-800 transition-colors"
              aria-label="Dismiss"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <p className="text-[13px] text-slate-700 leading-relaxed">
            {signal.text}
          </p>
        </div>
      </div>
    </div>
  );
}
