"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";

interface BeaconEvent {
  created_at: string;
  student_id: string;
  platform:   string;
  prompt:     string;
  risk:       string;
  blocked:    boolean;
  matched:    string[];
}

interface Props {
  events: BeaconEvent[];
  schoolName?: string;
}

interface Intelligence {
  headline:   string;  // one punchy sentence
  summary:    string;  // 2-3 sentence analysis
  actions:    string[]; // 2-3 specific suggested actions
  risk_level: "critical" | "high" | "medium" | "low";
}

const RISK_CONFIG = {
  critical: { bar: "#7C3AED", light: "#F5F3FF", badge: "bg-purple-100 text-purple-700", label: "Critical" },
  high:     { bar: "#DC2626", light: "#FEF2F2", badge: "bg-red-100 text-red-700",       label: "High"     },
  medium:   { bar: "#F59E0B", light: "#FFFBEB", badge: "bg-amber-100 text-amber-700",   label: "Medium"   },
  low:      { bar: "#06B6D4", light: "#ECFEFF", badge: "bg-cyan-100 text-cyan-700",     label: "Low"      },
};

export default function BeaconIntelligence({ events, schoolName = "the school" }: Props) {
  const [intel, setIntel]       = useState<Intelligence | null>(null);
  const [loading, setLoading]   = useState(false);
  const [expanded, setExpanded] = useState(false);
  const prevCountRef            = useRef(0);

  async function generate() {
    if (!events?.length) return;
    setLoading(true);
    setIntel(null);

    const high     = events.filter(e => e.risk === "high" || e.risk === "critical").length;
    const medium   = events.filter(e => e.risk === "medium").length;
    const blocked  = events.filter(e => e.blocked).length;
    const platforms = [...new Set(events.map(e => e.platform))].join(", ");
    const students  = [...new Set(events.map(e => e.student_id))];
    const recent    = events.slice(0, 20).map(e => ({
      student: e.student_id, risk: e.risk,
      platform: e.platform, matched: e.matched?.join(", ") ?? "",
      prompt: e.prompt?.slice(0, 60),
    }));

    // Students with most high risk events
    const studentRisk: Record<string, number> = {};
    events.filter(e => e.risk === "high" || e.risk === "critical")
      .forEach(e => { studentRisk[e.student_id] = (studentRisk[e.student_id] || 0) + 1; });
    const topStudents = Object.entries(studentRisk)
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([id, count]) => `${id} (${count} high-risk events)`).join(", ");

    try {
      const res = await fetch("/api/ai-summary", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events,
          prompt_override: `You are Beacon Intelligence, the AI engine of a school safeguarding platform for ${schoolName}.

Analyse this data and respond ONLY with a JSON object, no markdown:
{
  "headline": "One punchy sentence (max 12 words) summarising the most important thing happening right now",
  "summary": "2-3 sentences of clear analysis covering key patterns, concerns, and what the data is telling you. Be direct and specific — mention student names, platforms, or risk types where relevant.",
  "actions": ["Action 1 — specific and actionable for a safeguarding lead", "Action 2", "Action 3"],
  "risk_level": "critical|high|medium|low"
}

Data:
- Total prompts: ${events.length}
- Unique students: ${students.length}
- High/critical risk: ${high}
- Medium risk: ${medium}  
- Blocked: ${blocked}
- Platforms: ${platforms}
- Students of highest concern: ${topStudents || "none"}
- Recent events sample: ${JSON.stringify(recent)}`
        }),
      });

      if (!res.ok) throw new Error();
      const data = await res.json();
      setIntel(data);
      setExpanded(true);
    } catch {
      setIntel({
        headline:   "Unable to generate intelligence report",
        summary:    "Please try again.",
        actions:    [],
        risk_level: "low",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const prev = prevCountRef.current;
    const curr = events.length;
    if (curr > 0 && (prev === 0 || curr - prev >= 5)) {
      prevCountRef.current = curr;
      generate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  const cfg = intel?.risk_level ? (RISK_CONFIG[intel.risk_level] ?? RISK_CONFIG.low) : RISK_CONFIG.low;

  return (
    <div className="mb-6 rounded-2xl overflow-hidden shadow-sm border border-slate-100">

      {/* Top bar — always visible */}
      <div
        className="flex items-center justify-between px-6 py-4 cursor-pointer transition-colors"
        style={{ background: intel ? cfg.bar : "#06B6D4" }}
        onClick={() => !loading && intel && setExpanded(e => !e)}
      >
        <div className="flex items-center gap-4">
          {/* Icon */}
          <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <Image src="/pulse_icon.png" alt="Beacon Intelligence" width={22} height={22} className="object-contain opacity-90" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-sm tracking-wide">BEACON INTELLIGENCE</span>
              {intel && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/20 text-white">
                  {cfg.label} Risk Level
                </span>
              )}
              {loading && (
                <span className="flex gap-1 ml-1">
                  {[0,1,2].map(i => (
                    <span key={i} className="w-1.5 h-1.5 rounded-full bg-white/60 animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </span>
              )}
            </div>
            <div className="text-white/80 text-sm mt-0.5">
              {loading
                ? "Analysing safeguarding data across the school..."
                : intel
                ? intel.headline
                : "Waiting for event data..."}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); generate(); }}
            disabled={loading}
            title="Regenerate"
            className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white/70 hover:text-white transition-all disabled:opacity-30 text-sm"
          >
            ↺
          </button>
          {intel && (
            <div className="text-white/60 text-lg">
              {expanded ? "▲" : "▼"}
            </div>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && intel && (
        <div className="bg-white px-6 py-5 grid grid-cols-[2fr_1fr] gap-6">

          {/* Left — summary */}
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Analysis</div>
            <p className="text-slate-700 text-sm leading-relaxed">{intel.summary}</p>
          </div>

          {/* Right — actions */}
          <div className="border-l border-slate-100 pl-6">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Suggested Actions</div>
            <div className="space-y-2">
              {intel.actions.map((action, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 mt-0.5"
                    style={{ background: cfg.bar }}
                  >
                    {i + 1}
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">{action}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
