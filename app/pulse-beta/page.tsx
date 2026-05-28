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
} from "@/lib/pulse_engine_v3";
import { fetchTermContext } from "@/lib/terms";
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
  snoozes,
  onAcknowledge,
  onRequestLLM,
  feedbackCount = 0,
}: {
  pulse:          StudentPulseV3;
  events:         any[];
  analyses:       SessionAnalysis[];
  snoozes:        PulseSnooze[];
  onAcknowledge:  (action: AcknowledgeAction, notes: string) => Promise<void>;
  onRequestLLM:   (session: ConversationSession<any>) => Promise<void>;
  feedbackCount?: number;
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

  const [chartRange, setChartRange] = useState<"14d" | "12w">("12w");

  // Chart data for both granularities. The "14d" view is a daily bar per
  // day for short-term inspection; "12w" aggregates by ISO-ish week (Mon
  // start) so a 12-week / one-term view is legible without crushing 84
  // daily bars into a strip. Week buckets carry an extra `bucketStart`
  // timestamp so the ack ReferenceLine can match by week.
  const chartData = useMemo(() => {
    if (chartRange === "14d") {
      return Array.from({ length: 14 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (13 - i));
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const dayEnd   = dayStart + 86400000;
        const day = studentEvents.filter((e: any) => {
          const t = new Date(e.created_at).getTime();
          return t >= dayStart && t < dayEnd;
        });
        return {
          date:        d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
          bucketStart: dayStart,
          bucketEnd:   dayEnd,
          critical:    day.filter((e: any) => e.risk === "critical").length,
          high:        day.filter((e: any) => e.risk === "high").length,
          medium:      day.filter((e: any) => e.risk === "medium").length,
          low:         day.filter((e: any) => e.risk === "low").length,
        };
      });
    }
    // 12-week view — Monday-aligned week starts.
    const today    = new Date();
    const dow      = today.getDay();                      // 0=Sun..6=Sat
    const sinceMon = (dow + 6) % 7;                       // days back to Monday
    const thisMon  = new Date(today.getFullYear(), today.getMonth(), today.getDate() - sinceMon);
    return Array.from({ length: 12 }, (_, i) => {
      const weekStart = new Date(thisMon);
      weekStart.setDate(thisMon.getDate() - (11 - i) * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      const wkEvents = studentEvents.filter((e: any) => {
        const t = new Date(e.created_at).getTime();
        return t >= weekStart.getTime() && t < weekEnd.getTime();
      });
      return {
        date:        weekStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        bucketStart: weekStart.getTime(),
        bucketEnd:   weekEnd.getTime(),
        critical:    wkEvents.filter((e: any) => e.risk === "critical").length,
        high:        wkEvents.filter((e: any) => e.risk === "high").length,
        medium:      wkEvents.filter((e: any) => e.risk === "medium").length,
        low:         wkEvents.filter((e: any) => e.risk === "low").length,
      };
    });
  }, [studentEvents, chartRange]);

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

      {/* ── Header strip ── */}
      <div className="px-6 py-5 border-b border-slate-100 shrink-0" style={{ background: alert.light }}>
        {/* Row 1 — identity (left) + inline pulse score block (right) */}
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

          <div className="flex flex-col items-end shrink-0">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pulse</span>
              <span className="text-3xl font-bold leading-none" style={{ color: alert.bar }}>{pulse.pulse_score}</span>
              {/* When Layer 3 fires, the aggregated trend label can read "stable"
                  even though today shows an acute spike — suppress it to avoid
                  the contradiction. The "⚡ Acute spike today" chip carries the
                  current signal instead. */}
              {!pulse.layer3_active && (
                <span className={`text-xs font-semibold ${trend.color}`}>
                  {trend.icon} {pulse.trend_direction}
                </span>
              )}
              {pulse.vs_school_avg !== undefined && pulse.vs_school_avg !== 0 && (
                <span className="text-xs text-slate-400"
                      title="Context only — never used to suppress an alert">
                  {pulse.vs_school_avg > 0 ? "+" : ""}{pulse.vs_school_avg} vs avg
                </span>
              )}
              {pulse.context_boost !== 0 && (
                <span className="text-[10px] text-slate-400">
                  ctx {pulse.context_boost > 0 ? "+" : ""}{pulse.context_boost}
                </span>
              )}
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5"
                  title="Alert bands: ≥25 medium · ≥50 high · ≥70 urgent">
              ≥50 high · ≥70 urgent
            </span>
          </div>
        </div>

        {/* Row 2 — meta strip + PDF action */}
        <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap mt-1.5">
          <span>{pulse.total_events} events</span>
          <span className="text-slate-300">·</span>
          <span>First {new Date(pulse.first_seen).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
          <span className="text-slate-300">·</span>
          <span>Last {new Date(pulse.last_seen).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
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
            className="ml-auto text-xs font-semibold text-[#06B6D4] border border-[#06B6D4] px-3 py-1 rounded-xl hover:bg-cyan-50 transition-all"
          >
            ⬇ PDF Report
          </button>
        </div>

        {/* Behavioural fingerprint — lead diagnostic. Promoted from a footnote
            to a top-line summary because it answers the staff question "what
            is the longer-term pattern here?" more directly than any single
            signal score does. */}
        {fingerprintLead && (
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-2 text-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">Pattern</span>
            <span className="font-semibold text-slate-700">{fingerprintLead}</span>
            <span className="text-slate-400">· {pulse.fingerprint.event_count} historical event{pulse.fingerprint.event_count !== 1 ? "s" : ""}</span>
          </div>
        )}

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
                {chartRange === "14d" && (
                  <span className="ml-2 text-slate-500 normal-case font-semibold tracking-normal">
                    · {SHAPE_ICON[pulse.trend_shape]} {pulse.trend_shape.replace("_", " ")}
                  </span>
                )}
              </div>
              <div className="flex bg-white rounded-lg border border-slate-200 p-0.5">
                {(["14d", "12w"] as const).map(r => (
                  <button
                    key={r}
                    onClick={() => setChartRange(r)}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                      chartRange === r
                        ? "bg-[#06B6D4] text-white"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {r === "14d" ? "14 days" : "12 weeks"}
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
                  interval={chartRange === "14d" ? 2 : 1}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0", padding: "6px 10px" }}
                  labelStyle={{ fontWeight: 700, marginBottom: 4, color: "#334155" }}
                  itemStyle={{ padding: "1px 0" }}
                  labelFormatter={(label) =>
                    chartRange === "14d" ? label : `Week of ${label}`
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

          {/* Signal bars — compact. Zero-score signals are dilution for staff
              skimming, so they're hidden by default behind a "View all" toggle.
              Remaining signals are sorted descending so the actionable ones
              are at the top. */}
          <div className="bg-slate-50 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Signal Breakdown</div>
              {zeroSignalCount > 0 && (
                <button
                  onClick={() => setShowZeroSignals(v => !v)}
                  className="text-[10px] font-semibold text-slate-500 hover:text-[#06B6D4]"
                >
                  {showZeroSignals
                    ? `Hide ${zeroSignalCount} inactive`
                    : `+ ${zeroSignalCount} inactive`}
                </button>
              )}
            </div>
            <div className="space-y-2.5">
              {visibleSignals.map(sig => {
                const c = sig.score >= 70 ? "#DC2626" : sig.score >= 40 ? "#F59E0B" : sig.score > 0 ? "#10B981" : "#CBD5E1";
                return (
                  <div key={sig.id} className="flex items-center gap-2" title={sig.detail}>
                    <div className="w-36 text-xs text-slate-500 shrink-0">{sig.label}</div>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${sig.score}%`, background: c }} />
                    </div>
                    <div className="text-xs font-bold w-6 text-right shrink-0" style={{ color: c }}>{sig.score}</div>
                  </div>
                );
              })}
              {visibleSignals.length === 0 && (
                <div className="text-xs text-slate-400 italic py-2">All signals quiet in this window.</div>
              )}
            </div>
          </div>

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
  onClose,
  onAcknowledge,
  onDismiss,
  onViewProfile,
  acknowledging,
  dismissing,
}: {
  cluster:      ClusterRow;
  pulsesById:   Map<string, StudentPulseV3>;
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

  const memberPulses = cluster.student_ids
    .map(sid => ({ label: sid, pulse: pulsesById.get(sid) }))
    .filter(m => !!m.pulse);

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

          {/* Anonymised trend arcs side by side */}
          {memberPulses.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Sentiment arcs (last 14 days)</h3>
              <div className="grid grid-cols-2 gap-3">
                {memberPulses.map(({ label, pulse }) => (
                  <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold text-slate-600 mb-1">{label}</p>
                    <div className="h-14">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={pulse!.trend.map((v, i) => ({ i, v }))}>
                          <Line type="monotone" dataKey="v" stroke="#06B6D4" dot={false} strokeWidth={1.5} />
                          <YAxis domain={[0, 100]} hide />
                          <XAxis dataKey="i" hide />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
  onAcknowledge,
  onDismiss,
  onViewProfile,
  acknowledging,
  dismissing,
}: {
  cluster:       ClusterRow;
  pulsesById:    Map<string, StudentPulseV3>;
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

  const memberPulses = cluster.student_ids
    .map(sid => ({ label: sid, pulse: pulsesById.get(sid) }))
    .filter(m => !!m.pulse);

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

        {/* Sentiment arcs */}
        {memberPulses.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Sentiment arcs (last 14 days)</h3>
            <div className="grid grid-cols-2 gap-3">
              {memberPulses.map(({ label, pulse }) => (
                <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold text-slate-600 mb-1">{label}</p>
                  <div className="h-14">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={pulse!.trend.map((v, i) => ({ i, v }))}>
                        <Line type="monotone" dataKey="v" stroke="#06B6D4" dot={false} strokeWidth={1.5} />
                        <YAxis domain={[0, 100]} hide />
                        <XAxis dataKey="i" hide />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ))}
            </div>
          </div>
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
              ? <StudentDetail pulse={selected} events={events} analyses={analyses} snoozes={snoozes} onAcknowledge={acknowledgeSelected} onRequestLLM={requestLLMForSession} feedbackCount={feedbackCountByStudent.get(selected.student_id) ?? 0} />
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
