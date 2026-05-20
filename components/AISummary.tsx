"use client";

import { useState, useEffect, useRef } from "react";

interface BeaconEvent {
  created_at: string;
  student_id: string;
  platform: string;
  prompt: string;
  risk: string;
  blocked: boolean;
  matched: string[];
}

interface Props {
  events: BeaconEvent[];
}

export default function AISummary({ events }: Props) {
  const [summary, setSummary]       = useState<string>("");
  const [suggestion, setSuggestion] = useState<string>("");
  const [loading, setLoading]       = useState(false);
  const prevCountRef                = useRef(0);

  async function generateSummary() {
    if (!events.length) return;
    setLoading(true);
    setSummary("");
    setSuggestion("");

    try {
      const res = await fetch("/api/ai-summary", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ events }),
      });

      if (!res.ok) throw new Error(await res.text());

      const data = await res.json();
      setSummary(data.summary ?? "");
      setSuggestion(data.suggestion ?? "");
    } catch (err) {
      console.error("AI summary error:", err);
      setSummary("Unable to generate summary. Please try again.");
      setSuggestion("");
    } finally {
      setLoading(false);
    }
  }

  // Auto-generate when events first load, re-generate if count changes by 5+
  useEffect(() => {
    const prev = prevCountRef.current;
    const curr = events.length;
    if (curr > 0 && (prev === 0 || curr - prev >= 5)) {
      prevCountRef.current = curr;
      generateSummary();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  return (
    <div className="bg-[#013B93] rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-stretch">

        {/* Left — AI badge */}
        <div className="bg-[#012d70] px-6 py-5 flex flex-col items-center justify-center gap-2 shrink-0 w-20">
          <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-xl">
            ✦
          </div>
          <span className="text-white/50 text-[10px] font-bold tracking-widest rotate-180 [writing-mode:vertical-lr]">
            AI
          </span>
        </div>

        {/* Centre — summary */}
        <div className="flex-1 px-6 py-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-white font-bold text-sm">AI Summary</span>
            {loading && (
              <span className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </span>
            )}
          </div>
          <p className="text-white/80 text-sm leading-relaxed">
            {loading
              ? "Analysing safeguarding events across the school..."
              : summary || "Waiting for event data..."}
          </p>
        </div>

        {/* Right — suggested action */}
        {suggestion && !loading && (
          <div className="bg-[#022f80] px-6 py-5 max-w-[280px] shrink-0 flex flex-col justify-center gap-1 border-l border-white/10">
            <span className="text-[#60a5fa] text-xs font-bold tracking-wide uppercase">
              Suggested action
            </span>
            <p className="text-white/80 text-sm leading-relaxed">{suggestion}</p>
          </div>
        )}

        {/* Refresh */}
        <div className="px-4 py-5 flex items-center shrink-0">
          <button
            onClick={generateSummary}
            disabled={loading || !events.length}
            title="Regenerate AI summary"
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all disabled:opacity-30"
          >
            ↺
          </button>
        </div>

      </div>
    </div>
  );
}
