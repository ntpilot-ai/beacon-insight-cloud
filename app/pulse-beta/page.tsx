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
  type TermContext,
  type PulseTermSnapshot,
  type SchoolTerm,
} from "@/lib/pulse_engine_v3";
import { fetchTermContext } from "@/lib/terms";
import {
  deriveStudentStatus,
  STATUS_STYLE as STUDENT_STATUS_STYLE,
  type StudentStatus as StudentStatusValue,
} from "@/lib/student_status";
import {
  groupSessions,
  mergeAnalyses,
  isSettled,
  type SessionAnalysis,
  type ConversationSession,
} from "@/lib/sessions";
import {
  SNOOZE_DURATIONS,
  expiresAtFor,
  activeSnoozeFor,
  snoozeLabel,
  type PulseSnooze,
  type SnoozeDuration,
} from "@/lib/snooze";
import { buildWeeklySummary, type WeeklySummary } from "@/lib/weekly_summary";
import { FEEDBACK_REASONS, type FeedbackReason, type PulseFeedback } from "@/lib/feedback";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";


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

// ── Triage queue (Phase 3) ────────────────────────────────────────────────────

type TriageLevel = "silent_monitoring" | "low" | "medium" | "high" | "urgent";

interface TriageResultRow {
  id:                 string;
  school_id:          string;
  student_id:         string;
  assessed_at:        string;
  triage:             TriageLevel;
  concern_summary:    string | null;
  suggested_action:   string | null;
  notify_immediately: boolean;
  reasoning:          string | null;
  requested_by:       string | null;
  reviewed_at?:       string | null;
  reviewed_by?:       string | null;
}

// ── Cluster types (Brief 6) ───────────────────────────────────────────────────

interface ClusterTriageRow {
  id:                 string;
  triage:             string;
  concern_summary:    string;
  suggested_action:   string;
  notify_immediately: boolean;
  reasoning?:         string | null;
  triaged_at:         string;
}

interface ClusterRow {
  id:                  string;
  school_id:           string;
  cluster_key:         string;
  detected_at:         string;
  cluster_type:        "category_spike" | "coordinated_jailbreak" | "keyword_co-occurrence" | "sentiment_wave";
  student_ids:         string[];
  student_count:       number;
  category:            string;
  time_window_hours:   number;
  group_context?:      string | null;
  severity:            "notable" | "significant" | "critical";
  summary:             string;
  individual_pulses:   string[];
  requires_review:     boolean;
  dismissed_at?:       string | null;
  dismissed_by?:       string | null;
  acknowledged_at?:    string | null;
  acknowledged_by?:    string | null;
  acknowledged_note?:  string | null;
  cluster_triage_results?: ClusterTriageRow[];
}

async function fetchTodayClusters(schoolId: string): Promise<ClusterRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(`/api/clusters?school_id=${encodeURIComponent(schoolId)}&date=${today}`);
  if (!res.ok) return [];
  const json = await res.json();
  return (json.clusters ?? []) as ClusterRow[];
}

async function fetchSnoozes(schoolId: string): Promise<PulseSnooze[]> {
  // Fetch any rows touched recently: still-active snoozes for queue gating,
  // plus rows broken in the last 24h so the re-entry badge can render.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("pulse_snooze")
    .select("id,school_id,student_id,snoozed_by,snoozed_at,expires_at,duration_label,reason,broken_early,broken_at,broken_reason,snooze_time_score,snooze_time_alert_level")
    .eq("school_id", schoolId)
    .or(`broken_early.eq.false,broken_at.gte.${since}`)
    .order("snoozed_at", { ascending: false });
  if (error || !data) return [];
  return data as PulseSnooze[];
}

async function insertSnooze(payload: {
  student_id:              string;
  duration:                SnoozeDuration;
  reason:                  string;
  snooze_time_score?:      number;
  snooze_time_alert_level?: string;
}): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  const email = session?.user?.email ?? "unknown";
  const { error } = await supabase.from("pulse_snooze").insert({
    school_id:               SCHOOL_ID,
    student_id:              payload.student_id,
    snoozed_by:              email,
    expires_at:              expiresAtFor(payload.duration),
    duration_label:          payload.duration,
    reason:                  payload.reason || null,
    snooze_time_score:       payload.snooze_time_score ?? null,
    snooze_time_alert_level: payload.snooze_time_alert_level ?? null,
  });
  return !error;
}

async function breakSnoozeRow(snoozeId: string, reason: string): Promise<boolean> {
  const { error } = await supabase.from("pulse_snooze").update({
    broken_early:  true,
    broken_at:     new Date().toISOString(),
    broken_reason: reason,
  }).eq("id", snoozeId);
  return !error;
}

async function fetchTodaysTriage(schoolId: string): Promise<TriageResultRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("beacon_triage_results")
    .select("id,school_id,student_id,assessed_at,triage,concern_summary,suggested_action,notify_immediately,reasoning,requested_by,reviewed_at,reviewed_by")
    .eq("school_id", schoolId)
    .gte("assessed_at", `${today}T00:00:00Z`)
    .lte("assessed_at", `${today}T23:59:59.999Z`)
    .order("assessed_at", { ascending: false });
  if (error || !data) return [];
  return data as TriageResultRow[];
}

async function fetchRecentTriage(schoolId: string, days: number): Promise<TriageResultRow[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from("beacon_triage_results")
    .select("id,school_id,student_id,assessed_at,triage,concern_summary,suggested_action,notify_immediately,reasoning,requested_by")
    .eq("school_id", schoolId)
    .gte("assessed_at", since)
    .order("assessed_at", { ascending: false });
  if (error || !data) return [];
  return data as TriageResultRow[];
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

        {/* The triggering prompt — what the student actually typed. ALWAYS
            visible: it's the underlying evidence. The AI's concern summary
            (when present) renders as a supplementary line BELOW the prompt,
            not as a replacement — staff need to see the raw text first and
            judge the AI interpretation against it, not the other way round. */}
        {(session.trigger_event ?? session.events[0]) && (
          <p className="text-sm text-slate-700 leading-snug line-clamp-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1.5 align-middle">Prompt</span>
            <span>“{(session.trigger_event ?? session.events[0]).prompt.slice(0, 180)}”</span>
          </p>
        )}

        {/* AI verdict (when the LLM context analysis has run) — labelled so
            staff can tell at a glance that this is interpretation, not the
            raw prompt. */}
        {analysis?.concern_summary && (
          <p className="text-xs text-slate-500 italic leading-snug line-clamp-2 mt-1.5">
            <span className="text-[10px] font-bold text-cyan-700 uppercase tracking-wider mr-1.5 align-middle not-italic">AI verdict</span>
            {analysis.concern_summary}
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

// ── Cluster: "Why this group" panel ──────────────────────────────────────────
// Answers the question a DSL has when opening a cluster: "Why are these
// specific students on the same panel?" — explicitly, before the LLM
// assessment. Two halves:
//   1. Type-aware narrative paragraph that translates the cluster_type +
//      category + window into plain-English meaning ("five students used
//      similar jailbreak prompts within 6h — likely shared template").
//   2. Shared-elements bullets — the concrete data points the grouping is
//      based on (category, platforms, time window, optional group_context,
//      common matched keywords). Each is a different follow-up handle for
//      the DSL.
// Data sources: cluster row directly + on-the-fly aggregation across the
// cluster members' events (passed in).

const CLUSTER_TYPE_NARRATIVE: Record<
  ClusterRow["cluster_type"],
  (cluster: ClusterRow) => string
> = {
  category_spike: (c) =>
    `${c.student_count} students all triggered ${c.category} concerns within a ${Math.round(c.time_window_hours)}-hour window. ` +
    `That's a concentration spike — multiple students hitting the same safeguarding category simultaneously, ` +
    `which is unusual against the school's normal baseline. Worth checking for an in-school trigger (an event, ` +
    `a viral piece of content, a shared conversation).`,
  coordinated_jailbreak: (c) =>
    `${c.student_count} students used near-identical jailbreak prompts within a ${Math.round(c.time_window_hours)}-hour window. ` +
    `Pattern suggests a shared prompt template moving through a peer group — possibly via Snapchat, Discord, or in person. ` +
    `Tracking the source matters as much as addressing the individual attempts.`,
  "keyword_co-occurrence": (c) =>
    `${c.student_count} students mentioned the same keyword(s) within a ${Math.round(c.time_window_hours)}-hour window. ` +
    `Co-occurrence on a specific term often indicates a shared external trigger — a person, event, video, or piece of content ` +
    `the group has all been exposed to. Identifying what's being referenced is the first step.`,
  sentiment_wave: (c) =>
    `${c.student_count} students show simultaneous emotional downturn across the cluster window. ` +
    `A correlated drop across a peer group can indicate a shared distressing event — class-wide news, a friend's situation, ` +
    `or social-group dynamics. Worth checking pastoral logs and any class-level changes.`,
};

function ClusterWhyPanel({ cluster, events }: { cluster: ClusterRow; events: any[] }) {
  const narrative = (CLUSTER_TYPE_NARRATIVE[cluster.cluster_type] ?? (() => cluster.summary))(cluster);

  // Aggregate across the cluster members' events (within the cluster's time
  // window — approximated by the cluster's own detected_at as the end and
  // time_window_hours backwards). This gives us the platforms and matched
  // keywords actually used by these students during the grouping event.
  const sharedFacts = useMemo(() => {
    const memberIds = new Set(cluster.student_ids);
    const windowEndMs   = new Date(cluster.detected_at).getTime();
    const windowStartMs = windowEndMs - cluster.time_window_hours * 60 * 60 * 1000;

    const clusterEvents = events.filter(e => {
      if (!memberIds.has(e.student_id)) return false;
      const t = new Date(e.created_at).getTime();
      return t >= windowStartMs && t <= windowEndMs;
    });

    // Platforms — which platforms appeared, with student counts per platform.
    const platformStudents: Record<string, Set<string>> = {};
    for (const e of clusterEvents) {
      const p = e.platform ?? "other";
      if (!platformStudents[p]) platformStudents[p] = new Set();
      platformStudents[p].add(e.student_id);
    }
    const platforms = Object.entries(platformStudents)
      .map(([p, set]) => ({ label: PLATFORM_LABELS[p] ?? p, students: set.size }))
      .sort((a, b) => b.students - a.students);

    // Matched keywords — frequency across the cluster's events.
    const keywordCounts: Record<string, number> = {};
    for (const e of clusterEvents) {
      for (const k of (e.matched ?? [])) {
        keywordCounts[k] = (keywordCounts[k] ?? 0) + 1;
      }
    }
    const topKeywords = Object.entries(keywordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, n]) => ({ keyword: k, count: n }));

    // Friendly window label
    const startDate = new Date(windowStartMs);
    const endDate   = new Date(windowEndMs);
    const sameDay   = startDate.toDateString() === endDate.toDateString();
    const windowLabel = sameDay
      ? `${startDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${startDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} → ${endDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
      : `${startDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } as any)} → ${endDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } as any)}`;

    return {
      platforms,
      topKeywords,
      windowLabel,
      eventCount: clusterEvents.length,
    };
  }, [cluster, events]);

  return (
    <div>
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Why this group</h3>
      <p className="text-sm text-slate-700 leading-snug mb-3">{narrative}</p>
      <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-1.5">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Shared across the group</p>
        <FactRow label="Category">{cluster.category}</FactRow>
        {sharedFacts.platforms.length > 0 && (
          <FactRow label="Platforms">
            {sharedFacts.platforms.map((p, i) => (
              <span key={p.label}>
                {p.label} <span className="text-slate-400">({p.students} student{p.students !== 1 ? "s" : ""})</span>
                {i < sharedFacts.platforms.length - 1 ? "  ·  " : ""}
              </span>
            ))}
          </FactRow>
        )}
        <FactRow label="Window">{sharedFacts.windowLabel}</FactRow>
        {cluster.group_context && (
          <FactRow label="Context">{cluster.group_context}</FactRow>
        )}
        {sharedFacts.topKeywords.length > 0 && (
          <FactRow label="Top keywords">
            {sharedFacts.topKeywords.map((k, i) => (
              <span key={k.keyword}>
                <span className="font-mono text-slate-700">{k.keyword}</span>{" "}
                <span className="text-slate-400">×{k.count}</span>
                {i < sharedFacts.topKeywords.length - 1 ? "  ·  " : ""}
              </span>
            ))}
          </FactRow>
        )}
        <FactRow label="Events in window">
          {sharedFacts.eventCount} total across {cluster.student_count} students
        </FactRow>
      </div>
    </div>
  );
}

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-32 shrink-0 mt-0.5">{label}</span>
      <span className="text-slate-700 flex-1">{children}</span>
    </div>
  );
}

// ── Cluster: per-member 14-day sparklines ────────────────────────────────────
// Replaces the misleading single-line "sentiment arcs" with stacked-bar
// sparklines (14 daily bars per student). Each bar's height = total events
// that day; segments stacked by risk colour. Reads at a glance: acute today
// vs. chronic across the window vs. quiet.

function ClusterMemberSparklines({ studentIds, events }: { studentIds: string[]; events: any[] }) {
  // 14-day buckets per student. We compute outside the map so the day axis
  // is shared across all sparklines (same days line up visually side by side).
  const today = new Date();
  const days  = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    d.setDate(d.getDate() - (13 - i));
    return { start: d.getTime(), end: d.getTime() + 86400000 };
  });

  const perStudent = studentIds.map(sid => {
    const studentEvents = events.filter(e => e.student_id === sid);
    const buckets = days.map(d => {
      const inDay = studentEvents.filter(e => {
        const t = new Date(e.created_at).getTime();
        return t >= d.start && t < d.end;
      });
      return {
        high:   inDay.filter(e => e.risk === "high" || e.risk === "critical").length,
        medium: inDay.filter(e => e.risk === "medium").length,
        low:    inDay.filter(e => e.risk === "low").length,
      };
    });
    const totalsByDay = buckets.map(b => b.high + b.medium + b.low);
    const dayMax     = Math.max(1, ...totalsByDay);
    const totalEvents = totalsByDay.reduce((s, n) => s + n, 0);
    const totalHigh   = buckets.reduce((s, b) => s + b.high, 0);
    return { sid, buckets, dayMax, totalEvents, totalHigh };
  });

  // Global max so bar heights are comparable across students (a 1-event day
  // for Student A and a 5-event day for Student B don't both render full-
  // height). If any student has activity, scale to the highest bar across
  // the cluster.
  const globalDayMax = Math.max(1, ...perStudent.map(s => s.dayMax));

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Individual activity (last 14 days)</h3>
        <span className="text-[10px] text-slate-400">heights comparable across students</span>
      </div>
      <div className="space-y-2.5">
        {perStudent.map(({ sid, buckets, totalEvents, totalHigh }) => (
          <div key={sid} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-700">{sid}</span>
              <span className="text-[10px] text-slate-400">
                {totalEvents} event{totalEvents !== 1 ? "s" : ""}
                {totalHigh > 0 ? ` · ${totalHigh} high` : ""}
              </span>
            </div>
            <div className="flex items-end gap-[2px] h-10">
              {buckets.map((b, i) => {
                const total = b.high + b.medium + b.low;
                const heightPct = total === 0 ? 0 : (total / globalDayMax) * 100;
                const date = new Date(days[i].start);
                const title = total === 0
                  ? `${date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}: no events`
                  : `${date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}: ${total} events (${b.high} high, ${b.medium} med, ${b.low} low)`;
                return (
                  <div
                    key={i}
                    className="flex-1 flex flex-col-reverse rounded-sm overflow-hidden bg-slate-200/60"
                    style={{ height: "100%" }}
                    title={title}
                  >
                    {total > 0 && (
                      <div className="w-full flex flex-col-reverse" style={{ height: `${Math.max(heightPct, 6)}%` }}>
                        {b.low    > 0 && <div style={{ flex: b.low    }} className="bg-emerald-500" />}
                        {b.medium > 0 && <div style={{ flex: b.medium }} className="bg-amber-500"   />}
                        {b.high   > 0 && <div style={{ flex: b.high   }} className="bg-red-500"     />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-1 text-[9px] text-slate-400">
              <span>{new Date(days[0].start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              <span>today</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Platform Activity panel ──────────────────────────────────────────────────
// Replaces the engine Signal Breakdown panel with a DSL-readable view of
// where this student is doing their AI activity. One row per supported
// platform; bar width is proportional to total event count (vs. the
// student's highest-volume platform); segments are stacked by risk colour
// within the bar.
//
// Reading the bars tells two safeguarding stories the rest of the panel
// doesn't:
//   - Cross-platform spread (Tyler-shape) = deliberate exploration,
//     bypassing platform-specific guardrails
//   - Single-platform fixation (Sophie-shape) = parasocial dependency,
//     using one AI as the confidant
// Platforms with zero events still render (greyed) so absence is visible.

const PLATFORM_LABELS: Record<string, string> = {
  "chatgpt.com":           "ChatGPT",
  "claude.ai":             "Claude",
  "gemini.google.com":     "Gemini",
  "copilot.microsoft.com": "Copilot",
};
const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_LABELS);

function PlatformActivityPanel({ events }: { events: any[] }) {
  const stats = useMemo(() => {
    const byPlatform: Record<string, { high: number; medium: number; low: number; total: number }> = {};
    for (const p of SUPPORTED_PLATFORMS) byPlatform[p] = { high: 0, medium: 0, low: 0, total: 0 };

    // "Other" bucket for events on unsupported platforms — shouldn't happen
    // with the current extension manifest but kept for forward-compatibility.
    const other = { high: 0, medium: 0, low: 0, total: 0 };

    for (const e of events) {
      const target = byPlatform[e.platform] ?? other;
      target.total++;
      if (e.risk === "high" || e.risk === "critical") target.high++;
      else if (e.risk === "medium")                   target.medium++;
      else                                             target.low++;
    }

    const max = Math.max(1, ...Object.values(byPlatform).map(s => s.total), other.total);

    const rows = SUPPORTED_PLATFORMS.map(p => ({
      platform: p,
      label:    PLATFORM_LABELS[p],
      ...byPlatform[p],
      barPct:   (byPlatform[p].total / max) * 100,
    }));
    if (other.total > 0) {
      rows.push({ platform: "other", label: "Other", ...other, barPct: (other.total / max) * 100 });
    }
    // Sort by total desc so the dominant platform reads first
    rows.sort((a, b) => b.total - a.total);
    return { rows, totalEvents: events.length };
  }, [events]);

  const used = stats.rows.filter(r => r.total > 0).length;

  return (
    <div className="bg-slate-50 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Platform Activity</div>
        <div className="text-[10px] text-slate-400">
          {used} / {SUPPORTED_PLATFORMS.length} platform{used !== 1 ? "s" : ""} used
        </div>
      </div>

      <div className="space-y-2.5">
        {stats.rows.map(r => (
          <div key={r.platform} className="flex items-center gap-2"
               title={r.total === 0 ? "No events on this platform this window" : undefined}>
            <div className={`w-16 text-xs shrink-0 ${r.total === 0 ? "text-slate-300" : "text-slate-600"}`}>
              {r.label}
            </div>
            {/* Track + filled bar. Track is full-width slate; the inner
                container is sized by barPct so platform totals are comparable
                at a glance. Risk segments within use flex so they distribute
                proportionally to their share of this platform's events. */}
            <div className="flex-1 h-3 rounded bg-slate-100 overflow-hidden relative">
              {r.total > 0 && (
                <div className="absolute inset-y-0 left-0 flex rounded-r overflow-hidden"
                     style={{ width: `${Math.max(r.barPct, 4)}%` }}>
                  {r.high   > 0 && <div style={{ flex: r.high   }} className="bg-red-500"     />}
                  {r.medium > 0 && <div style={{ flex: r.medium }} className="bg-amber-500"   />}
                  {r.low    > 0 && <div style={{ flex: r.low    }} className="bg-emerald-500" />}
                </div>
              )}
            </div>
            <div className={`text-xs shrink-0 w-32 text-right ${r.total === 0 ? "text-slate-300" : "text-slate-500"}`}>
              {r.total === 0 ? "—" : (
                <>
                  <span className="font-semibold text-slate-700">{r.total}</span>
                  {(r.high > 0 || r.medium > 0) && (
                    <span className="text-slate-400 ml-1">
                      ({[
                        r.high   > 0 ? `${r.high} high`   : null,
                        r.medium > 0 ? `${r.medium} med`  : null,
                      ].filter(Boolean).join(" · ")})
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        {stats.totalEvents === 0 && (
          <div className="text-xs text-slate-400 italic py-2">No events in this window.</div>
        )}
      </div>

      {/* Legend — tiny, only shows once user has any flagged activity to interpret */}
      {stats.rows.some(r => r.high > 0 || r.medium > 0) && (
        <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-slate-200/60 text-[10px] text-slate-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500" />high</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500" />medium</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500" />low</span>
        </div>
      )}
    </div>
  );
}

// ── Returning-pattern row (Phase 4.5 header redesign) ────────────────────────
// Single banner that surfaces the "is this concern new or returning?" answer.
// Replaces the two earlier amber treatments (within-term re_emergence banner
// + separate previous-term row). One unified line, with snapshot detail
// available on tap-to-expand.
//
// Priority for the headline copy:
//   1. Within-term re_emergence (most recent / most actionable signal) →
//      "Pattern returned — '{category}' resurfaced since acknowledgement on
//      {date}". Surfaces the immediate context staff need.
//   2. Otherwise, previous-term snapshot with carry-over concern (peak high/
//      critical AND ack_count > 0) → "Returning pattern from {term} —
//      peaked {level}, {n} acks".
//   3. Otherwise, plain "Previous term: {term} · {summary}" muted line.
// Snapshot expand panel only renders when a snapshot is available.

function ReturningPatternRow({
  pulse,
  snapshot,
  term,
  expanded,
  onToggle,
}: {
  pulse:    StudentPulseV3;
  snapshot: PulseTermSnapshot | undefined;
  term:     SchoolTerm | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Carry-over = the previous term ended with concerning peak AND staff
  // engaged. This is the threshold for "you should know about this."
  const carryOver = !!(
    snapshot &&
    (snapshot.peak_alert_level === "high" || snapshot.peak_alert_level === "critical") &&
    snapshot.ack_count > 0
  );

  const withinTermReturn = !!(pulse.re_emergence && pulse.last_acknowledged?.dominant_category);

  // Headline-mode decides the visual treatment + copy. "concern" gets the
  // amber emphasised treatment; "muted" is a quiet previous-term breadcrumb.
  const mode: "within-term" | "carry-over" | "muted" =
    withinTermReturn ? "within-term"
    : carryOver      ? "carry-over"
    :                  "muted";

  const isConcern = mode !== "muted";
  // Snapshot exists controls whether tap-to-expand is available.
  const hasSnapshot = !!(snapshot && term);

  const containerCls = isConcern
    ? "mt-3 rounded-xl border border-amber-200 bg-amber-50/70"
    : "mt-2 rounded-xl border border-slate-200 bg-slate-50/70";
  const iconCls = isConcern ? "text-amber-600 font-bold" : "text-slate-400";
  const labelCls = isConcern ? "font-semibold text-amber-900" : "text-[10px] font-bold text-slate-400 uppercase tracking-wider";
  const bodyCls  = isConcern ? "text-amber-800" : "text-slate-600";

  // Headline copy per mode
  let headlineLabel: string;
  let headlineBody:  string;
  if (mode === "within-term") {
    headlineLabel = "Pattern returned";
    headlineBody  = `“${pulse.last_acknowledged!.dominant_category}” resurfaced since acknowledgement on ${dateShort(pulse.last_acknowledged!.acknowledged_at)}`;
  } else if (mode === "carry-over") {
    const peakWord = snapshot!.peak_alert_level;
    const acks     = snapshot!.ack_count;
    const refs     = snapshot!.referral_count;
    const refSfx   = refs > 0 ? `, ${refs} referral${refs !== 1 ? "s" : ""}` : "";
    headlineLabel  = "Returning pattern";
    headlineBody   = `from ${term!.name} — peaked ${peakWord}, ${acks} ack${acks !== 1 ? "s" : ""}${refSfx}`;
  } else {
    headlineLabel  = "Previous term";
    headlineBody   = term
      ? `${term.name} · ${(snapshot && snapshot.flagged_events > 0)
          ? `${snapshot.flagged_events} flagged event${snapshot.flagged_events !== 1 ? "s" : ""}`
          : "no concerns"}`
      : "no prior term";
  }

  return (
    <div className={containerCls}>
      <button
        type="button"
        onClick={hasSnapshot ? onToggle : undefined}
        disabled={!hasSnapshot}
        className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left rounded-xl ${hasSnapshot ? "hover:bg-amber-50 cursor-pointer" : "cursor-default"}`}
        aria-expanded={hasSnapshot ? expanded : undefined}
      >
        {isConcern && <span className={iconCls}>↩</span>}
        <span className={labelCls}>{headlineLabel}</span>
        <span className={bodyCls}>{headlineBody}</span>
        {hasSnapshot && (
          <span className={`ml-auto text-[10px] ${isConcern ? "text-amber-700" : "text-slate-400"}`}>
            {expanded ? "▴ hide" : "▾ details"}
          </span>
        )}
      </button>

      {/* Expanded snapshot detail — same grid as before, scoped to the
          previous-term snapshot. Only shows when a snapshot is available
          (within-term re-emergence without a prior snapshot has nothing
          to expand into). */}
      {expanded && hasSnapshot && (
        <PreviousTermDetail snapshot={snapshot!} term={term!} />
      )}
    </div>
  );
}

// Previous-term snapshot detail grid — extracted from the earlier
// PreviousTermRow so ReturningPatternRow can reuse it without duplicating
// the layout. Pure presentation; no own state.
function PreviousTermDetail({ snapshot, term }: { snapshot: PulseTermSnapshot; term: SchoolTerm }) {
  const peakChip  = ALERT[snapshot.peak_alert_level === "normal" ? "low" : snapshot.peak_alert_level] ?? ALERT.low;
  const finalChip = ALERT[snapshot.final_alert_level === "normal" ? "low" : snapshot.final_alert_level] ?? ALERT.low;
  const openChip  = ALERT[snapshot.opening_alert_level === "normal" ? "low" : snapshot.opening_alert_level] ?? ALERT.low;
  const trajLabel = trajectoryLabel(snapshot.trajectory);
  const referrals = snapshot.referral_count;
  const acks      = snapshot.ack_count;

  return (
    <div className="px-3 pb-3 border-t border-amber-200/60 pt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
      <DetailLine label="Term window">
        {dateShort(term.start_date)} – {dateShort(term.end_date)}
      </DetailLine>
      <DetailLine label="Pattern">{snapshot.pattern}</DetailLine>

      <DetailLine label="Opening alert">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${openChip.bg} ${openChip.text}`}>
          {openChip.label}
        </span>
      </DetailLine>
      <DetailLine label="Peak alert">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${peakChip.bg} ${peakChip.text}`}>
          {peakChip.label}
        </span>
      </DetailLine>

      <DetailLine label="Final alert">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${finalChip.bg} ${finalChip.text}`}>
          {finalChip.label}
        </span>
        <span className="ml-2 text-slate-400">(score {snapshot.final_score})</span>
      </DetailLine>
      <DetailLine label="Trajectory">{trajLabel ?? snapshot.trajectory}</DetailLine>

      <DetailLine label="Acknowledgements">
        {acks} total{referrals > 0 ? ` · ${referrals} referred/escalated` : ""}
      </DetailLine>
      <DetailLine label="Layer-3 days">{snapshot.layer3_event_days}</DetailLine>

      <DetailLine label="Total events">{snapshot.total_events} ({snapshot.flagged_events} flagged)</DetailLine>
      <DetailLine label="Dominant categories">
        {snapshot.dominant_categories.length > 0
          ? snapshot.dominant_categories.join(", ")
          : <span className="text-slate-400">none</span>}
      </DetailLine>

      {snapshot.key_incidents.length > 0 && (
        <div className="col-span-2 mt-2">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Key incidents</div>
          <div className="space-y-1.5">
            {snapshot.key_incidents.map((inc, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="text-slate-400 shrink-0 w-24">{dateShort(inc.timestamp)}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${ALERT[inc.risk_level === "critical" ? "critical" : inc.risk_level === "high" ? "high" : inc.risk_level === "medium" ? "medium" : "low"].bg} ${ALERT[inc.risk_level === "critical" ? "critical" : inc.risk_level === "high" ? "high" : inc.risk_level === "medium" ? "medium" : "low"].text}`}>
                  {inc.risk_level}
                </span>
                <span className="text-slate-600 shrink-0">{inc.category}</span>
                <span className="text-slate-500 truncate min-w-0" title={inc.summary}>— {inc.summary}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="col-span-2 mt-1 text-[10px] text-slate-400">
        Locked {dateShort(snapshot.locked_at)}
      </div>
    </div>
  );
}

// ── Previous-term row (Phase 4) ───────────────────────────────────────────────
// Kept for compatibility; superseded by ReturningPatternRow above. Will be
// removed once the redesign is validated and no other call sites use it.

function PreviousTermRow({
  snapshot,
  term,
  expanded,
  onToggle,
}: {
  snapshot: PulseTermSnapshot;
  term:     SchoolTerm;
  expanded: boolean;
  onToggle: () => void;
}) {
  const peakChip   = ALERT[snapshot.peak_alert_level === "normal" ? "low" : snapshot.peak_alert_level] ?? ALERT.low;
  const finalChip  = ALERT[snapshot.final_alert_level === "normal" ? "low" : snapshot.final_alert_level] ?? ALERT.low;
  const referrals  = snapshot.referral_count;
  const acks       = snapshot.ack_count;
  const cats       = snapshot.dominant_categories.slice(0, 2).join(", "); // header gets top 2; expand shows all
  const trajLabel  = trajectoryLabel(snapshot.trajectory);

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70">
      {/* Compact header — click anywhere to toggle */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-x-3 gap-y-1 flex-wrap px-3 py-2 text-xs text-left hover:bg-slate-100/70 transition-colors rounded-xl"
        aria-expanded={expanded}
      >
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">Previous term</span>
        <span className="font-semibold text-slate-700">{term.name}</span>
        <span className="text-slate-300">·</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${peakChip.bg} ${peakChip.text}`}>
          peaked {peakChip.label.toLowerCase()}
        </span>
        {cats && (
          <>
            <span className="text-slate-300">·</span>
            <span className="text-slate-600">{cats}</span>
          </>
        )}
        {acks > 0 && (
          <>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500">
              {acks} ack{acks !== 1 ? "s" : ""}
              {referrals > 0 ? ` (${referrals} referral${referrals !== 1 ? "s" : ""})` : ""}
            </span>
          </>
        )}
        {trajLabel && (
          <>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500">{trajLabel}</span>
          </>
        )}
        <span className="ml-auto text-slate-400 text-[10px]">{expanded ? "▴ hide" : "▾ details"}</span>
      </button>

      {/* Expanded: full snapshot record. Layout favours scannability over
          density — each row is "label: value", grouped by purpose. */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-slate-200 pt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <DetailLine label="Term window">
            {dateShort(term.start_date)} – {dateShort(term.end_date)}
          </DetailLine>
          <DetailLine label="Pattern">{snapshot.pattern}</DetailLine>

          <DetailLine label="Opening alert">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${(ALERT[snapshot.opening_alert_level === "normal" ? "low" : snapshot.opening_alert_level] ?? ALERT.low).bg} ${(ALERT[snapshot.opening_alert_level === "normal" ? "low" : snapshot.opening_alert_level] ?? ALERT.low).text}`}>
              {(ALERT[snapshot.opening_alert_level === "normal" ? "low" : snapshot.opening_alert_level] ?? ALERT.low).label}
            </span>
          </DetailLine>
          <DetailLine label="Peak alert">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${peakChip.bg} ${peakChip.text}`}>
              {peakChip.label}
            </span>
          </DetailLine>

          <DetailLine label="Final alert">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${finalChip.bg} ${finalChip.text}`}>
              {finalChip.label}
            </span>
            <span className="ml-2 text-slate-400">(score {snapshot.final_score})</span>
          </DetailLine>
          <DetailLine label="Trajectory">{trajLabel ?? snapshot.trajectory}</DetailLine>

          <DetailLine label="Acknowledgements">
            {acks} total{referrals > 0 ? ` · ${referrals} referred/escalated` : ""}
          </DetailLine>
          <DetailLine label="Layer-3 days">{snapshot.layer3_event_days}</DetailLine>

          <DetailLine label="Total events">{snapshot.total_events} ({snapshot.flagged_events} flagged)</DetailLine>
          <DetailLine label="Dominant categories">
            {snapshot.dominant_categories.length > 0
              ? snapshot.dominant_categories.join(", ")
              : <span className="text-slate-400">none</span>}
          </DetailLine>

          {/* Key incidents span both columns — the prompt text is wide */}
          {snapshot.key_incidents.length > 0 && (
            <div className="col-span-2 mt-2">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Key incidents</div>
              <div className="space-y-1.5">
                {snapshot.key_incidents.map((inc, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-slate-400 shrink-0 w-24">{dateShort(inc.timestamp)}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${ALERT[inc.risk_level === "critical" ? "critical" : inc.risk_level === "high" ? "high" : inc.risk_level === "medium" ? "medium" : "low"].bg} ${ALERT[inc.risk_level === "critical" ? "critical" : inc.risk_level === "high" ? "high" : inc.risk_level === "medium" ? "medium" : "low"].text}`}>
                      {inc.risk_level}
                    </span>
                    <span className="text-slate-600 shrink-0">{inc.category}</span>
                    <span className="text-slate-500 truncate min-w-0" title={inc.summary}>— {inc.summary}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="col-span-2 mt-1 text-[10px] text-slate-400">
            Locked {dateShort(snapshot.locked_at)}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-32 shrink-0">{label}</span>
      <span className="text-slate-700">{children}</span>
    </div>
  );
}

function trajectoryLabel(t: string): string | null {
  // Human-friendly phrasing for the snapshot trajectory enum. Returns null
  // for vocabulary we haven't styled yet so the raw value falls through.
  switch (t) {
    case "improving":            return "improving";
    case "worsening":            return "worsening";
    case "stable":               return "stable";
    case "volatile":             return "volatile";
    case "resolved_after_peak":  return "resolved after peak";
    default:                     return null;
  }
}

// ── Student detail ────────────────────────────────────────────────────────────
function StudentDetail({
  pulse,
  events,
  analyses,
  snoozes,
  onAcknowledge,
  onRequestLLM,
  feedbackCount = 0,
  currentTerm,
  previousTerm,
  previousTermSnapshot,
}: {
  pulse:          StudentPulseV3;
  events:         any[];
  analyses:       SessionAnalysis[];
  snoozes:        PulseSnooze[];
  onAcknowledge:  (action: AcknowledgeAction, notes: string) => Promise<void>;
  onRequestLLM:   (session: ConversationSession<any>) => Promise<void>;
  feedbackCount?: number;
  // Phase 4: previous-term context. Both fields are undefined when there
  // is no prior term (first term of year) or when this student didn't
  // appear in the prior term.
  previousTerm?:         SchoolTerm | null;
  previousTermSnapshot?: PulseTermSnapshot;
  // Current term — needed by the Activity Timeline chart for the "This Term"
  // and "This Year" range options (academic year derived from
  // currentTerm.academic_year). Falls back to a calendar-relative window
  // when not supplied.
  currentTerm?:          SchoolTerm | null;
}) {
  const alert = ALERT[pulse.alert_level];
  const trend = TREND_DIR[pulse.trend_direction];
  const [showZeroSignals, setShowZeroSignals] = useState(false);
  const visibleSignals = useMemo(() => {
    const filtered = showZeroSignals ? pulse.signals : pulse.signals.filter(s => s.score > 0);
    return [...filtered].sort((a, b) => b.score - a.score);
  }, [pulse.signals, showZeroSignals]);
  const zeroSignalCount = pulse.signals.length - pulse.signals.filter(s => s.score > 0).length;
  const fingerprintLead = pulse.fingerprint.event_count > 0
    ? [
        pulse.fingerprint.pattern === "chronic"   ? "Chronic pattern"
      : pulse.fingerprint.pattern === "improving" ? "Improving pattern"
      :                                              "Established pattern",
        pulse.fingerprint.dominant_categories.length > 0
          ? `· ${pulse.fingerprint.dominant_categories.join(", ")}`
          : "",
        `· baseline ${pulse.fingerprint.baseline_score}`,
      ].join(" ").trim()
    : null;

  // Recent snooze activity (active or broken in the last 48h) — surfaced so
  // staff don't see a student in the queue after snoozing them with no
  // explanation. Sorted newest first.
  const studentSnoozes = useMemo(() => {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    return snoozes
      .filter(s => s.student_id === pulse.student_id)
      .filter(s => {
        const stillActive = !s.broken_early && (!s.expires_at || new Date(s.expires_at).getTime() > Date.now());
        if (stillActive) return true;
        if (!s.broken_at) return false;
        return new Date(s.broken_at).getTime() >= cutoff;
      })
      .sort((a, b) => new Date(b.snoozed_at).getTime() - new Date(a.snoozed_at).getTime());
  }, [snoozes, pulse.student_id]);

  const studentEvents = useMemo(() =>
    events.filter((e: any) => e.student_id === pulse.student_id)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [events, pulse.student_id]
  );

  const [chartRange, setChartRange] = useState<"week" | "term" | "year">("term");

  // Phase 4: previous-term expand/collapse state. Default collapsed —
  // the header row carries the answer for most staff scans; the expanded
  // table is for "let me really look at what happened last term."
  const [showPrevTermDetail, setShowPrevTermDetail] = useState(false);

  // Chart data for the three range options:
  //   week — 7 daily bars, Monday-aligned current calendar week
  //   term — weekly bars across the current term, clipped at today (no
  //          empty future-week bars on the right edge). Falls back to a
  //          rolling 12-week window when currentTerm is unknown.
  //   year — monthly bars across the current academic year (Sept 1 of
  //          start year through today), clipped at today. Falls back to a
  //          rolling 10-month window when currentTerm is unknown.
  // Bucket entries carry bucketStart / bucketEnd so the ack ReferenceLine
  // can match by whichever bucket contains the ack timestamp.
  const chartData = useMemo(() => {
    function risksIn(startMs: number, endMs: number) {
      const bucket = studentEvents.filter((e: any) => {
        const t = new Date(e.created_at).getTime();
        return t >= startMs && t < endMs;
      });
      return {
        critical: bucket.filter((e: any) => e.risk === "critical").length,
        high:     bucket.filter((e: any) => e.risk === "high").length,
        medium:   bucket.filter((e: any) => e.risk === "medium").length,
        low:      bucket.filter((e: any) => e.risk === "low").length,
      };
    }

    if (chartRange === "week") {
      // 7 daily bars, Monday → Sunday of the current week. We render every
      // day even if it's in the future; future days simply show zero bars.
      const today    = new Date();
      const dow      = today.getDay();
      const sinceMon = (dow + 6) % 7;
      const monday   = new Date(today.getFullYear(), today.getMonth(), today.getDate() - sinceMon);
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const dayStart = d.getTime();
        const dayEnd   = dayStart + 86400000;
        return {
          date:        d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" }),
          bucketStart: dayStart,
          bucketEnd:   dayEnd,
          ...risksIn(dayStart, dayEnd),
        };
      });
    }

    if (chartRange === "term") {
      // Weekly bars across the term. Bars exist only for weeks that have
      // already started — we clip at "today" so the right edge of the chart
      // reads as "now," not as a wall of empty future bars.
      const todayMs = Date.now();
      let termStartMs: number;
      let termEndMs:   number;
      if (currentTerm) {
        termStartMs = new Date(currentTerm.start_date + "T00:00:00").getTime();
        termEndMs   = new Date(currentTerm.end_date   + "T00:00:00").getTime() + 86400000;
      } else {
        // Fallback: rolling 12-week window ending today, Monday-aligned.
        const t        = new Date();
        const sinceMon = (t.getDay() + 6) % 7;
        termEndMs      = new Date(t.getFullYear(), t.getMonth(), t.getDate() - sinceMon + 7).getTime();
        termStartMs    = termEndMs - 12 * 7 * 86400000;
      }
      // Snap term start back to its containing Monday so week buckets stay
      // calendar-aligned (a term that starts mid-week shouldn't render a
      // half-width opening bar).
      const startDate = new Date(termStartMs);
      const sinceMon  = (startDate.getDay() + 6) % 7;
      const firstMon  = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() - sinceMon);

      const bars: any[] = [];
      for (let weekStart = firstMon.getTime(); weekStart < Math.min(termEndMs, todayMs); weekStart += 7 * 86400000) {
        const weekEnd = weekStart + 7 * 86400000;
        const d = new Date(weekStart);
        bars.push({
          date:        d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
          bucketStart: weekStart,
          bucketEnd:   weekEnd,
          ...risksIn(weekStart, weekEnd),
        });
      }
      return bars;
    }

    // year — monthly bars across the academic year.
    const todayMs = Date.now();
    let yearStartMs: number;
    let yearEndMs:   number;
    if (currentTerm) {
      // academic_year shape: "2025-26" → starts Sept 1 2025, ends Aug 31 2026.
      // UK convention; matches school_terms seed.
      const startYear = parseInt(currentTerm.academic_year.slice(0, 4), 10);
      yearStartMs = new Date(startYear, 8, 1).getTime();        // Sept 1
      yearEndMs   = new Date(startYear + 1, 7, 31).getTime() + 86400000; // Aug 31 inclusive
    } else {
      // Fallback: rolling 10-month window ending this month.
      const t      = new Date();
      yearEndMs    = new Date(t.getFullYear(), t.getMonth() + 1, 1).getTime();
      yearStartMs  = new Date(t.getFullYear(), t.getMonth() - 9, 1).getTime();
    }

    const bars: any[] = [];
    const cursor = new Date(yearStartMs);
    while (cursor.getTime() < Math.min(yearEndMs, todayMs + 86400000)) {
      const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getTime();
      const monthEnd   = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1).getTime();
      bars.push({
        date:        new Date(monthStart).toLocaleDateString("en-GB", { month: "short" }),
        bucketStart: monthStart,
        bucketEnd:   monthEnd,
        ...risksIn(monthStart, monthEnd),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return bars;
  }, [studentEvents, chartRange, currentTerm]);

  // Ack ReferenceLine — match by whichever bucket contains the ack timestamp.
  const lastAckLabel = useMemo(() => {
    if (!pulse.last_acknowledged) return null;
    const ackT = new Date(pulse.last_acknowledged.acknowledged_at).getTime();
    const bucket = chartData.find(d => ackT >= d.bucketStart && ackT < d.bucketEnd);
    return bucket?.date ?? null;
  }, [pulse.last_acknowledged, chartData]);

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

      {/* ── Header strip (redesigned — three load-bearing facts up top) ──
          Design intent: surface the three questions a DSL actually triages with,
          in this order:
            1. "How urgent is this right now?"   → name + alert chip + Pulse score
                                                   + acute-spike chip (its own row,
                                                   so it reads as the action-trigger,
                                                   not just another tag)
            2. "What kind of concern is this?"   → primary-signal sentence as lede.
                                                   Drops the category badge row —
                                                   the sentence already names the
                                                   category meaningfully.
            3. "New, or returning?"              → returning-pattern row (only when
                                                   the previous-term snapshot
                                                   indicates carry-over OR within-
                                                   term re_emergence fired). One
                                                   unified banner replaces the two
                                                   separate amber treatments.
          Everything else — fingerprint pattern, event counts, date range, vs avg,
          PDF — drops to a muted footer that reads as supporting metadata, not
          competing with the answers. */}
      <div className="px-6 py-5 border-b border-slate-100 shrink-0" style={{ background: alert.light }}>
        {/* Row 1 — identity + acute-state chips + Pulse score block.
            Acute / rapid-escalation chips live inline with the name — the
            row has plenty of horizontal space and inline placement keeps the
            "this student needs attention now" cue on the same visual line
            as their identity. Threshold hint moves to a tooltip on the
            score (was a permanent line — redundant). */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h2 className="text-xl font-bold text-slate-800 break-all">{pulse.student_id}</h2>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${alert.bg} ${alert.text}`}>
              {alert.label}
            </span>
            {pulse.layer3_active && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-600 text-white animate-pulse"
                    title="Acute concern in the last 24h — overrides any prior acknowledgement dampening.">
                ⚡ Acute spike today
              </span>
            )}
            {pulse.rapid_escalation && !pulse.layer3_active && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-600 text-white animate-pulse">
                ⚡ Rapid Escalation
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-2 shrink-0">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pulse</span>
            <span
              className="text-3xl font-bold leading-none"
              style={{ color: alert.bar }}
              title="Alert bands: ≥25 medium · ≥50 high · ≥70 urgent"
            >
              {pulse.pulse_score}
            </span>
            {/* When Layer 3 fires, the aggregated trend label can read "stable"
                even though today shows an acute spike — suppress it to avoid
                the contradiction. The acute-spike chip carries the live signal
                instead. */}
            {!pulse.layer3_active && (
              <span className={`text-xs font-semibold ${trend.color}`}>
                {trend.icon} {pulse.trend_direction}
              </span>
            )}
          </div>
        </div>


        {/* Row 3 — primary signal as the lede sentence. The most useful single
            answer to "what kind of concern is this?". Drops the category badge
            row that used to sit alongside; the sentence already names the
            category meaningfully ("Block & Re-attempt Rate — 7 prompts
            blocked…" reads better than a stacked [Jailbreak 14] pill). */}
        {pulse.dominant_signal && (
          <div className="mt-3 text-sm text-slate-700 leading-snug">
            <span className="font-semibold">{pulse.dominant_signal.label}</span>
            <span className="text-slate-500"> — {pulse.dominant_signal.detail}</span>
          </div>
        )}

        {/* Row 4 — returning-pattern banner. Unified treatment that replaces
            the two separate amber bands (within-term re_emergence + previous-
            term carry-over). Prefers the within-term framing when an ack is
            in scope, falls back to the snapshot framing. Tap to expand into
            the full previous-term snapshot grid. */}
        {(previousTermSnapshot && previousTerm) || (pulse.re_emergence && pulse.last_acknowledged) ? (
          <ReturningPatternRow
            pulse={pulse}
            snapshot={previousTermSnapshot}
            term={previousTerm ?? null}
            expanded={showPrevTermDetail}
            onToggle={() => setShowPrevTermDetail(v => !v)}
          />
        ) : null}

        {/* Row 5 — pattern (fingerprint) row. Secondary now — the within-term
            baseline, behind the headline. Only renders when there's a real
            fingerprint window populated. */}
        {fingerprintLead && (
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-2 text-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">Pattern</span>
            <span className="font-semibold text-slate-700">{fingerprintLead}</span>
            <span className="text-slate-400">· {pulse.fingerprint.event_count} historical event{pulse.fingerprint.event_count !== 1 ? "s" : ""}</span>
          </div>
        )}

        {/* Row 6 — muted footer. Date range collapsed to a compact
            "23 May → 28 May". vs-school-avg muted per the school-avg-context-
            only design rule. PDF button restyled to slate so it doesn't
            compete visually with the alert chips. */}
        <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap mt-3 pt-2.5 border-t border-slate-200/60">
          <span>{pulse.total_events} events</span>
          <span className="text-slate-300">·</span>
          <span>
            {new Date(pulse.first_seen).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            {" → "}
            {new Date(pulse.last_seen).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </span>
          {pulse.vs_school_avg !== undefined && pulse.vs_school_avg !== 0 && (
            <>
              <span className="text-slate-300">·</span>
              <span title="Context only — never used to suppress an alert">
                {pulse.vs_school_avg > 0 ? "+" : ""}{pulse.vs_school_avg} vs avg
              </span>
            </>
          )}
          {pulse.context_boost !== 0 && (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-slate-400" title="Engine context boost applied to the raw signal score">
                ctx {pulse.context_boost > 0 ? "+" : ""}{pulse.context_boost}
              </span>
            </>
          )}
          {feedbackCount > 0 && (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-amber-600 font-semibold" title="Previous 'not a concern' submissions for this student">
                {feedbackCount} false positive flag{feedbackCount !== 1 ? "s" : ""}
              </span>
            </>
          )}
          <button
            onClick={() => window.open(`/reports/student?student=${encodeURIComponent(pulse.student_id)}`, "_blank")}
            className="ml-auto text-xs font-semibold text-slate-500 border border-slate-300 px-2.5 py-0.5 rounded-lg hover:bg-white hover:text-slate-700 transition-all"
          >
            ⬇ PDF
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 p-6 space-y-6 overflow-auto">

        {/* Acknowledgement panel */}
        <AcknowledgementPanel pulse={pulse} onSubmit={onAcknowledge} />

        {/* Snooze history — only renders when there's recent activity. Surfaces
            broken snoozes so staff don't see a student back in the queue with
            no explanation. */}
        {studentSnoozes.length > 0 && (
          <div className="rounded-2xl border border-slate-100 bg-white">
            <div className="px-4 py-3 flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
                Snooze
              </span>
              <span className="text-xs text-slate-500">
                {studentSnoozes.length} {studentSnoozes.length === 1 ? "entry" : "entries"} in last 48h
              </span>
            </div>
            <div className="px-4 pb-3 space-y-2 border-t border-slate-100 pt-3">
              {studentSnoozes.map(s => {
                const expiresAt = s.expires_at ? new Date(s.expires_at).getTime() : null;
                const expired   = expiresAt !== null && expiresAt <= Date.now();
                const active    = !s.broken_early && !expired;
                const statusLabel = active
                  ? "💤 Active"
                  : s.broken_early
                    ? "🔔 Broken"
                    : "⌛ Expired";
                const statusClass = active
                  ? "bg-cyan-50 text-cyan-700"
                  : s.broken_early
                    ? "bg-amber-100 text-amber-800"
                    : "bg-slate-100 text-slate-500";
                return (
                  <div key={s.id} className="text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusClass}`}>
                        {statusLabel}
                      </span>
                      <span className="font-semibold text-slate-700">
                        {dateShort(s.snoozed_at)} {new Date(s.snoozed_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="text-slate-400">
                        {s.duration_label} · by {s.snoozed_by}
                      </span>
                      {s.snooze_time_score !== null && (
                        <span className="text-slate-400">
                          at score {s.snooze_time_score}
                        </span>
                      )}
                    </div>
                    {s.broken_early && s.broken_reason && (
                      <div className="text-amber-700 mt-1 italic">
                        Broken {s.broken_at && dateShort(s.broken_at) + " " + new Date(s.broken_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}: {s.broken_reason}
                      </div>
                    )}
                    {s.reason && (
                      <div className="text-slate-500 mt-0.5">Note: {s.reason}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Timeline + signals side by side */}
        <div className="grid grid-cols-[1fr_1fr] gap-5">

          {/* Activity timeline — stacked bars per bucket (day or week).
              Default is the 12-week / term view so staff see the long arc
              rather than just a fortnight; the 14d toggle is the short-term
              inspection view. Lines were swapped for stacked bars because
              the overlapping line series had no legend and hid totals. */}
          <div className="bg-slate-50 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Activity Timeline
                {chartRange === "week" && (
                  <span className="ml-2 text-slate-500 normal-case font-semibold tracking-normal">
                    · {SHAPE_ICON[pulse.trend_shape]} {pulse.trend_shape.replace("_", " ")}
                  </span>
                )}
              </div>
              <div className="flex bg-white rounded-lg border border-slate-200 p-0.5">
                {(["week", "term", "year"] as const).map(r => (
                  <button
                    key={r}
                    onClick={() => setChartRange(r)}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                      chartRange === r
                        ? "bg-[#06B6D4] text-white"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {r === "week" ? "This Week" : r === "term" ? "This Term" : "This Year"}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: "#94a3b8" }}
                  tickLine={false}
                  axisLine={false}
                  interval={chartRange === "term" ? 1 : 0}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0", padding: "6px 10px" }}
                  labelStyle={{ fontWeight: 700, marginBottom: 4, color: "#334155" }}
                  itemStyle={{ padding: "1px 0" }}
                  labelFormatter={(label) =>
                    chartRange === "week" ? label
                    : chartRange === "term" ? `Week of ${label}`
                    : label
                  }
                />
                <Legend
                  verticalAlign="bottom"
                  height={20}
                  iconSize={8}
                  iconType="square"
                  wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
                />
                {lastAckLabel && (
                  <ReferenceLine
                    x={lastAckLabel}
                    stroke="#94a3b8"
                    strokeDasharray="3 3"
                    label={{ value: "ack", position: "top", fontSize: 9, fill: "#94a3b8" }}
                  />
                )}
                {/* Stack order bottom→top: low, medium, high, critical so the
                    most-severe risks visually sit on top of the bar. */}
                <Bar dataKey="low"      stackId="risk" fill="#22C55E" name="Low"      />
                <Bar dataKey="medium"   stackId="risk" fill="#EAB308" name="Medium"   />
                <Bar dataKey="high"     stackId="risk" fill="#EF4444" name="High"     />
                <Bar dataKey="critical" stackId="risk" fill="#6366F1" name="Critical" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Platform activity — replaces the engine Signal Breakdown panel
              with something a DSL can actually read. One bar per supported
              platform, width proportional to event count, segments stacked
              by risk colour. Carries safeguarding signal of its own —
              cross-platform spread reads as deliberate exploration; single-
              platform fixation can read as parasocial dependency (see Sophie
              vs Tyler in the seeded scenarios). */}
          <PlatformActivityPanel events={studentEvents} />

        </div>

        {/* Session timeline */}
        <div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">
            Session Timeline · {sessions.length} session{sessions.length !== 1 ? "s" : ""}
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

// ── Triage queue ──────────────────────────────────────────────────────────────

const TRIAGE_STYLE: Record<TriageLevel, { label: string; ring: string; bar: string; chip: string; sort: number }> = {
  urgent:             { label: "URGENT",       ring: "border-red-500",     bar: "#DC2626", chip: "bg-red-600 text-white animate-pulse",  sort: 0 },
  high:               { label: "HIGH",         ring: "border-red-300",     bar: "#DC2626", chip: "bg-red-100 text-red-700",              sort: 1 },
  medium:             { label: "MEDIUM",       ring: "border-amber-300",   bar: "#F59E0B", chip: "bg-amber-100 text-amber-700",          sort: 2 },
  low:                { label: "LOW",          ring: "border-slate-300",   bar: "#64748B", chip: "bg-slate-200 text-slate-700",          sort: 3 },
  silent_monitoring:  { label: "MONITORING",   ring: "border-slate-200",   bar: "#94A3B8", chip: "bg-slate-100 text-slate-500",          sort: 4 },
};

function SnoozeDropdown({
  onSnooze,
  pending,
}: {
  onSnooze: (duration: SnoozeDuration, reason: string) => Promise<void>;
  pending:  boolean;
}) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState<SnoozeDuration>("24h");
  const [reason, setReason] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const submit = async () => {
    await onSnooze(duration, reason);
    setOpen(false);
    setReason("");
    setDuration("24h");
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={pending}
        className="text-xs font-semibold text-slate-600 border border-slate-200 px-3 py-1.5 rounded-xl hover:border-[#06B6D4] hover:text-[#06B6D4] disabled:opacity-50 transition-all"
      >
        Snooze ▾
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-72 z-20 bg-white border border-slate-200 rounded-2xl shadow-lg p-3 space-y-2">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Snooze duration</div>
          <div className="grid grid-cols-2 gap-1">
            {SNOOZE_DURATIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setDuration(opt.value)}
                className={`text-xs px-2 py-1.5 rounded-lg border text-left ${
                  duration === opt.value
                    ? "border-[#06B6D4] bg-cyan-50 text-[#06B6D4] font-semibold"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Optional note (e.g. discussed with form tutor)"
            rows={2}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20 resize-none"
          />
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-slate-500 px-3 py-1.5 rounded-lg hover:text-slate-700"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={pending}
              className="text-xs font-semibold text-white bg-[#06B6D4] px-3 py-1.5 rounded-lg hover:bg-cyan-600 disabled:opacity-50"
            >
              {pending ? "Snoozing…" : "Confirm snooze"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const UNDO_SECONDS = 10;

function NotAConcernDropdown({
  onSubmit,
  pending,
  studentId,
  category,
}: {
  onSubmit:  (reason: FeedbackReason, notes: string) => Promise<void>;
  pending:   boolean;
  studentId: string;
  category:  string | null;
}) {
  // Three steps after the trigger button:
  //   form      — reason + notes selection
  //   confirm   — "this affects only this student" warning
  //   countdown — 10s undo window before the API write
  //   done      — final thank-you (no further interaction)
  const [step, setStep]     = useState<"idle" | "form" | "confirm" | "countdown" | "done">("idle");
  const [reason, setReason] = useState<FeedbackReason>("known_student");
  const [notes, setNotes]   = useState("");
  const [secs, setSecs]     = useState(UNDO_SECONDS);
  const pendingRef          = useRef<{ reason: FeedbackReason; notes: string } | null>(null);
  const ref                 = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click (only when in form/confirm steps)
  useEffect(() => {
    if (step !== "form" && step !== "confirm") return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setStep("idle");
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [step]);

  // Countdown ticker — fires the actual API write when it hits 0
  useEffect(() => {
    if (step !== "countdown") return;
    if (secs <= 0) {
      onSubmit(pendingRef.current!.reason, pendingRef.current!.notes).then(() => setStep("done"));
      return;
    }
    const id = setTimeout(() => setSecs(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [step, secs, onSubmit]);

  const handleUndo = () => {
    pendingRef.current = null;
    setSecs(UNDO_SECONDS);
    setStep("idle");
    setReason("known_student");
    setNotes("");
  };

  // Countdown / undo toast — rendered inline (not in a dropdown)
  if (step === "countdown" || step === "done") {
    return step === "done" ? (
      <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl">
        Thank you — this helps Pulse learn
      </span>
    ) : (
      <span className="inline-flex items-center gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl">
        Marked as not a concern
        <button
          onClick={handleUndo}
          className="font-bold underline hover:text-amber-900"
        >
          Undo
        </button>
        <span className="text-amber-400">({secs}s)</span>
      </span>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setStep("form")}
        disabled={pending}
        className="text-xs font-semibold text-slate-600 border border-slate-200 px-3 py-1.5 rounded-xl hover:border-amber-400 hover:text-amber-700 disabled:opacity-50 transition-all"
      >
        Not a concern ▾
      </button>

      {/* Form step */}
      {step === "form" && (
        <div className="absolute right-0 mt-1 w-80 z-20 bg-white border border-slate-200 rounded-2xl shadow-lg p-3 space-y-2">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Why is this not a concern?</div>
          <div className="space-y-1">
            {FEEDBACK_REASONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setReason(opt.value)}
                className={`w-full text-xs px-3 py-2 rounded-lg border text-left ${
                  reason === opt.value
                    ? "border-amber-400 bg-amber-50 text-amber-800 font-semibold"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional notes (e.g. discussed at form time)"
            rows={2}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300/30 resize-none"
          />
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={() => setStep("idle")}
              className="text-xs text-slate-500 px-3 py-1.5 rounded-lg hover:text-slate-700"
            >
              Cancel
            </button>
            <button
              onClick={() => setStep("confirm")}
              className="text-xs font-semibold text-white bg-amber-500 px-3 py-1.5 rounded-lg hover:bg-amber-600"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Confirmation step */}
      {step === "confirm" && (
        <div className="absolute right-0 mt-1 w-80 z-20 bg-white border border-amber-200 rounded-2xl shadow-lg p-4 space-y-3">
          <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Confirm — scope of this action</div>
          <p className="text-xs text-slate-700 leading-relaxed">
            You are marking this alert as not a concern for{" "}
            <span className="font-bold">{studentId}</span> only.
          </p>
          {category && (
            <p className="text-xs text-slate-700 leading-relaxed">
              This will reduce the weight of{" "}
              <span className="font-bold">"{category}"</span> alerts for this student for 7 days.
            </p>
          )}
          <p className="text-xs font-semibold text-slate-600">
            It will not affect any other student.
          </p>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={() => setStep("form")}
              className="text-xs text-slate-500 px-3 py-1.5 rounded-lg hover:text-slate-700"
            >
              ← Back
            </button>
            <button
              onClick={() => {
                pendingRef.current = { reason, notes };
                setSecs(UNDO_SECONDS);
                setStep("countdown");
              }}
              className="text-xs font-semibold text-white bg-amber-500 px-3 py-1.5 rounded-lg hover:bg-amber-600"
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TriageCard({
  row,
  pulse,
  brokenSnooze,
  clusterEntry,
  onReview,
  onSnooze,
  onNotAConcern,
  onViewProfile,
  onGroupContext,
  reviewing,
  snoozing,
  submittingFeedback,
}: {
  row:                 TriageResultRow;
  pulse?:              StudentPulseV3;
  brokenSnooze?:       PulseSnooze;
  clusterEntry?:       ClusterRow;
  onReview:            (studentId: string) => Promise<void>;
  onSnooze:            (studentId: string, duration: SnoozeDuration, reason: string) => Promise<void>;
  onNotAConcern:       (studentId: string, triageId: string, reason: FeedbackReason, notes: string) => Promise<void>;
  onViewProfile:       (studentId: string) => void;
  onGroupContext?:     (c: ClusterRow) => void;
  reviewing:           boolean;
  snoozing:            boolean;
  submittingFeedback:  boolean;
}) {
  const style = TRIAGE_STYLE[row.triage];
  const cats  = pulse?.categories.slice(0, 3) ?? [];

  return (
    <div className={`rounded-2xl border-l-4 ${style.ring} bg-white border border-slate-100 p-4 hover:shadow-sm transition-shadow`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className={`text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full ${style.chip}`}>
            {style.label}
          </span>
          <span className="font-semibold text-slate-800 text-sm">{row.student_id}</span>
          {row.notify_immediately && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600 text-white">
              📣 Notify
            </span>
          )}
          {brokenSnooze && (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-900"
              title={brokenSnooze.broken_reason ?? "Snooze broken by override condition"}
            >
              🔔 Re-surfaced from snooze
            </span>
          )}
          {pulse?.re_emergence && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700" title="Re-emergence of previously acknowledged pattern">
              ↩ Re-emerged
            </span>
          )}
          {pulse?.rapid_escalation && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700" title="Rapid escalation in last 3 days">
              ⚡ Rapid
            </span>
          )}
          {cats.map(c => (
            <span key={c.name} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
              {c.name}
            </span>
          ))}
          {clusterEntry && (
            <button
              onClick={() => onGroupContext?.(clusterEntry)}
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
              title="This individual alert is a separate concern. Group context: this student also appears in a group pattern detected today — the two issues may be related but should be reviewed independently."
            >
              + Group context →
            </button>
          )}
        </div>
      </div>

      {brokenSnooze?.broken_reason && (
        <p className="text-[11px] text-amber-700 mb-2 italic">
          Re-surfaced: {brokenSnooze.broken_reason}
        </p>
      )}

      {row.concern_summary && (
        <p className="text-sm text-slate-700 mb-2 leading-snug">{row.concern_summary}</p>
      )}
      {row.suggested_action && (
        <p className="text-xs text-slate-500 mb-3 leading-snug">
          <span className="font-semibold text-slate-600">Suggested action:</span> {row.suggested_action}
        </p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => onReview(row.student_id)}
          disabled={reviewing}
          className="text-xs font-semibold text-white bg-[#06B6D4] px-3 py-1.5 rounded-xl hover:bg-cyan-600 disabled:opacity-50 transition-all"
        >
          {reviewing ? "Marking…" : "Mark reviewed"}
        </button>
        <SnoozeDropdown
          onSnooze={(duration, reason) => onSnooze(row.student_id, duration, reason)}
          pending={snoozing}
        />
        <NotAConcernDropdown
          onSubmit={(reason, notes) => onNotAConcern(row.student_id, row.id, reason, notes)}
          pending={submittingFeedback}
          studentId={row.student_id}
          category={pulse?.categories[0]?.name ?? null}
        />
        <button
          onClick={() => onViewProfile(row.student_id)}
          className="text-xs font-semibold text-slate-500 border border-slate-200 px-3 py-1.5 rounded-xl hover:border-[#06B6D4] hover:text-[#06B6D4] transition-all"
        >
          View full profile →
        </button>
      </div>
    </div>
  );
}

function WeeklySummaryCard({
  summary,
  onViewProfile,
}: {
  summary:       WeeklySummary;
  onViewProfile: (studentId: string) => void;
}) {
  // Default-open on Mondays per spec; collapsed other days. User toggle overrides.
  const [open, setOpen] = useState(summary.is_monday);

  const trendDelta = summary.school_avg_delta;
  const trendColor = trendDelta > 3  ? "text-red-600"
                   : trendDelta < -3 ? "text-emerald-600"
                   : "text-slate-500";
  const trendArrow = trendDelta > 3 ? "↑" : trendDelta < -3 ? "↓" : "→";

  const eventDelta = summary.events_this_week - summary.events_last_week;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">📊 WEEKLY SUMMARY</span>
          <span className="text-sm font-semibold text-slate-700">{summary.week_label}</span>
          {summary.is_monday && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700">Monday digest</span>
          )}
          <span className="text-xs text-slate-500">
            {summary.attention_students.length} need attention · {summary.acks_this_week.total} acks · {summary.active_students_this_week} active students
          </span>
        </div>
        <span className="text-slate-400 text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-100 pt-4">

          {/* Trend tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">School avg pulse</div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-700">{summary.school_avg_this_week}</span>
                <span className={`text-xs font-semibold ${trendColor}`}>
                  {trendArrow} {Math.abs(trendDelta)} vs last week
                </span>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Events this week</div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-700">{summary.events_this_week}</span>
                <span className={`text-xs font-semibold ${eventDelta > 0 ? "text-amber-600" : eventDelta < 0 ? "text-slate-500" : "text-slate-500"}`}>
                  {eventDelta >= 0 ? "+" : ""}{eventDelta} vs last week
                </span>
              </div>
            </div>
            <div className="rounded-xl bg-amber-50 p-3">
              <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">Re-emergences</div>
              <div className="text-2xl font-bold text-amber-800">{summary.re_emergence_students.length}</div>
              <div className="text-[11px] text-amber-700 mt-0.5">Previously acknowledged patterns back</div>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3">
              <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-1">Improvements</div>
              <div className="text-2xl font-bold text-emerald-800">{summary.improvement_students.length}</div>
              <div className="text-[11px] text-emerald-700 mt-0.5">Students dropped a tier</div>
            </div>
          </div>

          {/* Attention list */}
          {summary.attention_students.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Required attention this week · {summary.attention_students.length}
              </div>
              <div className="space-y-1">
                {summary.attention_students.slice(0, 8).map(s => (
                  <div key={s.student_id} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TRIAGE_STYLE[s.highest_triage].chip}`}>
                        {TRIAGE_STYLE[s.highest_triage].label}
                      </span>
                      <span className="font-semibold text-slate-700">{s.student_id}</span>
                      <span className="text-slate-400">in queue {s.days_in_queue} day{s.days_in_queue === 1 ? "" : "s"}</span>
                      {s.notify_count > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                          {s.notify_count}× notify
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => onViewProfile(s.student_id)}
                      className="text-[11px] text-slate-500 hover:text-[#06B6D4] shrink-0"
                    >
                      View →
                    </button>
                  </div>
                ))}
                {summary.attention_students.length > 8 && (
                  <div className="text-[11px] text-slate-400 text-center py-1">
                    + {summary.attention_students.length - 8} more
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Re-emergence + improvement + regression rows */}
          <div className="grid md:grid-cols-3 gap-3">
            <div className="rounded-xl bg-amber-50/40 border border-amber-100 p-3">
              <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-2">Re-emerged</div>
              {summary.re_emergence_students.length === 0
                ? <div className="text-xs text-slate-400">None this week</div>
                : <div className="space-y-1">
                    {summary.re_emergence_students.slice(0, 5).map(id => (
                      <button key={id} onClick={() => onViewProfile(id)}
                        className="block text-xs text-slate-700 font-semibold hover:text-[#06B6D4]">
                        {id}
                      </button>
                    ))}
                    {summary.re_emergence_students.length > 5 && (
                      <div className="text-[11px] text-amber-700">+ {summary.re_emergence_students.length - 5} more</div>
                    )}
                  </div>
              }
            </div>
            <div className="rounded-xl bg-emerald-50/40 border border-emerald-100 p-3">
              <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-2">Improving</div>
              {summary.improvement_students.length === 0
                ? <div className="text-xs text-slate-400">No tier drops this week</div>
                : <div className="space-y-1">
                    {summary.improvement_students.slice(0, 5).map(s => (
                      <button key={s.student_id} onClick={() => onViewProfile(s.student_id)}
                        className="block text-xs text-slate-700 hover:text-[#06B6D4]">
                        <span className="font-semibold">{s.student_id}</span>{" "}
                        <span className="text-slate-500">{s.from} → {s.to}</span>
                      </button>
                    ))}
                    {summary.improvement_students.length > 5 && (
                      <div className="text-[11px] text-emerald-700">+ {summary.improvement_students.length - 5} more</div>
                    )}
                  </div>
              }
            </div>
            <div className="rounded-xl bg-red-50/40 border border-red-100 p-3">
              <div className="text-[10px] font-bold text-red-700 uppercase tracking-wider mb-2">Regressed</div>
              {summary.regression_students.length === 0
                ? <div className="text-xs text-slate-400">No tier rises this week</div>
                : <div className="space-y-1">
                    {summary.regression_students.slice(0, 5).map(s => (
                      <button key={s.student_id} onClick={() => onViewProfile(s.student_id)}
                        className="block text-xs text-slate-700 hover:text-[#06B6D4]">
                        <span className="font-semibold">{s.student_id}</span>{" "}
                        <span className="text-slate-500">{s.from} → {s.to}</span>
                      </button>
                    ))}
                    {summary.regression_students.length > 5 && (
                      <div className="text-[11px] text-red-700">+ {summary.regression_students.length - 5} more</div>
                    )}
                  </div>
              }
            </div>
          </div>

          {/* Ack breakdown + top categories */}
          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Acknowledgements this week</div>
              {summary.acks_this_week.total === 0
                ? <div className="text-xs text-slate-400">No acknowledgements logged</div>
                : <div className="flex items-center gap-3 flex-wrap text-xs">
                    <span><span className="font-bold text-slate-700">{summary.acks_this_week.total}</span> total</span>
                    {summary.acks_this_week.monitored > 0 && <span className="text-slate-600">{summary.acks_this_week.monitored} monitored</span>}
                    {summary.acks_this_week.referred  > 0 && <span className="text-violet-700">{summary.acks_this_week.referred} referred</span>}
                    {summary.acks_this_week.escalated > 0 && <span className="text-red-700">{summary.acks_this_week.escalated} escalated</span>}
                    {summary.acks_this_week.no_action > 0 && <span className="text-slate-500">{summary.acks_this_week.no_action} no action</span>}
                  </div>
              }
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Top categories this week</div>
              {summary.top_categories.length === 0
                ? <div className="text-xs text-slate-400">No flagged categories</div>
                : <div className="flex items-center gap-2 flex-wrap">
                    {summary.top_categories.map(c => (
                      <span key={c.name} className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
                        {c.name} · <span className="font-bold text-slate-700">{c.count}</span>
                      </span>
                    ))}
                  </div>
              }
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

// ── Cluster UI (Brief 6) ─────────────────────────────────────────────────────

const CLUSTER_TYPE_LABEL: Record<string, string> = {
  category_spike:        "Category spike",
  coordinated_jailbreak: "Coordinated jailbreak",
  "keyword_co-occurrence": "Keyword co-occurrence",
  sentiment_wave:        "Sentiment wave",
};

const CLUSTER_SEVERITY_STYLE: Record<string, { chip: string; border: string; icon: string }> = {
  notable:     { chip: "bg-amber-100 text-amber-700",   border: "border-amber-300",  icon: "⚠" },
  significant: { chip: "bg-orange-100 text-orange-700", border: "border-orange-400", icon: "⚠" },
  critical:    { chip: "bg-red-100 text-red-700",       border: "border-red-500",    icon: "🚨" },
};

function ClusterCard({
  cluster,
  onReview,
  onDismiss,
  dismissing,
}: {
  cluster:   ClusterRow;
  onReview:  (c: ClusterRow) => void;
  onDismiss: (id: string) => void;
  dismissing: boolean;
}) {
  const style   = CLUSTER_SEVERITY_STYLE[cluster.severity] ?? CLUSTER_SEVERITY_STYLE.notable;
  const triage  = cluster.cluster_triage_results?.[0];

  return (
    <div className={`rounded-2xl border-l-4 ${style.border} bg-white border border-slate-100 p-4`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className={`text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full ${style.chip}`}>
            {style.icon} {CLUSTER_TYPE_LABEL[cluster.cluster_type] ?? cluster.cluster_type}
          </span>
          <span className="font-semibold text-slate-800 text-sm">{cluster.category}</span>
          <span className="text-[10px] text-slate-400">
            {cluster.student_count} students · {Math.round(cluster.time_window_hours)}h window
            {cluster.group_context ? ` · ${cluster.group_context}` : ""}
          </span>
          {triage?.notify_immediately && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600 text-white">
              📣 Notify immediately
            </span>
          )}
        </div>
      </div>

      <p className="text-sm text-slate-700 mb-2 leading-snug">
        {triage?.concern_summary ?? cluster.summary}
      </p>
      {triage?.suggested_action && (
        <p className="text-xs text-slate-500 mb-3 leading-snug">
          <span className="font-semibold text-slate-600">Suggested action:</span> {triage.suggested_action}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => onReview(cluster)}
          className="text-xs font-semibold text-white bg-[#06B6D4] px-3 py-1.5 rounded-xl hover:bg-cyan-600 transition-all"
        >
          Review group →
        </button>
        <button
          onClick={() => onDismiss(cluster.id)}
          disabled={dismissing}
          className="text-xs font-semibold text-slate-500 border border-slate-200 px-3 py-1.5 rounded-xl hover:border-slate-400 disabled:opacity-50 transition-all"
        >
          {dismissing ? "Dismissing…" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}

function ClusterDetailView({
  cluster,
  pulsesById,
  events,
  onClose,
  onAcknowledge,
  onDismiss,
  onViewProfile,
  acknowledging,
  dismissing,
}: {
  cluster:      ClusterRow;
  pulsesById:   Map<string, StudentPulseV3>;
  // Page-level event set. Used to compute shared-elements (platforms,
  // matched keywords) across the cluster and to render per-student
  // sparklines. Passing events through instead of re-fetching per panel
  // open keeps the open-cluster interaction snappy.
  events:       any[];
  onClose:      () => void;
  onAcknowledge:(id: string, note: string) => void;
  onDismiss:    (id: string) => void;
  onViewProfile?:(studentId: string) => void;
  acknowledging: boolean;
  dismissing:    boolean;
}) {
  const [note, setNote] = useState("");
  const triage   = cluster.cluster_triage_results?.[0];
  const style    = CLUSTER_SEVERITY_STYLE[cluster.severity] ?? CLUSTER_SEVERITY_STYLE.notable;
  // pulsesById is kept for the individual triage-level pills; redesigned
  // sparklines compute directly from events.
  void pulsesById;

  const timelineItems = cluster.student_ids.map((sid, i) => ({
    label: sid,
    level: cluster.individual_pulses[i] ?? "unknown",
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl bg-white shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${style.chip}`}>
                {style.icon} {CLUSTER_TYPE_LABEL[cluster.cluster_type]}
              </span>
              <span className="font-bold text-slate-800">{cluster.category}</span>
            </div>
            <p className="text-xs text-slate-400">
              {cluster.student_count} students · {Math.round(cluster.time_window_hours)}h window
              {cluster.group_context ? ` · ${cluster.group_context}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl font-light mt-0.5">×</button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Why this group — type-aware narrative + shared-elements bullets.
              Sits ABOVE the LLM assessment so the assessment reads as "given
              this context, here's what I think" rather than as the cluster's
              only narrative. The data comes from the cluster row's own
              fields plus aggregations across the cluster members' events. */}
          <ClusterWhyPanel cluster={cluster} events={events} />

          {/* LLM assessment */}
          {triage && (
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Group assessment</h3>
              <p className="text-sm text-slate-700 leading-snug mb-2">{triage.concern_summary}</p>
              <p className="text-xs text-slate-500 leading-snug">
                <span className="font-semibold text-slate-600">Suggested action:</span> {triage.suggested_action}
              </p>
              {triage.reasoning && (
                <details className="mt-2">
                  <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-600">Show reasoning</summary>
                  <p className="text-[11px] text-slate-500 mt-1 leading-snug italic">{triage.reasoning}</p>
                </details>
              )}
            </div>
          )}

          {/* Individual triage levels */}
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Students in this cluster</h3>
            <div className="flex flex-wrap gap-2">
              {timelineItems.map((item, i) => (
                <button
                  key={i}
                  onClick={() => { onClose(); onViewProfile?.(item.label); }}
                  className="text-xs text-slate-600 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-100 flex items-center gap-2 hover:border-[#06B6D4] hover:bg-cyan-50 transition-colors"
                >
                  <span className="font-semibold text-slate-700">{item.label}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    item.level === "critical" ? "bg-indigo-100 text-indigo-700" :
                    item.level === "high"     ? "bg-red-100 text-red-700" :
                    item.level === "medium"   ? "bg-amber-100 text-amber-700" :
                                               "bg-slate-100 text-slate-500"
                  }`}>{item.level}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Click a student to view their full profile.</p>
          </div>

          {/* Per-student activity sparklines — replaces the misleading line
              "sentiment arcs" with 14-day severity-stacked bar mini-charts.
              Each bar is one day; segments stacked by risk colour (low/med
              /high). Reads at a glance: which student is acute today vs.
              chronic across the window vs. quiet. */}
          {cluster.student_ids.length > 0 && (
            <ClusterMemberSparklines studentIds={cluster.student_ids} events={events} />
          )}

          {/* Acknowledge as group */}
          <div className="border-t border-slate-100 pt-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Acknowledge as group</h3>
            <p className="text-xs text-slate-400 mb-3 leading-snug">
              A single acknowledgement will be recorded against this group pattern.
              Individual student records are not modified.
            </p>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Optional note (e.g. 'Discussed in staff meeting — monitoring year group')"
              className="w-full text-xs text-slate-700 border border-slate-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-[#06B6D4] mb-3"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                onClick={() => onAcknowledge(cluster.id, note)}
                disabled={acknowledging}
                className="flex-1 text-xs font-semibold text-white bg-[#06B6D4] px-3 py-2 rounded-xl hover:bg-cyan-600 disabled:opacity-50 transition-all"
              >
                {acknowledging ? "Saving…" : "Acknowledge group pattern"}
              </button>
              <button
                onClick={() => onDismiss(cluster.id)}
                disabled={dismissing}
                className="text-xs font-semibold text-slate-500 border border-slate-200 px-3 py-2 rounded-xl hover:border-slate-400 disabled:opacity-50 transition-all"
              >
                {dismissing ? "…" : "Dismiss"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupPatternsPanel({
  clusters,
  pulsesById,
  onReview,
  onDismiss,
  dismissingId,
}: {
  clusters:    ClusterRow[];
  pulsesById:  Map<string, StudentPulseV3>;
  onReview:    (c: ClusterRow) => void;
  onDismiss:   (id: string) => void;
  dismissingId: string | null;
}) {
  const [otherOpen, setOtherOpen] = useState(true);

  const active  = clusters.filter(c => !c.dismissed_at && !c.acknowledged_at);
  if (active.length === 0) return null;

  const urgent  = active.filter(c =>  c.cluster_triage_results?.[0]?.notify_immediately);
  const other   = active.filter(c => !c.cluster_triage_results?.[0]?.notify_immediately);

  return (
    <div className="space-y-3">

      {/* Urgent group patterns — red box matching individual urgent banner */}
      {urgent.length > 0 && (
        <div className="rounded-2xl border-2 border-red-500 bg-red-50/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-red-600 text-white animate-pulse">
              📣 GROUP ALERT — IMMEDIATE ATTENTION
            </span>
            <span className="text-xs text-slate-500">{urgent.length} group pattern{urgent.length === 1 ? "" : "s"}</span>
          </div>
          <div className="space-y-3">
            {urgent.map(c => (
              <ClusterCard
                key={c.id}
                cluster={c}
                onReview={onReview}
                onDismiss={onDismiss}
                dismissing={dismissingId === c.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Non-urgent group patterns — collapsible amber section */}
      {other.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/20">
          <button
            onClick={() => setOtherOpen(o => !o)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-amber-50/40 transition-colors rounded-t-2xl"
          >
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                GROUP PATTERNS
              </span>
              <span className="text-xs text-slate-600 font-medium">
                {other.length} group pattern{other.length === 1 ? "" : "s"} detected today
              </span>
            </div>
            <span className="text-slate-400 text-sm">{otherOpen ? "▲" : "▼"}</span>
          </button>

          {otherOpen && (
            <div className="px-4 pb-4 space-y-3">
              {other.map(c => (
                <ClusterCard
                  key={c.id}
                  cluster={c}
                  onReview={onReview}
                  onDismiss={onDismiss}
                  dismissing={dismissingId === c.id}
                />
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// ── Groups tab (Brief 6 dedicated view) ─────────────────────────────────────

function ClusterListItem({
  cluster,
  isActive,
  onClick,
}: {
  cluster:  ClusterRow;
  isActive: boolean;
  onClick:  () => void;
}) {
  const style  = CLUSTER_SEVERITY_STYLE[cluster.severity] ?? CLUSTER_SEVERITY_STYLE.notable;
  const triage = cluster.cluster_triage_results?.[0];
  const isDone = !!(cluster.dismissed_at || cluster.acknowledged_at);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-slate-50 transition-colors flex items-start gap-2 ${
        isActive ? "bg-cyan-50 border-l-2 border-l-[#06B6D4]" : "hover:bg-slate-50"
      } ${isDone ? "opacity-50" : ""}`}
    >
      <span className={`mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${style.chip}`}>
        {style.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span className="text-sm font-semibold text-slate-700 truncate">{cluster.category}</span>
          {triage?.notify_immediately && !isDone && (
            <span className="text-[9px] font-bold text-red-600">📣</span>
          )}
          {cluster.acknowledged_at && (
            <span className="text-[9px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">✓ Acked</span>
          )}
          {cluster.dismissed_at && !cluster.acknowledged_at && (
            <span className="text-[9px] text-slate-400">Dismissed</span>
          )}
        </div>
        <div className="text-[10px] text-slate-400 mt-0.5 truncate">
          {CLUSTER_TYPE_LABEL[cluster.cluster_type]} · {cluster.student_count} students
        </div>
      </div>
    </button>
  );
}

function ClusterDetailPanel({
  cluster,
  pulsesById,
  events,
  onAcknowledge,
  onDismiss,
  onViewProfile,
  acknowledging,
  dismissing,
}: {
  cluster:       ClusterRow;
  pulsesById:    Map<string, StudentPulseV3>;
  events:        any[];
  onAcknowledge: (id: string, note: string) => void;
  onDismiss:     (id: string) => void;
  onViewProfile: (studentId: string) => void;
  acknowledging: boolean;
  dismissing:    boolean;
}) {
  const [note, setNote] = useState("");
  const triage  = cluster.cluster_triage_results?.[0];
  const style   = CLUSTER_SEVERITY_STYLE[cluster.severity] ?? CLUSTER_SEVERITY_STYLE.notable;
  const isDone  = !!(cluster.dismissed_at || cluster.acknowledged_at);
  // pulsesById is kept for the individual triage-level pills and the Show in
  // profile button; the redesigned sparklines compute directly from events.
  void pulsesById;

  const timelineItems = cluster.student_ids.map((sid, i) => ({
    label: sid,
    level: cluster.individual_pulses[i] ?? "unknown",
  }));

  return (
    <div className="h-full overflow-auto">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 z-10">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${style.chip}`}>
            {style.icon} {CLUSTER_TYPE_LABEL[cluster.cluster_type]}
          </span>
          <span className="font-bold text-slate-800">{cluster.category}</span>
          {triage?.notify_immediately && !isDone && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600 text-white animate-pulse">
              📣 Notify immediately
            </span>
          )}
          {cluster.acknowledged_at && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              ✓ Acknowledged
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400">
          {cluster.student_count} students · {Math.round(cluster.time_window_hours)}h window
          {cluster.group_context ? ` · ${cluster.group_context}` : ""}
          {cluster.acknowledged_at && cluster.acknowledged_by && (
            <> · Acked by {cluster.acknowledged_by} on {dateShort(cluster.acknowledged_at)}</>
          )}
        </p>
        {cluster.acknowledged_note && (
          <p className="text-xs text-slate-500 mt-1 italic">"{cluster.acknowledged_note}"</p>
        )}
      </div>

      <div className="px-6 py-5 space-y-6">

        {/* What are group patterns — brief explainer */}
        <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-xs text-slate-500 leading-relaxed">
          <span className="font-semibold text-slate-600">Group pattern</span> — multiple students showing correlated
          behaviour in a short time window. This is separate from each student's individual concern. Review both
          independently; the group context may inform but does not replace individual follow-up.
        </div>

        {/* Why this group — type-aware narrative + shared-elements bullets */}
        <ClusterWhyPanel cluster={cluster} events={events} />

        {/* LLM assessment */}
        {triage && (
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Group assessment</h3>
            <p className="text-sm text-slate-700 leading-snug mb-2">{triage.concern_summary}</p>
            <p className="text-xs text-slate-500 leading-snug">
              <span className="font-semibold text-slate-600">Suggested action:</span> {triage.suggested_action}
            </p>
            {triage.reasoning && (
              <details className="mt-2">
                <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-600">Show reasoning</summary>
                <p className="text-[11px] text-slate-500 mt-1 leading-snug italic">{triage.reasoning}</p>
              </details>
            )}
          </div>
        )}

        {/* Students in cluster */}
        <div>
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Students in this cluster</h3>
          <div className="flex flex-wrap gap-2">
            {timelineItems.map((item, i) => (
              <button
                key={i}
                onClick={() => onViewProfile(item.label)}
                className="text-xs text-slate-600 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-100 flex items-center gap-2 hover:border-[#06B6D4] hover:bg-cyan-50 transition-colors"
              >
                <span className="font-semibold text-slate-700">{item.label}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  item.level === "critical" ? "bg-indigo-100 text-indigo-700" :
                  item.level === "high"     ? "bg-red-100 text-red-700"       :
                  item.level === "medium"   ? "bg-amber-100 text-amber-700"   :
                                             "bg-slate-100 text-slate-500"
                }`}>{item.level}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">Click a student to view their full individual profile.</p>
        </div>

        {/* Per-student activity sparklines — 14-day severity-stacked bars */}
        {cluster.student_ids.length > 0 && (
          <ClusterMemberSparklines studentIds={cluster.student_ids} events={events} />
        )}

        {/* Acknowledge / dismiss */}
        {!isDone && (
          <div className="border-t border-slate-100 pt-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Acknowledge as group</h3>
            <p className="text-xs text-slate-400 mb-3 leading-snug">
              A single acknowledgement records against this group pattern.
              Individual student records are not affected.
            </p>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Optional note (e.g. 'Discussed in staff meeting — monitoring year group')"
              className="w-full text-xs text-slate-700 border border-slate-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-[#06B6D4] mb-3"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                onClick={() => onAcknowledge(cluster.id, note)}
                disabled={acknowledging}
                className="flex-1 text-xs font-semibold text-white bg-[#06B6D4] px-3 py-2 rounded-xl hover:bg-cyan-600 disabled:opacity-50 transition-all"
              >
                {acknowledging ? "Saving…" : "Acknowledge group pattern"}
              </button>
              <button
                onClick={() => onDismiss(cluster.id)}
                disabled={dismissing}
                className="text-xs font-semibold text-slate-500 border border-slate-200 px-3 py-2 rounded-xl hover:border-slate-400 disabled:opacity-50 transition-all"
              >
                {dismissing ? "…" : "Dismiss"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GroupsTab({
  clusters,
  pulsesById,
  events,
  selectedCluster,
  onSelectCluster,
  onAcknowledge,
  onDismiss,
  onViewProfile,
  dismissingId,
  acknowledgingId,
}: {
  clusters:        ClusterRow[];
  pulsesById:      Map<string, StudentPulseV3>;
  events:          any[];
  selectedCluster: ClusterRow | null;
  onSelectCluster: (c: ClusterRow | null) => void;
  onAcknowledge:   (id: string, note: string) => void;
  onDismiss:       (id: string) => void;
  onViewProfile:   (studentId: string) => void;
  dismissingId:    string | null;
  acknowledgingId: string | null;
}) {
  const active   = clusters.filter(c => !c.dismissed_at && !c.acknowledged_at);
  const reviewed = clusters.filter(c => c.dismissed_at || c.acknowledged_at);

  const urgent = active.filter(c =>  c.cluster_triage_results?.[0]?.notify_immediately);
  const other  = active.filter(c => !c.cluster_triage_results?.[0]?.notify_immediately);

  // Auto-select first active cluster when none is chosen
  const displayCluster = selectedCluster ?? active[0] ?? reviewed[0] ?? null;

  if (clusters.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
        <div className="text-3xl">👥</div>
        <div className="text-sm font-semibold text-slate-600">No group patterns today</div>
        <div className="text-xs max-w-xs text-center">
          Run today's triage to check whether multiple students show correlated patterns.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left: cluster list */}
      <div className="w-64 shrink-0 bg-white border-r border-slate-200 overflow-auto">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Group Patterns · {clusters.length}
          </div>
        </div>

        {urgent.length > 0 && (
          <div className="border-b border-red-100">
            <div className="px-4 py-1.5 bg-red-50/50 flex items-center gap-2">
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-600 text-white">URGENT</span>
              <span className="text-[10px] text-slate-500">{urgent.length}</span>
            </div>
            {urgent.map(c => (
              <ClusterListItem
                key={c.id}
                cluster={c}
                isActive={displayCluster?.id === c.id}
                onClick={() => onSelectCluster(c)}
              />
            ))}
          </div>
        )}

        {other.length > 0 && (
          <div className="border-b border-slate-100">
            <div className="px-4 py-1.5 bg-amber-50/30 flex items-center gap-2">
              <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Active</span>
              <span className="text-[10px] text-slate-400">{other.length}</span>
            </div>
            {other.map(c => (
              <ClusterListItem
                key={c.id}
                cluster={c}
                isActive={displayCluster?.id === c.id}
                onClick={() => onSelectCluster(c)}
              />
            ))}
          </div>
        )}

        {reviewed.length > 0 && (
          <div>
            <div className="px-4 py-1.5 flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Reviewed</span>
              <span className="text-[10px] text-slate-400">{reviewed.length}</span>
            </div>
            {reviewed.map(c => (
              <ClusterListItem
                key={c.id}
                cluster={c}
                isActive={displayCluster?.id === c.id}
                onClick={() => onSelectCluster(c)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right: detail */}
      <div className="flex-1 bg-white overflow-auto">
        {displayCluster ? (
          <ClusterDetailPanel
            cluster={displayCluster}
            pulsesById={pulsesById}
            events={events}
            onAcknowledge={onAcknowledge}
            onDismiss={onDismiss}
            onViewProfile={onViewProfile}
            acknowledging={acknowledgingId === displayCluster.id}
            dismissing={dismissingId === displayCluster.id}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            Select a group pattern from the list
          </div>
        )}
      </div>
    </div>
  );
}

function TriageQueue({
  results,
  pulsesById,
  snoozes,
  clusterByStudent,
  weeklySummary,
  loading,
  running,
  runError,
  onRunTriage,
  onReview,
  onSnooze,
  onNotAConcern,
  onEndSnoozeEarly,
  onViewProfile,
  onGroupContext,
  reviewingId,
  snoozingId,
  feedbackSubmittingId,
}: {
  results:              TriageResultRow[];
  pulsesById:           Map<string, StudentPulseV3>;
  snoozes:              PulseSnooze[];
  clusterByStudent:     Map<string, ClusterRow>;
  weeklySummary:        WeeklySummary | null;
  loading:              boolean;
  running:              boolean;
  runError:             string | null;
  onRunTriage:          (force: boolean) => void;
  onReview:             (studentId: string) => Promise<void>;
  onSnooze:             (studentId: string, duration: SnoozeDuration, reason: string) => Promise<void>;
  onNotAConcern:        (studentId: string, triageId: string, reason: FeedbackReason, notes: string) => Promise<void>;
  onEndSnoozeEarly:     (snoozeId: string) => Promise<void>;
  onViewProfile:        (studentId: string) => void;
  onGroupContext:       (c: ClusterRow) => void;
  reviewingId:          string | null;
  snoozingId:           string | null;
  feedbackSubmittingId: string | null;
}) {
  const now = Date.now();

  const sorted = useMemo(() =>
    [...results].sort((a, b) => {
      if (a.notify_immediately !== b.notify_immediately) return a.notify_immediately ? -1 : 1;
      return TRIAGE_STYLE[a.triage].sort - TRIAGE_STYLE[b.triage].sort;
    }),
    [results],
  );

  // Index active snoozes per student so the actionable queue can hide them.
  const activeSnoozeByStudent = useMemo(() => {
    const map = new Map<string, PulseSnooze>();
    for (const s of snoozes) {
      const active = activeSnoozeFor(s.student_id, snoozes, now);
      if (active && !map.has(s.student_id)) map.set(s.student_id, active);
    }
    return map;
  }, [snoozes, now]);

  // Index snoozes broken in the last 24h so re-entered cards get a badge.
  const recentlyBrokenByStudent = useMemo(() => {
    const cutoff = now - 24 * 60 * 60 * 1000;
    const map = new Map<string, PulseSnooze>();
    for (const s of snoozes) {
      if (!s.broken_early || !s.broken_at) continue;
      if (new Date(s.broken_at).getTime() < cutoff) continue;
      const existing = map.get(s.student_id);
      if (!existing || new Date(s.broken_at).getTime() > new Date(existing.broken_at!).getTime()) {
        map.set(s.student_id, s);
      }
    }
    return map;
  }, [snoozes, now]);

  const visibleResults = useMemo(
    () => sorted.filter(r => !activeSnoozeByStudent.has(r.student_id)),
    [sorted, activeSnoozeByStudent],
  );

  const urgent      = visibleResults.filter(r => !r.reviewed_at && (r.notify_immediately || r.triage === "urgent"));
  const actionable  = visibleResults.filter(r => !r.reviewed_at && !urgent.includes(r) && r.triage !== "silent_monitoring");
  const monitoring  = visibleResults.filter(r => r.triage === "silent_monitoring" || !!r.reviewed_at);
  const [acknowledgedOpen, setAcknowledgedOpen] = useState(false);

  const snoozedList = useMemo(
    () => Array.from(activeSnoozeByStudent.values())
      .sort((a, b) => new Date(b.snoozed_at).getTime() - new Date(a.snoozed_at).getTime()),
    [activeSnoozeByStudent],
  );

  const attentionCount = urgent.length + actionable.length;
  const greeting       = greetingForNow();

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">

      {/* Header + run-triage controls */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            {greeting}. {attentionCount === 0
              ? "no students need your attention today."
              : `${attentionCount} student${attentionCount === 1 ? "" : "s"} need your attention today.`}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {results.length === 0
              ? "Today's triage hasn't been run yet."
              : `${results.length} student${results.length === 1 ? "" : "s"} assessed today · ${monitoring.length + snoozedList.length} acknowledged`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={() => onRunTriage(results.length > 0)}
            disabled={running}
            className="text-xs font-semibold text-white bg-[#06B6D4] px-4 py-2 rounded-xl hover:bg-cyan-600 disabled:opacity-50 transition-all"
          >
            {running
              ? "Running triage…"
              : results.length > 0
                ? "🔄 Re-run today's triage"
                : "▶ Run today's triage"}
          </button>
          {runError && <span className="text-[11px] text-red-600">{runError}</span>}
        </div>
      </div>

      {/* Urgent banner */}
      {urgent.length > 0 && (
        <div className="rounded-2xl border-2 border-red-500 bg-red-50/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-red-600 text-white animate-pulse">
              📣 URGENT — IMMEDIATE ATTENTION
            </span>
            <span className="text-xs text-slate-500">{urgent.length} student{urgent.length === 1 ? "" : "s"}</span>
          </div>
          <div className="space-y-3">
            {urgent.map(r => (
              <TriageCard
                key={r.id}
                row={r}
                pulse={pulsesById.get(r.student_id)}
                brokenSnooze={recentlyBrokenByStudent.get(r.student_id)}
                clusterEntry={clusterByStudent.get(r.student_id)}
                onReview={onReview}
                onSnooze={onSnooze}
                onNotAConcern={onNotAConcern}
                onViewProfile={onViewProfile}
                onGroupContext={onGroupContext}
                reviewing={reviewingId === r.student_id}
                snoozing={snoozingId === r.student_id}
                submittingFeedback={feedbackSubmittingId === r.student_id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Actionable queue */}
      {actionable.length > 0 && (
        <div className="space-y-3">
          {actionable.map(r => (
            <TriageCard
              key={r.id}
              row={r}
              pulse={pulsesById.get(r.student_id)}
              brokenSnooze={recentlyBrokenByStudent.get(r.student_id)}
              clusterEntry={clusterByStudent.get(r.student_id)}
              onReview={onReview}
              onSnooze={onSnooze}
              onNotAConcern={onNotAConcern}
              onViewProfile={onViewProfile}
              onGroupContext={onGroupContext}
              reviewing={reviewingId === r.student_id}
              snoozing={snoozingId === r.student_id}
              submittingFeedback={feedbackSubmittingId === r.student_id}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && results.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 rounded-2xl">
          No triage results for today yet. Click <strong>Run today's triage</strong> above to score active students.
        </div>
      )}
      {!loading && results.length > 0 && attentionCount === 0 && (
        <div className="text-center py-8 text-slate-400 text-sm border border-dashed border-slate-200 rounded-2xl">
          No students require attention today. All active students are in silent monitoring.
        </div>
      )}

      {/* Acknowledged — snoozed + monitoring combined */}
      {(snoozedList.length > 0 || monitoring.length > 0) && (
        <div className="rounded-2xl border border-slate-100 bg-white">
          <button
            onClick={() => setAcknowledgedOpen(o => !o)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">ACKNOWLEDGED</span>
              <span className="text-xs text-slate-500">
                {snoozedList.length + monitoring.length} student{snoozedList.length + monitoring.length !== 1 ? "s" : ""} — no action needed
              </span>
            </div>
            <span className="text-slate-400 text-sm">{acknowledgedOpen ? "▲" : "▼"}</span>
          </button>
          {acknowledgedOpen && (
            <div className="px-4 pb-4 space-y-2">
              {/* Snoozed first */}
              {snoozedList.map(s => (
                <div key={s.id} className="text-xs text-slate-600 px-3 py-2 rounded-lg bg-cyan-50/50 border border-cyan-100 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="font-semibold text-slate-700">{s.student_id}</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700">
                      💤 {snoozeLabel(s, now)}
                    </span>
                    <span className="text-slate-400 text-[11px]">by {s.snoozed_by}</span>
                    {s.reason && <span className="text-slate-400 text-[11px] italic truncate max-w-md">"{s.reason}"</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onEndSnoozeEarly(s.id)}
                      className="text-[11px] text-slate-500 hover:text-red-600 px-2 py-1 rounded-lg"
                      title="End this snooze and return the student to the queue"
                    >
                      End snooze
                    </button>
                    <button
                      onClick={() => onViewProfile(s.student_id)}
                      className="text-[11px] text-slate-500 hover:text-[#06B6D4]"
                    >
                      View →
                    </button>
                  </div>
                </div>
              ))}
              {/* Monitoring / reviewed below */}
              {monitoring.map(r => (
                <div key={r.id} className="text-xs text-slate-500 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="font-semibold text-slate-700">{r.student_id}</span>
                    {r.reviewed_at ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                        ✓ Reviewed
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                        Monitoring
                      </span>
                    )}
                    <span className="text-slate-400 truncate">{r.concern_summary ?? "Stable activity"}</span>
                  </div>
                  <button
                    onClick={() => onViewProfile(r.student_id)}
                    className="text-[11px] text-slate-500 hover:text-[#06B6D4] shrink-0"
                  >
                    View →
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Weekly summary — bottom of queue */}
      {weeklySummary && (
        <WeeklySummaryCard summary={weeklySummary} onViewProfile={onViewProfile} />
      )}
    </div>
  );
}

// ── Calibration view ─────────────────────────────────────────────────────────

function CalibrationView({ feedback }: { feedback: PulseFeedback[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Aggregate by category — track count, unique staff, and date range.
  // A suggestion only surfaces after ≥10 submissions of the same type from
  // different staff members over at least 30 days. This protects the advisory
  // layer from a handful of accidental clicks skewing calibration.
  const catStats = useMemo(() => {
    const m = new Map<string, { count: number; staff: Set<string>; timestamps: number[] }>();
    feedback.forEach(f => {
      if (!f.category) return;
      if (!m.has(f.category)) m.set(f.category, { count: 0, staff: new Set(), timestamps: [] });
      const entry = m.get(f.category)!;
      entry.count++;
      entry.staff.add(f.submitted_by);
      entry.timestamps.push(new Date(f.submitted_at).getTime());
    });
    return m;
  }, [feedback]);

  // Simple count-by-category for display (includes all submissions)
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    catStats.forEach((v, k) => m.set(k, v.count));
    return m;
  }, [catStats]);

  // Aggregate by reason
  const byReason = useMemo(() => {
    const m = new Map<string, number>();
    feedback.forEach(f => m.set(f.reason, (m.get(f.reason) ?? 0) + 1));
    return m;
  }, [feedback]);

  const suggestions = useMemo(() => {
    const MIN_SUBMISSIONS = 10;
    const MIN_STAFF       = 2;
    const MIN_SPAN_DAYS   = 30;
    return Array.from(catStats.entries())
      .filter(([cat, s]) => {
        if (dismissed.has(cat)) return false;
        if (s.count < MIN_SUBMISSIONS) return false;
        if (s.staff.size < MIN_STAFF) return false;
        const sorted = [...s.timestamps].sort((a, b) => a - b);
        const spanDays = (sorted[sorted.length - 1] - sorted[0]) / 86400000;
        return spanDays >= MIN_SPAN_DAYS;
      })
      .sort((a, b) => b[1].count - a[1].count)
      .map(([cat, s]) => {
        const sorted = [...s.timestamps].sort((a, b) => a - b);
        const spanDays = Math.round((sorted[sorted.length - 1] - sorted[0]) / 86400000);
        return {
          cat,
          count:     s.count,
          staffCount: s.staff.size,
          spanDays,
          message: `${s.count} "not a concern" submissions for "${cat}" from ${s.staff.size} staff members over ${spanDays} days. Consider reviewing keyword sensitivity or policy notes for this category.`,
        };
      });
  }, [catStats, dismissed]);

  const reasonLabel: Record<string, string> = {
    known_student:     "Known to staff",
    sentiment_misread: "Sentiment misread",
    keyword_irrelevant:"Keyword not relevant",
    other:             "Other",
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Calibration</h2>
        <p className="text-sm text-slate-500 mt-1">
          Each "not a concern" submission suppresses the misfiring signal for 7 days and is logged here to help you spot patterns.
          Suggested adjustments are advisory — you review and decide.
        </p>
      </div>

      {feedback.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center text-slate-400">
          <div className="text-3xl mb-3">📊</div>
          <div className="font-semibold text-slate-600">No feedback submitted yet</div>
          <div className="text-sm mt-1">Use "Not a concern" on queue entries to start building calibration data.</div>
        </div>
      ) : (
        <>
          {/* Advisory suggestions */}
          {suggestions.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Advisory suggestions</div>
              {suggestions.map(s => (
                <div key={s.cat} className="flex items-start gap-4 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-amber-800">{s.cat}</span>
                      <span className="text-[10px] text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                        {s.count} submissions · {s.staffCount} staff · {s.spanDays}d span
                      </span>
                    </div>
                    <p className="text-xs text-amber-700">{s.message}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 mt-0.5">
                    <button
                      onClick={() => setDismissed(d => new Set([...d, s.cat]))}
                      className="text-[11px] text-slate-500 border border-slate-200 px-2 py-1 rounded-lg hover:text-slate-700 bg-white"
                    >
                      Dismiss
                    </button>
                    <button
                      onClick={() => setDismissed(d => new Set([...d, s.cat]))}
                      className="text-[11px] font-semibold text-amber-700 border border-amber-300 px-2 py-1 rounded-lg hover:bg-amber-100"
                    >
                      Noted ✓
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Breakdown tiles */}
          <div className="grid grid-cols-2 gap-5">

            <div className="bg-white rounded-2xl border border-slate-100 p-4">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">By category</div>
              {byCat.size === 0
                ? <div className="text-xs text-slate-400">No category data yet</div>
                : Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
                  <div key={cat} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                    <span className="text-sm text-slate-700">{cat}</span>
                    <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{count}</span>
                  </div>
                ))
              }
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 p-4">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">By reason</div>
              {byReason.size === 0
                ? <div className="text-xs text-slate-400">No reason data yet</div>
                : Array.from(byReason.entries()).sort((a, b) => b[1] - a[1]).map(([reason, count]) => (
                  <div key={reason} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                    <span className="text-sm text-slate-700">{reasonLabel[reason] ?? reason}</span>
                    <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{count}</span>
                  </div>
                ))
              }
            </div>

          </div>

          {/* Full log */}
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Submission log</div>
              <span className="text-xs text-slate-400">{feedback.length} total</span>
            </div>
            <div className="divide-y divide-slate-50">
              {feedback.slice(0, 50).map(f => (
                <div key={f.id} className="px-4 py-2.5 flex items-center gap-3 text-xs flex-wrap">
                  <span className="font-semibold text-slate-700 w-28 shrink-0 truncate">{f.student_id}</span>
                  <span className="text-slate-500">{reasonLabel[f.reason] ?? f.reason}</span>
                  {f.category && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold">{f.category}</span>
                  )}
                  {f.notes && <span className="text-slate-400 italic truncate max-w-xs">"{f.notes}"</span>}
                  <span className="text-slate-300 ml-auto">
                    {new Date(f.submitted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function greetingForNow(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ── Student list item ─────────────────────────────────────────────────────────
// Status chip is the new headline — workflow verb is what staff scan on. The
// pulse score retreats to a small grey number after the status, keeping the
// engine reading available without competing for attention. Severity is still
// encoded via the leading dot colour and via the surrounding tier grouping.
function StudentListItem({
  pulse,
  status,
  isActive,
  onClick,
}: {
  pulse:    StudentPulseV3;
  status:   StudentStatusValue;
  isActive: boolean;
  onClick:  () => void;
}) {
  const alert = ALERT[pulse.alert_level];
  const st    = STUDENT_STATUS_STYLE[status];

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
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${st.chip}`}
            title={`Workflow status: ${st.label}`}>
        {st.label}
      </span>
      <span className="text-[10px] text-slate-400 font-semibold shrink-0 w-6 text-right"
            title={`Pulse score (alert band: ${pulse.alert_level})`}>
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
  const [termContext, setTermContext] = useState<TermContext | null>(null);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState<StudentPulseV3 | null>(null);
  const [search, setSearch]     = useState("");
  const [openTiers, setOpenTiers] = useState<Record<string, boolean>>({ critical: true, high: false, medium: false, low: false });

  // Phase 3 triage queue state
  const [tab, setTab] = useState<"queue" | "groups" | "all" | "calibration">("queue");
  const [triage, setTriage] = useState<TriageResultRow[]>([]);
  const [triageVersion, setTriageVersion] = useState(0);
  const [triageRunning, setTriageRunning] = useState(false);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [snoozes, setSnoozes] = useState<PulseSnooze[]>([]);
  const [snoozesVersion, setSnoozesVersion] = useState(0);
  const [feedbackSubmittingId, setFeedbackSubmittingId] = useState<string | null>(null);
  const [feedbackRows, setFeedbackRows] = useState<PulseFeedback[]>([]);
  const [feedbackVersion, setFeedbackVersion] = useState(0);
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  const [weeklyTriage, setWeeklyTriage] = useState<TriageResultRow[]>([]);
  const [clusters, setClusters] = useState<ClusterRow[]>([]);
  const [clustersVersion, setClustersVersion] = useState(0);
  const [selectedCluster, setSelectedCluster] = useState<ClusterRow | null>(null);
  const [dismissingClusterId, setDismissingClusterId] = useState<string | null>(null);
  const [acknowledgingClusterId, setAcknowledgingClusterId] = useState<string | null>(null);

  useEffect(() => {
    fetchAllEvents({ ascending: true })
      .then(data => { setEvents(data); setLoading(false); });
  }, []);

  useEffect(() => {
    fetchAcknowledgements(SCHOOL_ID).then(setAcks);
  }, [acksVersion]);

  useEffect(() => {
    fetchTermContext(supabase, SCHOOL_ID).then(setTermContext);
  }, []);

  useEffect(() => {
    fetchSessionAnalyses(SCHOOL_ID).then(setAnalyses);
  }, [analysesVersion]);

  useEffect(() => {
    fetchTodaysTriage(SCHOOL_ID).then(setTriage);
    // Weekly summary needs the last 7 days; pulled alongside so a triage run
    // refreshes both. 8 days covers Monday-load when "this week" spans 0-7d.
    fetchRecentTriage(SCHOOL_ID, 8).then(setWeeklyTriage);
  }, [triageVersion]);

  useEffect(() => {
    fetchSnoozes(SCHOOL_ID).then(setSnoozes);
  }, [snoozesVersion]);

  useEffect(() => {
    supabase
      .from("pulse_feedback")
      .select("id,school_id,student_id,triage_id,submitted_by,submitted_at,reason,notes,signal_context,sentiment_trend,category")
      .eq("school_id", SCHOOL_ID)
      .order("submitted_at", { ascending: false })
      .then(({ data }) => setFeedbackRows((data ?? []) as PulseFeedback[]));
  }, [feedbackVersion]);

  useEffect(() => {
    fetchTodayClusters(SCHOOL_ID).then(setClusters);
  }, [clustersVersion, triageVersion]); // refresh when triage runs (may produce new clusters)

  const feedbackCountByStudent = useMemo(() => {
    const m = new Map<string, number>();
    feedbackRows.forEach(f => m.set(f.student_id, (m.get(f.student_id) ?? 0) + 1));
    return m;
  }, [feedbackRows]);

  // Map student_id → cluster for active (not dismissed, not acknowledged) clusters.
  const clusterByStudent = useMemo(() => {
    const m = new Map<string, ClusterRow>();
    for (const c of clusters) {
      if (c.dismissed_at || c.acknowledged_at) continue;
      for (const sid of c.student_ids) {
        if (!m.has(sid)) m.set(sid, c);
      }
    }
    return m;
  }, [clusters]);

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
    () => calculateAllPulsesV3(events, acks, analyses, termContext ?? undefined),
    [events, acks, analyses, termContext],
  );

  // Workflow status per student. Derived once per pulses/acks/snoozes change
  // so the list-item rows don't each re-derive on render. Same helper that
  // drives the dashboard's Recent Safeguarding Events widget — both surfaces
  // show the same verb-set for the same student.
  const statusByStudent = useMemo(() => {
    const map = new Map<string, StudentStatusValue>();
    for (const p of pulses) {
      map.set(p.student_id, deriveStudentStatus({
        studentId:  p.student_id,
        firstSeen:  p.first_seen,
        acks,
        snoozes,
      }));
    }
    return map;
  }, [pulses, acks, snoozes]);

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

  const pulsesById = useMemo(
    () => new Map(pulses.map(p => [p.student_id, p])),
    [pulses],
  );

  const weeklySummary = useMemo(() => {
    // Skip when nothing's loaded yet — avoids flashing a zeroed summary
    // before the first events query returns.
    if (!events.length && !weeklyTriage.length) return null;
    return buildWeeklySummary({
      pulses,
      triage: weeklyTriage,
      acks,
      events,
    });
  }, [pulses, weeklyTriage, acks, events]);

  const runTriage = useCallback(async (force: boolean) => {
    setTriageRunning(true);
    setTriageError(null);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const email = authSession?.user?.email ?? "unknown";
      const res = await fetch("/api/triage/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requested_by: email, school_id: SCHOOL_ID, force }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTriageError(body?.error || `Request failed (${res.status})`);
      } else if (body?.failed > 0) {
        setTriageError(`${body.succeeded} processed, ${body.failed} failed (see server logs)`);
      }
      setTriageVersion(v => v + 1);
      // A triage run may have broken active snoozes via override conditions;
      // refresh so the snoozed section and re-entry badges reflect reality.
      setSnoozesVersion(v => v + 1);
    } catch (err: any) {
      setTriageError(err?.message || "Failed to run triage");
    } finally {
      setTriageRunning(false);
    }
  }, []);

  const snoozeFromQueue = useCallback(async (studentId: string, duration: SnoozeDuration, reason: string) => {
    setSnoozingId(studentId);
    try {
      const pulse = pulsesById.get(studentId);
      const ok = await insertSnooze({
        student_id:              studentId,
        duration,
        reason,
        snooze_time_score:       pulse?.pulse_score,
        snooze_time_alert_level: pulse?.alert_level,
      });
      if (ok) {
        setSnoozesVersion(v => v + 1);
        // Drop today's triage row for this student locally so the queue
        // hides them immediately without waiting for the snoozes refetch.
        setTriage(prev => prev.filter(r => r.student_id !== studentId));
      }
    } finally {
      setSnoozingId(null);
    }
  }, [pulsesById]);

  const endSnoozeEarly = useCallback(async (snoozeId: string) => {
    const ok = await breakSnoozeRow(snoozeId, "Ended early by staff");
    if (ok) setSnoozesVersion(v => v + 1);
  }, []);

  const openGroupContext = useCallback((cluster: ClusterRow) => {
    setSelectedCluster(cluster);
    setTab("groups");
  }, []);

  const dismissCluster = useCallback(async (clusterId: string) => {
    setDismissingClusterId(clusterId);
    try {
      await fetch(`/api/clusters/${clusterId}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed_by: "staff" }),
      });
      setClustersVersion(v => v + 1);
      if (selectedCluster?.id === clusterId) setSelectedCluster(null);
    } finally {
      setDismissingClusterId(null);
    }
  }, [selectedCluster]);

  const acknowledgeCluster = useCallback(async (clusterId: string, note: string) => {
    setAcknowledgingClusterId(clusterId);
    try {
      await fetch(`/api/clusters/${clusterId}/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged_by: "staff", note }),
      });
      setClustersVersion(v => v + 1);
      if (selectedCluster?.id === clusterId) setSelectedCluster(null);
    } finally {
      setAcknowledgingClusterId(null);
    }
  }, [selectedCluster]);

  const notAConcernFromQueue = useCallback(async (
    studentId:  string,
    triageId:   string,
    reason:     FeedbackReason,
    notes:      string,
  ) => {
    setFeedbackSubmittingId(studentId);
    try {
      const pulse = pulsesById.get(studentId);
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_id:      SCHOOL_ID,
          student_id:     studentId,
          triage_id:      triageId,
          submitted_by:   "staff",
          reason,
          notes:          notes || null,
          signal_context: pulse?.signals.map(s => s.id) ?? [],
          category:       pulse?.categories[0]?.name ?? null,
        }),
      });
      setFeedbackVersion(v => v + 1);
    } finally {
      setFeedbackSubmittingId(null);
    }
  }, [pulsesById]);

  const reviewFromQueue = useCallback(async (studentId: string) => {
    const pulse = pulsesById.get(studentId);
    if (!pulse) return;
    setReviewingId(studentId);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const email = authSession?.user?.email ?? "unknown";
      const dominantCategory = pulse.categories[0]?.name ?? null;
      const now = new Date().toISOString();
      const today = now.slice(0, 10);

      const [ackOk] = await Promise.all([
        insertAcknowledgement({
          student_id:        studentId,
          alert_level:       pulse.alert_level,
          dominant_category: dominantCategory,
          action_taken:      "monitored",
          notes:             "Marked reviewed from triage queue",
        }),
        // Mark today's triage row as reviewed so it stays out of the queue on refresh
        supabase
          .from("beacon_triage_results")
          .update({ reviewed_at: now, reviewed_by: email })
          .eq("school_id", SCHOOL_ID)
          .eq("student_id", studentId)
          .gte("assessed_at", `${today}T00:00:00Z`)
          .lte("assessed_at", `${today}T23:59:59.999Z`)
          .is("reviewed_at", null),
      ]);

      if (ackOk) {
        setAcksVersion(v => v + 1);
        setTriage(prev => prev.filter(r => r.student_id !== studentId));
      }
    } finally {
      setReviewingId(null);
    }
  }, [pulsesById]);

  const viewProfileFromQueue = useCallback((studentId: string) => {
    const pulse = pulsesById.get(studentId);
    if (pulse) setSelected(pulse);
    setTab("all");
  }, [pulsesById]);

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
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl border border-slate-200 p-0.5 bg-slate-50">
              <button
                onClick={() => setTab("queue")}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                  tab === "queue" ? "bg-white text-[#06B6D4] shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Today's Queue
              </button>
              <button
                onClick={() => setTab("groups")}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                  tab === "groups" ? "bg-white text-[#06B6D4] shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Group Patterns
                {clusters.filter(c => !c.dismissed_at && !c.acknowledged_at).length > 0 && (
                  <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    clusters.some(c => !c.dismissed_at && !c.acknowledged_at && c.cluster_triage_results?.[0]?.notify_immediately)
                      ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                  }`}>
                    {clusters.filter(c => !c.dismissed_at && !c.acknowledged_at).length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setTab("all")}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                  tab === "all" ? "bg-white text-[#06B6D4] shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                All students
              </button>
              <button
                onClick={() => setTab("calibration")}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                  tab === "calibration" ? "bg-white text-amber-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Calibration
                {feedbackRows.length > 0 && (
                  <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    {feedbackRows.length}
                  </span>
                )}
              </button>
            </div>
            <Link href="/pulse"
              className="text-xs font-semibold text-slate-500 border border-slate-200 px-3 py-1.5 rounded-xl hover:border-[#06B6D4] hover:text-[#06B6D4] transition-all">
              ← Release Version
            </Link>
          </div>
        </header>

        {tab === "calibration" ? (
          <div className="flex-1 overflow-auto bg-[#F0F2F8]">
            <CalibrationView feedback={feedbackRows} />
          </div>
        ) : tab === "queue" ? (
          <div className="flex-1 overflow-auto bg-[#F0F2F8]">
            <TriageQueue
              results={triage}
              pulsesById={pulsesById}
              snoozes={snoozes}
              clusterByStudent={clusterByStudent}
              weeklySummary={weeklySummary}
              loading={loading}
              running={triageRunning}
              runError={triageError}
              onRunTriage={runTriage}
              onReview={reviewFromQueue}
              onSnooze={snoozeFromQueue}
              onNotAConcern={notAConcernFromQueue}
              onEndSnoozeEarly={endSnoozeEarly}
              onViewProfile={viewProfileFromQueue}
              onGroupContext={openGroupContext}
              reviewingId={reviewingId}
              snoozingId={snoozingId}
              feedbackSubmittingId={feedbackSubmittingId}
            />
          </div>
        ) : tab === "groups" ? (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <GroupsTab
              clusters={clusters}
              pulsesById={pulsesById}
              events={events}
              selectedCluster={selectedCluster}
              onSelectCluster={setSelectedCluster}
              onAcknowledge={acknowledgeCluster}
              onDismiss={dismissCluster}
              onViewProfile={viewProfileFromQueue}
              dismissingId={dismissingClusterId}
              acknowledgingId={acknowledgingClusterId}
            />
          </div>
        ) : (
        <>
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
                      status={statusByStudent.get(pulse.student_id) ?? "monitoring"}
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
              ? <StudentDetail
                  pulse={selected}
                  events={events}
                  analyses={analyses}
                  snoozes={snoozes}
                  onAcknowledge={acknowledgeSelected}
                  onRequestLLM={requestLLMForSession}
                  feedbackCount={feedbackCountByStudent.get(selected.student_id) ?? 0}
                  currentTerm={termContext?.currentTerm ?? null}
                  previousTerm={termContext?.previousTerm ?? null}
                  previousTermSnapshot={termContext?.previousTermSnapshots?.find(s => s.student_id === selected.student_id)}
                />
              : <div className="flex items-center justify-center h-full text-slate-400 text-sm">Select a student</div>
            }
          </div>

        </div>
        </>
        )}
      </div>

      {/* Cluster detail overlay — only outside the groups tab (groups tab renders inline) */}
      {selectedCluster && tab !== "groups" && (
        <ClusterDetailView
          cluster={selectedCluster}
          pulsesById={pulsesById}
          events={events}
          onClose={() => setSelectedCluster(null)}
          onAcknowledge={acknowledgeCluster}
          onDismiss={dismissCluster}
          onViewProfile={viewProfileFromQueue}
          acknowledging={acknowledgingClusterId === selectedCluster.id}
          dismissing={dismissingClusterId === selectedCluster.id}
        />
      )}
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
