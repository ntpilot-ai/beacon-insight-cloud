"use client";

import { useEffect, useState, useMemo, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { SCHOOL_ID } from "@/lib/config";
import { fetchAllEvents } from "@/lib/fetchEvents";
import { useAuth } from "@/lib/useAuth";
import Sidebar from "@/components/Sidebar";
import Image from "next/image";
import Link from "next/link";
import {
  calculateAllPulsesV3,
  type StudentPulseV3,
  type PulseAcknowledgement,
  type AcknowledgeAction,
} from "@/lib/pulse_engine_v3";
import {
  groupSessions,
  mergeAnalyses,
  isSettled,
  type SessionAnalysis,
  type ConversationSession,
} from "@/lib/sessions";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";


const ALERT = {
  critical: { label: "Critical", bg: "bg-indigo-100", text: "text-indigo-700", bar: "#4F46E5", light: "#EEF2FF", ring: "ring-indigo-300" },
  high:     { label: "High",     bg: "bg-red-100",    text: "text-red-600",    bar: "#DC2626", light: "#FEF2F2", ring: "ring-red-300"    },
  medium:   { label: "Medium",   bg: "bg-amber-100",  text: "text-amber-700",  bar: "#F59E0B", light: "#FFFBEB", ring: "ring-amber-300"  },
  low:      { label: "Low",      bg: "bg-slate-100",  text: "text-slate-500",  bar: "#10B981", light: "#F0FDF4", ring: "ring-slate-200"  },
};

const TREND_DIR = {
  rising:  { icon: "↑", color: "text-red-500"      },
  falling: { icon: "↓", color: "text-emerald-500"  },
  stable:  { icon: "→", color: "text-slate-400"    },
};

const SHAPE_ICON: Record<string, string> = {
  sudden_spike:  "⚡",
  gradual_climb: "📈",
  chronic:       "⚠️",
  improving:     "📉",
  normal:        "✓",
};

const CAT_COLOR: Record<string, string> = {
  "Self-harm":             "#DC2626",
  "Violence":              "#B45309",
  "Jailbreak":             "#7C3AED",
  "Inappropriate Content": "#DB2777",
  "Substance":             "#D97706",
  "Bullying":              "#0369A1",
  "General":               "#64748b",
};

const RISK_GROUP_CONFIG = {
  high:   { label: "HIGH RISK",   badge: "bg-red-100 text-red-600",    bar: "#DC2626", border: "border-red-200"   },
  medium: { label: "MEDIUM RISK", badge: "bg-amber-100 text-amber-700", bar: "#F59E0B", border: "border-amber-200" },
  low:    { label: "LOW RISK",    badge: "bg-slate-100 text-slate-500", bar: "#10B981", border: "border-slate-200" },
};

const ACTION_CONFIG: Record<AcknowledgeAction, { label: string; short: string; color: string }> = {
  monitored:  { label: "Monitor",   short: "Monitored",   color: "#0369A1" },
  referred:   { label: "Refer",     short: "Referred",    color: "#7C3AED" },
  escalated:  { label: "Escalate",  short: "Escalated",   color: "#DC2626" },
  no_action:  { label: "No action", short: "No action",   color: "#64748b" },
};

const dateShort = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function fetchAcknowledgements(schoolId: string): Promise<PulseAcknowledgement[]> {
  const { data, error } = await supabase
    .from("pulse_acknowledgements")
    .select("*")
    .eq("school_id", schoolId)
    .order("acknowledged_at", { ascending: false });
  if (error || !data) return [];
  return data as PulseAcknowledgement[];
}

async function fetchSessionAnalyses(schoolId: string): Promise<SessionAnalysis[]> {
  const { data, error } = await supabase
    .from("beacon_session_analysis")
    .select("session_id,escalated_to_llm,sentiment_score,sentiment_messages,sentiment_trend,llm_requested_by,llm_requested_at,context_risk,sentiment_arc,concern_summary,requires_review,reasoning,behavioural_indicators,analyzed_at")
    .eq("school_id", schoolId)
    .order("analyzed_at", { ascending: false });
  if (error || !data) return [];
  return data as SessionAnalysis[];
}

// Cap per page load. Each call now only runs the local sentiment pre-filter
// + a Supabase insert (no LLM, no API cost), so this is just throttling DB
// writes rather than money. Sessions are processed in parallel batches
// below, so even large caps drain in a few seconds on first load.
const ANALYSIS_BUDGET_PER_LOAD = 500;
const ANALYSIS_CONCURRENCY     = 10;

async function insertAcknowledgement(payload: {
  student_id:        string;
  alert_level:       string;
  dominant_category: string | null;
  action_taken:      AcknowledgeAction;
  notes?:            string;
}): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  const email = session?.user?.email ?? "unknown";
  const { error } = await supabase.from("pulse_acknowledgements").insert({
    school_id:         SCHOOL_ID,
    student_id:        payload.student_id,
    acknowledged_by:   email,
    alert_level:       payload.alert_level,
    dominant_category: payload.dominant_category,
    action_taken:      payload.action_taken,
    notes:             payload.notes || null,
  });
  return !error;
}

function RiskGroup({ riskKey, events }: { riskKey: "high" | "medium" | "low"; events: any[] }) {
  const [open, setOpen] = useState(false);
  const cfg = RISK_GROUP_CONFIG[riskKey];
  if (events.length === 0) return null;
  const latest = events[0];
  const preview = latest.prompt?.slice(0, 60) + (latest.prompt?.length > 60 ? "…" : "");
  const latestDate = new Date(latest.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const latestTime = new Date(latest.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const rc = riskKey === "high" ? "#DC2626" : riskKey === "medium" ? "#F59E0B" : "#10B981";

  return (
    <div className="rounded-xl overflow-hidden border border-slate-100">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${cfg.badge}`}>
          {cfg.label}
        </span>
        <span className="text-xs font-semibold text-slate-500 shrink-0">{events.length} prompt{events.length !== 1 ? "s" : ""}</span>
        <span className="flex-1 text-xs text-slate-400 truncate min-w-0">
          {preview}
        </span>
        <span className="text-[10px] text-slate-400 shrink-0">{latestDate} {latestTime}</span>
        <svg
          className="shrink-0 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          width="12" height="12" viewBox="0 0 12 12" fill="none"
        >
          <path d="M2 4l4 4 4-4" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="divide-y divide-slate-50">
          {events.map((event: any, idx: number) => {
            return (
              <div key={idx} className="flex gap-3 p-3 border-l-2 bg-white" style={{ borderLeftColor: rc }}>
                <div className="shrink-0 w-16 text-right">
                  <div className="text-[10px] text-slate-400">{new Date(event.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
                  <div className="text-[10px] text-slate-400">{new Date(event.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
                  <div className="text-[10px] font-bold mt-0.5" style={{ color: rc }}>{event.risk?.toUpperCase()}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 leading-relaxed">{event.prompt}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[10px] text-slate-400">{event.platform}</span>
                    {event.matched?.map((m: string, i: number) => (
                      <span key={`${m}-${i}`} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">{m}</span>
                    ))}
                    {event.blocked && <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">Blocked</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Acknowledgement panel ─────────────────────────────────────────────────────
function AcknowledgementPanel({
  pulse,
  onSubmit,
}: {
  pulse: StudentPulseV3;
  onSubmit: (action: AcknowledgeAction, notes: string) => Promise<void>;
}) {
  const [open, setOpen]       = useState(false);
  const [action, setAction]   = useState<AcknowledgeAction>("monitored");
  const [notes, setNotes]     = useState("");
  const [saving, setSaving]   = useState(false);

  const last = pulse.last_acknowledged;
  const lastCfg = last ? ACTION_CONFIG[last.action_taken] : null;

  const handleSave = async () => {
    setSaving(true);
    await onSubmit(action, notes.trim());
    setSaving(false);
    setOpen(false);
    setNotes("");
    setAction("monitored");
  };

  return (
    <div className="rounded-2xl border border-slate-100 bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
          Acknowledgement
        </span>
        {last && lastCfg ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-xs font-semibold text-slate-700">
              {dateShort(last.acknowledged_at)}
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white shrink-0"
                  style={{ background: lastCfg.color }}>
              {lastCfg.short}
            </span>
            <span className="text-xs text-slate-400 truncate">
              by {last.acknowledged_by}{last.notes ? ` — ${last.notes}` : ""}
            </span>
          </div>
        ) : (
          <span className="text-xs text-slate-400 flex-1">Not yet acknowledged</span>
        )}
        <button
          onClick={() => setOpen(o => !o)}
          className="text-xs font-semibold text-[#06B6D4] border border-[#06B6D4] px-3 py-1 rounded-xl hover:bg-cyan-50 transition-all shrink-0"
        >
          {last ? "Update" : "Acknowledge"}{open ? " ▲" : " ▼"}
        </button>
      </div>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-3">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
              Action
            </label>
            <div className="flex gap-2 flex-wrap">
              {(Object.entries(ACTION_CONFIG) as [AcknowledgeAction, typeof ACTION_CONFIG[AcknowledgeAction]][]).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => setAction(key)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition-all ${
                    action === key
                      ? "text-white border-transparent"
                      : "text-slate-500 border-slate-200 hover:border-slate-400"
                  }`}
                  style={action === key ? { background: cfg.color } : {}}
                >
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Context, conversation outcome, follow-up plan…"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20 resize-none"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => { setOpen(false); setNotes(""); }}
              className="text-xs font-semibold text-slate-500 px-3 py-1.5 rounded-xl hover:bg-slate-50 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs font-semibold text-white bg-[#06B6D4] px-4 py-1.5 rounded-xl hover:bg-cyan-600 disabled:opacity-50 transition-all"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Session card ──────────────────────────────────────────────────────────────
// One row per conversation session. Border colour reflects the verdict from
// the LLM session-analysis pass: red for "requires_review", amber for high
// context_risk, slate-dashed for triggered-but-unanalysed, light for everyday.
const ARC_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  escalating:       { label: "↑ escalating",    color: "text-red-600",     bg: "bg-red-50"     },
  "de-escalating":  { label: "↓ de-escalating", color: "text-emerald-600", bg: "bg-emerald-50" },
  stable:           { label: "→ stable",         color: "text-slate-500",   bg: "bg-slate-100"  },
  unresolved:       { label: "⚠ unresolved",    color: "text-amber-600",   bg: "bg-amber-50"   },
};

const TREND_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  deteriorating: { label: "📉 deteriorating", color: "text-amber-700",   bg: "bg-amber-50"    },
  improving:     { label: "📈 improving",     color: "text-emerald-700", bg: "bg-emerald-50"  },
  volatile:      { label: "↕ volatile",       color: "text-orange-700",  bg: "bg-orange-50"   },
  stable:        { label: "→ stable",          color: "text-slate-500",   bg: "bg-slate-100"   },
};

// Aegis-category for a whole session: highest risk across its events.
type SessionRiskLevel = "high" | "medium" | "low";
function sessionRiskLevel(s: ConversationSession<any>): SessionRiskLevel {
  let level: SessionRiskLevel = "low";
  for (const e of s.events) {
    if (e.risk === "high" || e.risk === "critical") return "high";
    if (e.risk === "medium") level = "medium";
  }
  return level;
}

const RISK_GROUP_STYLE: Record<SessionRiskLevel, { label: string; badge: string }> = {
  high:   { label: "HIGH RISK",   badge: "bg-red-100 text-red-700"        },
  medium: { label: "MEDIUM RISK", badge: "bg-amber-100 text-amber-700"    },
  low:    { label: "LOW RISK",    badge: "bg-slate-100 text-slate-500"    },
};

function SessionCard({
  session,
  analysis,
  onRequestLLM,
  hideRunAI = false,
}: {
  session:      ConversationSession<any>;
  analysis:     SessionAnalysis | undefined;
  onRequestLLM: (session: ConversationSession<any>) => Promise<void>;
  hideRunAI?:   boolean;
}) {
  const [open, setOpen]     = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const needsReview    = !!analysis?.requires_review;
  const ctxHigh        = analysis?.context_risk === "high";
  const arc            = analysis?.sentiment_arc ? ARC_STYLE[analysis.sentiment_arc] : null;
  const sentimentRan   = !!analysis;
  const llmRan         = !!analysis?.llm_requested_at;
  const flaggedForLLM  = !!analysis?.escalated_to_llm && !llmRan;
  const trend          = session.sentiment?.trend;
  const trendStyle     = trend ? TREND_STYLE[trend] : null;

  const handleRunLLM = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (running || llmRan) return;
    setRunning(true);
    setRunError(null);
    try {
      await onRequestLLM(session);
    } catch (err: any) {
      setRunError(err?.message || "Failed to run analysis");
    } finally {
      setRunning(false);
    }
  };

  let borderColor = "#e2e8f0";          // slate-200 — quiet default
  if (needsReview)                                borderColor = "#DC2626";
  else if (ctxHigh)                               borderColor = "#F59E0B";
  else if (flaggedForLLM)                         borderColor = "#F59E0B";  // sentiment flag, awaiting review
  else if (trend === "deteriorating")             borderColor = "#F59E0B";
  else if (trend === "volatile")                  borderColor = "#FB923C";
  else if (session.has_trigger)                   borderColor = "#94a3b8";

  const dateLabel = new Date(session.started_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const timeLabel = new Date(session.started_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="rounded-xl border border-slate-100 border-l-4 bg-white overflow-hidden"
      style={{ borderLeftColor: borderColor }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-4 py-3 hover:bg-slate-50/60 transition-colors"
      >
        {/* Top line — when/where + status badges */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1.5">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-xs font-semibold text-slate-700">{dateLabel} {timeLabel}</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              {session.platform}
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-xs text-slate-400">{session.events.length} prompt{session.events.length !== 1 ? "s" : ""}</span>
            {session.has_trigger && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-[10px] font-bold text-red-600">⚡ TRIGGERED</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            {needsReview && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600 text-white">
                ⚠ Needs Review
              </span>
            )}
            {!needsReview && ctxHigh && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                Context concern
              </span>
            )}
            {flaggedForLLM && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                Context concern
              </span>
            )}
            {arc && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${arc.bg} ${arc.color}`}>
                {arc.label}
              </span>
            )}
            {trendStyle && trend !== "stable" && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${trendStyle.bg} ${trendStyle.color}`}>
                {trendStyle.label}
              </span>
            )}
            {sentimentRan && !flaggedForLLM && !llmRan && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700">
                Monitored
              </span>
            )}
            {!sentimentRan && session.has_trigger && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                Pending analysis
              </span>
            )}
          </div>
        </div>

        {/* Concern summary (LLM) or trigger preview (fallback) */}
        {analysis?.concern_summary ? (
          <p className="text-sm text-slate-600 leading-snug line-clamp-2">{analysis.concern_summary}</p>
        ) : session.trigger_event ? (
          <p className="text-xs text-slate-400 italic line-clamp-1">
            Aegis fired on: “{session.trigger_event.prompt.slice(0, 120)}”
          </p>
        ) : (
          <p className="text-xs text-slate-400 italic line-clamp-1">
            {session.events[0]?.prompt?.slice(0, 120)}
          </p>
        )}

        {/* Behavioural indicators */}
        {analysis && analysis.behavioural_indicators?.length > 0 && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {analysis.behavioural_indicators.slice(0, 6).map((tag, i) => (
              <span key={i} className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                {tag}
              </span>
            ))}
          </div>
        )}
      </button>

      {/* Manual LLM trigger — only on sentiment-flagged sessions where the
          teacher hasn't yet requested AI analysis. Button label is explicit
          so staff own the decision to invoke AI summarisation. Hidden on
          LOW-category sessions and single-prompt sessions: no conversational
          arc for the LLM to read, just the Aegis-classified trigger itself. */}
      {flaggedForLLM && !hideRunAI && session.events.length >= 2 && (
        <div className="px-4 py-2.5 border-t border-slate-100 bg-amber-50/40 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-slate-600">
            <span className="font-semibold text-amber-700">Sentiment flagged this session.</span>{" "}
            AI context analysis is available on request.
          </div>
          <div className="flex items-center gap-2">
            {runError && <span className="text-xs text-red-600">{runError}</span>}
            <button
              onClick={handleRunLLM}
              disabled={running}
              className="text-xs font-semibold text-white bg-[#06B6D4] px-3 py-1.5 rounded-xl hover:bg-cyan-600 disabled:opacity-50 transition-all"
            >
              {running ? "Running…" : "🤖 Run AI context analysis"}
            </button>
          </div>
        </div>
      )}

      {/* Audit footer once LLM has run */}
      {llmRan && analysis?.llm_requested_by && analysis?.llm_requested_at && (
        <div className="px-4 py-1.5 border-t border-slate-100 bg-slate-50/60 text-[10px] text-slate-400">
          AI analysis requested by {analysis.llm_requested_by} ·{" "}
          {new Date(analysis.llm_requested_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </div>
      )}

      {/* Expanded — full event list with trigger highlighted */}
      {open && (
        <div className="border-t border-slate-100 divide-y divide-slate-50">
          {session.events.map((event: any, idx: number) => {
            const isTrigger = event === session.trigger_event;
            const riskColor = event.risk === "critical" ? "#7C3AED"
                            : event.risk === "high"     ? "#DC2626"
                            : event.risk === "medium"   ? "#F59E0B"
                            :                              "#10B981";
            return (
              <div key={idx} className={`flex gap-3 p-3 ${isTrigger ? "bg-red-50/60" : "bg-white"}`}>
                <div className="shrink-0 w-14 text-right">
                  <div className="text-[10px] text-slate-400">
                    {new Date(event.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div className="text-[10px] font-bold mt-0.5" style={{ color: riskColor }}>{event.risk?.toUpperCase()}</div>
                  {isTrigger && <div className="text-[9px] font-bold text-red-600 mt-0.5">TRIGGER</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 leading-snug">{event.prompt}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {event.matched?.map((m: string, i: number) => (
                      <span key={`${m}-${i}`} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">{m}</span>
                    ))}
                    {event.blocked && <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">Blocked</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {analysis?.reasoning && (
            <div className="p-3 bg-slate-50 text-xs text-slate-500">
              <span className="font-semibold text-slate-600">Analyst note: </span>
              <span className="italic">{analysis.reasoning}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Session group (collapsible, one per Aegis risk level) ────────────────────
function SessionGroup({
  level,
  sessions,
  analysesById,
  onRequestLLM,
  defaultOpen,
}: {
  level:        SessionRiskLevel;
  sessions:     ConversationSession<any>[];
  analysesById: Map<string, SessionAnalysis>;
  onRequestLLM: (s: ConversationSession<any>) => Promise<void>;
  defaultOpen:  boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (sessions.length === 0) return null;
  const cfg = RISK_GROUP_STYLE[level];

  return (
    <div className="rounded-xl border border-slate-100 overflow-hidden bg-white">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={`text-[11px] font-bold tracking-wide px-2.5 py-1 rounded-full ${cfg.badge}`}>
            {cfg.label}
          </span>
          <span className="text-sm text-slate-500">{sessions.length} session{sessions.length !== 1 ? "s" : ""}</span>
        </div>
        <span className="text-slate-400 text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {sessions.map(s => (
            <SessionCard
              key={s.session_id}
              session={s}
              analysis={analysesById.get(s.session_id)}
              onRequestLLM={onRequestLLM}
              hideRunAI={level === "low"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Student detail ────────────────────────────────────────────────────────────
function StudentDetail({
  pulse,
  events,
  analyses,
  onAcknowledge,
  onRequestLLM,
}: {
  pulse:         StudentPulseV3;
  events:        any[];
  analyses:      SessionAnalysis[];
  onAcknowledge: (action: AcknowledgeAction, notes: string) => Promise<void>;
  onRequestLLM:  (session: ConversationSession<any>) => Promise<void>;
}) {
  const alert = ALERT[pulse.alert_level];
  const trend = TREND_DIR[pulse.trend_direction];

  const studentEvents = useMemo(() =>
    events.filter((e: any) => e.student_id === pulse.student_id)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [events, pulse.student_id]
  );

  const chartData = useMemo(() =>
    Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const dayEnd   = dayStart + 86400000;
      const day = studentEvents.filter((e: any) => {
        const t = new Date(e.created_at).getTime();
        return t >= dayStart && t < dayEnd;
      });
      return {
        date:     d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        critical: day.filter((e: any) => e.risk === "critical").length,
        high:     day.filter((e: any) => e.risk === "high").length,
        medium:   day.filter((e: any) => e.risk === "medium").length,
        low:      day.filter((e: any) => e.risk === "low").length,
      };
    }),
    [studentEvents]
  );

  // Vertical reference line at the last acknowledgement date — only renders
  // if the ack falls within the visible 14-day window.
  const lastAckLabel = useMemo(() => {
    if (!pulse.last_acknowledged) return null;
    const label = dateShort(pulse.last_acknowledged.acknowledged_at);
    return chartData.some(d => d.date === label) ? label : null;
  }, [pulse.last_acknowledged, chartData]);

  const hasRisk = useMemo(() => ({
    critical: studentEvents.some((e: any) => e.risk === "critical"),
    high:     studentEvents.some((e: any) => e.risk === "high"),
    medium:   studentEvents.some((e: any) => e.risk === "medium"),
    low:      studentEvents.some((e: any) => e.risk === "low"),
  }), [studentEvents]);

  // Sessions for the timeline view. Sort prioritises sessions a member of
  // staff should look at first: requires_review > high context_risk > recency.
  const sessions = useMemo(() => {
    const merged = mergeAnalyses(groupSessions(studentEvents), analyses);
    const riskOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
    return [...merged].sort((a, b) => {
      if (a.requires_review !== b.requires_review) return a.requires_review ? -1 : 1;
      const ra = riskOrder[a.context_risk] ?? 0;
      const rb = riskOrder[b.context_risk] ?? 0;
      if (ra !== rb) return rb - ra;
      return new Date(b.ended_at).getTime() - new Date(a.ended_at).getTime();
    });
  }, [studentEvents, analyses]);

  // For O(1) lookup in SessionCard.
  const analysesById = useMemo(
    () => new Map(analyses.map(a => [a.session_id, a])),
    [analyses],
  );

  // Group by Aegis-category (highest risk across the session's events).
  const groupedSessions = useMemo(() => {
    const groups: Record<SessionRiskLevel, ConversationSession<any>[]> = { high: [], medium: [], low: [] };
    for (const s of sessions) groups[sessionRiskLevel(s)].push(s);
    return groups;
  }, [sessions]);

  return (
    <div className="flex flex-col h-full overflow-auto">

      {/* ── Header strip ── */}
      <div className="px-6 py-5 border-b border-slate-100 shrink-0" style={{ background: alert.light }}>
        {/* Row 1 — identity (left) + inline pulse score block (right) */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h2 className="text-xl font-bold text-slate-800 break-all">{pulse.student_id}</h2>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${alert.bg} ${alert.text}`}>
              {alert.label}
            </span>
            {pulse.rapid_escalation && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-600 text-white animate-pulse">
                ⚡ Rapid Escalation
              </span>
            )}
            {pulse.re_emergence && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500 text-white">
                ↩ Re-emergence
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-2 shrink-0">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pulse</span>
            <span className="text-3xl font-bold leading-none" style={{ color: alert.bar }}>{pulse.pulse_score}</span>
            <span className={`text-xs font-semibold ${trend.color}`}>
              {trend.icon} {pulse.trend_direction}
            </span>
            {pulse.vs_school_avg !== undefined && pulse.vs_school_avg !== 0 && (
              <span className={`text-xs ${pulse.vs_school_avg > 0 ? "text-red-400" : "text-emerald-400"}`}>
                {pulse.vs_school_avg > 0 ? "+" : ""}{pulse.vs_school_avg} vs avg
              </span>
            )}
            {pulse.context_boost !== 0 && (
              <span className="text-[10px] text-slate-400">
                ctx {pulse.context_boost > 0 ? "+" : ""}{pulse.context_boost}
              </span>
            )}
          </div>
        </div>

        {/* Row 2 — meta strip */}
        <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap mt-1.5">
          <span>{pulse.total_events} events</span>
          <span className="text-slate-300">·</span>
          <span>First {new Date(pulse.first_seen).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
          <span className="text-slate-300">·</span>
          <span>Last {new Date(pulse.last_seen).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
        </div>

        {/* Row 3 — categories + primary concern on the same line */}
        {(pulse.categories.length > 0 || pulse.dominant_signal) && (
          <div className="flex items-center gap-x-3 gap-y-2 flex-wrap mt-3">
            {pulse.categories.map(cat => (
              <div key={cat.name} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-white text-[11px] font-bold"
                style={{ background: CAT_COLOR[cat.name] || "#64748b" }}>
                {cat.name}
                <span className="bg-white/20 px-1.5 rounded-full">{cat.count}</span>
              </div>
            ))}
            {pulse.dominant_signal && (
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-0.5 h-4 rounded-full shrink-0" style={{ background: alert.bar }} />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">Primary</span>
                <span className="text-xs font-bold text-slate-700 truncate">{pulse.dominant_signal.label}</span>
                <span className="text-xs text-slate-500 truncate">— {pulse.dominant_signal.detail}</span>
              </div>
            )}
          </div>
        )}

        {/* Re-emergence banner */}
        {pulse.re_emergence && pulse.last_acknowledged?.dominant_category && (
          <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <span className="text-amber-600 font-bold">↩</span>
            <div className="text-xs text-amber-800">
              <span className="font-bold">Pattern returned</span> — “{pulse.last_acknowledged.dominant_category}”
              has resurfaced since acknowledgement on {dateShort(pulse.last_acknowledged.acknowledged_at)}.
            </div>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 p-6 space-y-6 overflow-auto">

        {/* Acknowledgement panel */}
        <AcknowledgementPanel pulse={pulse} onSubmit={onAcknowledge} />

        {/* Timeline + signals side by side */}
        <div className="grid grid-cols-[1fr_1fr] gap-5">

          {/* 14-day timeline */}
          <div className="bg-slate-50 rounded-2xl p-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">
              14-Day Timeline · {SHAPE_ICON[pulse.trend_shape]} {pulse.trend_shape.replace("_", " ")}
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} interval={6} />
                <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0", padding: "6px 10px" }}
                  labelStyle={{ fontWeight: 700, marginBottom: 4, color: "#334155" }}
                  itemStyle={{ padding: "1px 0" }}
                />
                {lastAckLabel && (
                  <ReferenceLine
                    x={lastAckLabel}
                    stroke="#94a3b8"
                    strokeDasharray="3 3"
                    label={{ value: "ack", position: "top", fontSize: 9, fill: "#94a3b8" }}
                  />
                )}
                {hasRisk.critical && <Line type="monotone" dataKey="critical" stroke="#6366F1" strokeWidth={2} dot={false} name="Critical" />}
                {hasRisk.high     && <Line type="monotone" dataKey="high"     stroke="#EF4444" strokeWidth={2} dot={false} name="High"     />}
                {hasRisk.medium   && <Line type="monotone" dataKey="medium"   stroke="#EAB308" strokeWidth={2} dot={false} name="Medium"   />}
                {hasRisk.low      && <Line type="monotone" dataKey="low"      stroke="#22C55E" strokeWidth={2} dot={false} name="Low"      />}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Signal bars — compact */}
          <div className="bg-slate-50 rounded-2xl p-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Signal Breakdown</div>
            <div className="space-y-2.5">
              {pulse.signals.map(sig => {
                const c = sig.score >= 70 ? "#DC2626" : sig.score >= 40 ? "#F59E0B" : "#10B981";
                return (
                  <div key={sig.id} className="flex items-center gap-2">
                    <div className="w-28 text-xs text-slate-500 truncate shrink-0">{sig.label}</div>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${sig.score}%`, background: c }} />
                    </div>
                    <div className="text-xs font-bold w-6 text-right shrink-0" style={{ color: c }}>{sig.score}</div>
                  </div>
                );
              })}
            </div>
            {pulse.fingerprint.event_count > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-200 text-[10px] text-slate-400">
                Baseline {pulse.fingerprint.baseline_score} · {pulse.fingerprint.pattern}
                {pulse.fingerprint.dominant_categories.length > 0 && (
                  <span> · {pulse.fingerprint.dominant_categories.join(", ")}</span>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Session timeline */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Session Timeline · {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            </div>
            <button
              onClick={() => window.open(`/reports/student?student=${encodeURIComponent(pulse.student_id)}`, "_blank")}
              className="text-xs font-semibold text-[#06B6D4] border border-[#06B6D4] px-3 py-1.5 rounded-xl hover:bg-cyan-50 transition-all"
            >
              ⬇ PDF Report
            </button>
          </div>
          <div className="space-y-3">
            <SessionGroup level="high"   sessions={groupedSessions.high}   analysesById={analysesById} onRequestLLM={onRequestLLM} defaultOpen={true} />
            <SessionGroup level="medium" sessions={groupedSessions.medium} analysesById={analysesById} onRequestLLM={onRequestLLM} defaultOpen={true} />
            <SessionGroup level="low"    sessions={groupedSessions.low}    analysesById={analysesById} onRequestLLM={onRequestLLM} defaultOpen={false} />
            {sessions.length === 0 && (
              <div className="text-sm text-slate-400 text-center py-6">No sessions found</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Student list item ─────────────────────────────────────────────────────────
function StudentListItem({ pulse, isActive, onClick }: { pulse: StudentPulseV3; isActive: boolean; onClick: () => void }) {
  const alert = ALERT[pulse.alert_level];

  return (
    <button onClick={onClick}
      className={`w-full text-left px-4 py-2.5 border-b border-slate-50 transition-colors flex items-center gap-2 ${
        isActive ? "bg-cyan-50 border-l-2 border-l-[#06B6D4]" : "hover:bg-slate-50"
      }`}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: alert.bar }} />
      <div className="flex items-center gap-1 min-w-0 flex-1">
        {pulse.rapid_escalation && <span className="text-xs shrink-0" title="Rapid escalation">⚡</span>}
        {pulse.re_emergence     && <span className="text-xs shrink-0 text-amber-600" title="Re-emergence">↩</span>}
        <span className="font-medium text-slate-700 text-sm truncate">{pulse.student_id}</span>
      </div>
      <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${alert.bg} ${alert.text}`}>
        {pulse.pulse_score}
      </span>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function PulseBetaPageContent() {
  const { loading: authLoading, authenticated } = useAuth();
  const searchParams = useSearchParams();
  const studentParam = searchParams.get("student");
  const [events, setEvents]     = useState<any[]>([]);
  const [acks, setAcks]         = useState<PulseAcknowledgement[]>([]);
  const [acksVersion, setAcksVersion] = useState(0);
  const [analyses, setAnalyses] = useState<SessionAnalysis[]>([]);
  const [analysesVersion, setAnalysesVersion] = useState(0);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState<StudentPulseV3 | null>(null);
  const [search, setSearch]     = useState("");
  const [openTiers, setOpenTiers] = useState<Record<string, boolean>>({ critical: true, high: false, medium: false, low: false });

  useEffect(() => {
    fetchAllEvents({ ascending: true })
      .then(data => { setEvents(data); setLoading(false); });
  }, []);

  useEffect(() => {
    fetchAcknowledgements(SCHOOL_ID).then(setAcks);
  }, [acksVersion]);

  useEffect(() => {
    fetchSessionAnalyses(SCHOOL_ID).then(setAnalyses);
  }, [analysesVersion]);

  // Step 4: when events arrive, kick off LLM analysis for any triggered,
  // settled session that's still unanalysed. Capped per load. Sequential —
  // these are paid calls, no need to hammer. Runs once per mount.
  const analysisFiredRef = useRef(false);
  useEffect(() => {
    if (analysisFiredRef.current) return;
    if (!events.length) return;
    analysisFiredRef.current = true;

    const analysedIds = new Set(analyses.map(a => a.session_id));
    // Score every triggered+settled session regardless of age. The signal
    // itself only considers near-term sessions, but historical scoring is
    // cheap (rule-based + insert) and stops UI "Pending analysis" badges
    // from sitting forever on old triggered sessions.
    const candidates = groupSessions(events)
      .filter(s => s.has_trigger
                && isSettled(s)
                && !analysedIds.has(s.session_id))
      .slice(0, ANALYSIS_BUDGET_PER_LOAD);

    if (!candidates.length) return;

    const slimEvent = (e: any) => ({
      created_at: e.created_at,
      prompt:     e.prompt,
      risk:       e.risk,
      blocked:    e.blocked,
      matched:    e.matched,
    });

    const scoreOne = async (s: typeof candidates[number]) => {
      try {
        const res = await fetch("/api/session-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id:          s.session_id,
            school_id:           SCHOOL_ID,
            student_id:          s.student_id,
            platform:            s.platform,
            started_at:          s.started_at,
            ended_at:            s.ended_at,
            events:              s.events.map(slimEvent),
            post_trigger_events: s.context_window_events.map(slimEvent),
          }),
        });
        return res.ok;
      } catch {
        return false;
      }
    };

    (async () => {
      let analysedAny = false;
      // Limited concurrency: fire ANALYSIS_CONCURRENCY in parallel, wait for
      // them, then the next batch. Avoids hammering Supabase but is ~10x
      // faster than sequential.
      for (let i = 0; i < candidates.length; i += ANALYSIS_CONCURRENCY) {
        const batch  = candidates.slice(i, i + ANALYSIS_CONCURRENCY);
        const oks    = await Promise.all(batch.map(scoreOne));
        if (oks.some(Boolean)) analysedAny = true;
      }
      if (analysedAny) setAnalysesVersion(v => v + 1);
    })();
  }, [events, analyses]);

  const pulses = useMemo(
    () => calculateAllPulsesV3(events, acks, analyses),
    [events, acks, analyses],
  );

  // Keep selection synced when pulses recompute (so re-emergence shows live after ack)
  useEffect(() => {
    if (!pulses.length) return;
    if (!selected) {
      const target = studentParam ? pulses.find(p => p.student_id === studentParam) : null;
      setSelected(target ?? pulses[0]);
      return;
    }
    const refreshed = pulses.find(p => p.student_id === selected.student_id);
    if (refreshed && refreshed !== selected) setSelected(refreshed);
  }, [pulses, selected, studentParam]);

  const filtered = useMemo(() =>
    pulses.filter(p => !search || p.student_id.toLowerCase().includes(search.toLowerCase())),
    [pulses, search]
  );

  const schoolAvg  = useMemo(() =>
    pulses.length ? Math.round(pulses.reduce((s, p) => s + p.pulse_score, 0) / pulses.length) : 0, [pulses]);
  const rapidCount = pulses.filter(p => p.rapid_escalation).length;
  const reEmergeCount = pulses.filter(p => p.re_emergence).length;

  const TIERS = [
    { key: "critical" as const, label: "Critical" },
    { key: "high"     as const, label: "High"     },
    { key: "medium"   as const, label: "Medium"   },
    { key: "low"      as const, label: "Low"      },
  ];

  const requestLLMForSession = useCallback(async (s: ConversationSession<any>) => {
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const email = authSession?.user?.email ?? "unknown";
    const slim = (e: any) => ({
      created_at: e.created_at,
      prompt:     e.prompt,
      risk:       e.risk,
      blocked:    e.blocked,
      matched:    e.matched,
    });
    const res = await fetch("/api/session-analysis/run-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id:   s.session_id,
        requested_by: email,
        events:       s.events.map(slim),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `Request failed (${res.status})`);
    }
    setAnalysesVersion(v => v + 1);
  }, []);

  const acknowledgeSelected = useCallback(async (action: AcknowledgeAction, notes: string) => {
    if (!selected) return;
    const dominantCategory = selected.categories[0]?.name ?? null;
    const ok = await insertAcknowledgement({
      student_id:        selected.student_id,
      alert_level:       selected.alert_level,
      dominant_category: dominantCategory,
      action_taken:      action,
      notes,
    });
    if (ok) setAcksVersion(v => v + 1);
  }, [selected]);

  if (authLoading || !authenticated) return null;

  return (
    <div className="flex min-h-screen bg-[#F0F2F8]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">

        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Image src="/pulse_icon.png" alt="Pulse" width={28} height={28} className="object-contain" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[#06B6D4]">Beacon Pulse</h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Beta v3</span>
                {rapidCount > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600 text-white animate-pulse">
                    ⚡ {rapidCount} Rapid
                  </span>
                )}
                {reEmergeCount > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white">
                    ↩ {reEmergeCount} Re-emerged
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">School avg: {schoolAvg} · {pulses.length} students · {acks.length} acks</p>
            </div>
          </div>
          <Link href="/pulse"
            className="text-xs font-semibold text-slate-500 border border-slate-200 px-3 py-1.5 rounded-xl hover:border-[#06B6D4] hover:text-[#06B6D4] transition-all">
            ← Release Version
          </Link>
        </header>

        {/* Search bar */}
        <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center shrink-0">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search students..."
            className="w-full border border-slate-200 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20" />
        </div>

        {/* Split view */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left list — grouped by tier */}
          <div className="w-56 shrink-0 bg-white border-r border-slate-200 overflow-auto">
            {loading && <div className="text-center py-8 text-slate-400 text-xs">Loading...</div>}
            {!loading && TIERS.map(tier => {
              const group = filtered.filter(p => p.alert_level === tier.key);
              if (group.length === 0) return null;
              const open = !!openTiers[tier.key];
              return (
                <div key={tier.key}>
                  <button
                    onClick={() => setOpenTiers(prev => ({ ...prev, [tier.key]: !prev[tier.key] }))}
                    className="sticky top-0 z-10 w-full bg-slate-50 border-b border-slate-100 px-4 py-1.5 flex items-center gap-1.5 hover:bg-slate-100 transition-colors"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ALERT[tier.key].bar }} />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{tier.label}</span>
                    <span className="ml-auto text-[10px] font-bold text-slate-400 mr-1">{group.length}</span>
                    <svg className="shrink-0 transition-transform duration-200" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
                      width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 3.5l3 3 3-3" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {open && group.map(pulse => (
                    <StudentListItem
                      key={pulse.student_id}
                      pulse={pulse}
                      isActive={selected?.student_id === pulse.student_id}
                      onClick={() => setSelected(pulse)}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {/* Right detail */}
          <div className="flex-1 bg-white overflow-auto">
            {selected
              ? <StudentDetail pulse={selected} events={events} analyses={analyses} onAcknowledge={acknowledgeSelected} onRequestLLM={requestLLMForSession} />
              : <div className="flex items-center justify-center h-full text-slate-400 text-sm">Select a student</div>
            }
          </div>

        </div>
      </div>
    </div>
  );
}

export default function PulseBetaPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F0F2F8] flex items-center justify-center text-slate-400 text-sm">Loading...</div>}>
      <PulseBetaPageContent />
    </Suspense>
  );
}
