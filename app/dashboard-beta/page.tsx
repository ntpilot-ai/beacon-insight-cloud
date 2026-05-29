"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { fetchAllEvents } from "@/lib/fetchEvents";
import { useAuth } from "@/lib/useAuth";
import { SCHOOL_ID, SCHOOL_NAME } from "@/lib/config";
import { calculateAllPulses } from "@/lib/pulse_engine";
import { deriveStudentStatus, STATUS_STYLE, type StudentStatus } from "@/lib/student_status";
import Sidebar from "@/components/Sidebar";
import BeaconIntelligence from "@/components/AISummary";
import Link from "next/link";
import TrendLine from "@/components/TrendLine";

interface DashboardAck {
  student_id:     string;
  acknowledged_at: string;
  action_taken:   string;
}

interface DashboardSnooze {
  student_id: string;
  expires_at: string | null;
  broken_early: boolean;
}

interface BeaconEvent {
  id:         number;
  created_at: string;
  student_id: string;
  school_id:  string;
  platform:   string;
  prompt:     string;
  risk:       string;
  blocked:    boolean;
  matched:    string[];
  hostname:   string;
}

const TERMS = [
  { label: "Summer Term 2026", start: "2026-04-14", end: "2026-07-18" },
  { label: "Spring Term 2026", start: "2026-01-05", end: "2026-04-04" },
  { label: "Autumn Term 2025", start: "2025-09-02", end: "2025-12-19" },
  { label: "All Time",         start: "2000-01-01", end: "2099-12-31" },
];

type Period = "7d" | "term" | "year";

const PERIOD_LABELS: Record<Period, string> = {
  "7d":   "7 Days",
  term:   "This Term",
  year:   "Academic Year",
};

function getPeriodRange(period: Period, now: Date = new Date()): { start: Date; end: Date } {
  if (period === "7d") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);
    return { start, end: now };
  }
  if (period === "term") {
    const current = TERMS.find(t => {
      if (t.label === "All Time") return false;
      const s = new Date(t.start);
      const e = new Date(t.end);
      e.setHours(23, 59, 59);
      return now >= s && now <= e;
    });
    if (current) {
      const e = new Date(current.end);
      e.setHours(23, 59, 59);
      return { start: new Date(current.start), end: e };
    }
    // Between-term fallback: nearest 90 days
    const start = new Date(now);
    start.setDate(start.getDate() - 90);
    return { start, end: now };
  }
  // Academic year: Sep 1 → Aug 31, anchored on the autumn-term start year
  const month = now.getMonth();
  const startYear = month >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const start = new Date(startYear, 8, 1);
  const end = new Date(startYear + 1, 7, 31);
  end.setHours(23, 59, 59);
  return { start, end };
}

const RISK_STYLE: Record<string, { dot: string; text: string; bg: string }> = {
  high:     { dot: "#DC2626", text: "text-red-600",    bg: "bg-red-50"    },
  critical: { dot: "#7C3AED", text: "text-purple-600", bg: "bg-purple-50" },
  medium:   { dot: "#F59E0B", text: "text-amber-600",  bg: "bg-amber-50"  },
};

function categoryFromMatched(matched: string[]): string {
  if (!matched?.length) return "General";
  const m = matched.join(" ").toLowerCase();
  if (m.includes("jailbreak") || m.includes("ignore") || m.includes("dan") || m.includes("bypass")) return "Jailbreak Attempt";
  if (m.includes("harm") || m.includes("suicide")) return "Self-harm";
  if (m.includes("bully") || m.includes("threaten")) return "Bullying";
  if (m.includes("weapon") || m.includes("violen") || m.includes("shank")) return "Violence";
  if (m.includes("sex") || m.includes("explicit") || m.includes("adult") || m.includes("porn")) return "Inappropriate Content";
  if (m.includes("drug") || m.includes("alcohol") || m.includes("weed")) return "Substance";
  return "General";
}

function KPICard({ label, value, sub, color, large }: {
  label: string; value: string | number; sub?: string; color: string; large?: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex flex-col justify-between">
      <div className="text-sm text-slate-500 font-medium">{label}</div>
      <div className={`font-bold leading-none mt-3 ${large ? "text-5xl" : "text-4xl"}`} style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-xs text-slate-400 mt-2">{sub}</div>}
    </div>
  );
}

const ACK_ACTION_BADGE: Record<string, { label: string; cls: string }> = {
  monitored: { label: "Monitored",  cls: "bg-slate-100 text-slate-600"   },
  referred:  { label: "Referred",   cls: "bg-amber-100 text-amber-700"   },
  escalated: { label: "Escalated",  cls: "bg-red-100 text-red-700"       },
  no_action: { label: "Reviewed",   cls: "bg-slate-100 text-slate-600"   },
};

// ── Recent Safeguarding Events widget (beta-only, Phase 4.5) ─────────────────
// Simplified top-layer triage view, modelled on the original concept-deck
// table. Answers "what's on my list to action today?" with the verb-set a
// DSL actually uses: Status (Escalated / In Review / Monitoring / New),
// with severity as a secondary signal rather than the headline.
//
// Sits ABOVE the more verbose TodayPanel — they're intentionally side-by-
// side during this iteration so we can see which one staff actually use.
// TodayPanel may be retired if this widget covers the use case.
//
// Beta-only: the project's A/B convention is to iterate on dashboard-beta
// first, then promote to release (app/page.tsx) once the shape is settled.

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-indigo-500",
  high:     "bg-red-500",
  medium:   "bg-amber-500",
  low:      "bg-emerald-500",
};
const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high:     "High",
  medium:   "Medium",
  low:      "Low",
};

interface RecentEventRow {
  studentId:  string;
  category:   string;
  severity:   string;
  status:     StudentStatus;
  lastSeen:   string;
  pulseScore: number;
}

function RecentSafeguardingEvents({
  events,
  pulses,
  acks,
  snoozes,
  maxRows = 8,
}: {
  events:  BeaconEvent[];
  pulses:  any[];
  acks:    DashboardAck[];
  snoozes: DashboardSnooze[];
  maxRows?: number;
}) {
  // One row per student with flagged activity in the last 7 days. Severity
  // = current pulse alert_level (which already factors in trend + recency).
  // Category = dominant category from their last 14 days of flagged events.
  // Status = derived from acks + snoozes via the shared helper.
  const rows: RecentEventRow[] = useMemo(() => {
    const cutoff = Date.now() - 7 * 86400000;
    const recentFlagged = events.filter(e =>
      new Date(e.created_at).getTime() >= cutoff &&
      (e.risk === "high" || e.risk === "critical" || e.risk === "medium" || e.blocked),
    );

    const byStudent: Record<string, BeaconEvent[]> = {};
    recentFlagged.forEach(e => {
      if (!byStudent[e.student_id]) byStudent[e.student_id] = [];
      byStudent[e.student_id].push(e);
    });

    return Object.keys(byStudent).map(studentId => {
      const studentEvents = byStudent[studentId];
      const pulse         = pulses.find(p => p.student_id === studentId);

      // Dominant category: most frequent across this student's flagged events.
      const catCounts: Record<string, number> = {};
      studentEvents.forEach(e => {
        const c = categoryFromMatched(e.matched);
        if (c !== "General") catCounts[c] = (catCounts[c] || 0) + 1;
      });
      const category = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "General";

      const severity = pulse?.alert_level ?? "medium";
      const status   = deriveStudentStatus({
        studentId,
        firstSeen: pulse?.first_seen,
        acks,
        snoozes,
      });

      const lastSeen = studentEvents.reduce(
        (latest, e) => new Date(e.created_at).getTime() > new Date(latest).getTime() ? e.created_at : latest,
        studentEvents[0].created_at,
      );

      return {
        studentId,
        category,
        severity,
        status,
        lastSeen,
        pulseScore: pulse?.pulse_score ?? 0,
      };
    })
    // Sort by status weight (escalated first), then severity, then pulse score
    .sort((a, b) => {
      const statusOrder: Record<StudentStatus, number> = {
        escalated: 0, in_review: 1, new: 2, monitoring: 3, closed: 4,
      };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      if (sevOrder[a.severity] !== sevOrder[b.severity]) {
        return (sevOrder[a.severity] ?? 4) - (sevOrder[b.severity] ?? 4);
      }
      return b.pulseScore - a.pulseScore;
    });
  }, [events, pulses, acks, snoozes]);

  const visible = rows.slice(0, maxRows);
  const hidden  = Math.max(0, rows.length - visible.length);

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h2 className="font-bold text-slate-800">Recent Safeguarding Events</h2>
        <p className="text-xs text-slate-400 mt-0.5 mb-4">AI-flagged incidents requiring review or follow-up</p>
        <div className="text-center text-sm text-slate-400 py-4">
          No flagged activity in the last 7 days.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">Recent Safeguarding Events</h2>
          <p className="text-xs text-slate-400 mt-0.5">AI-flagged incidents requiring review or follow-up</p>
        </div>
        <Link
          href="/pulse-beta"
          className="text-xs font-semibold text-[#06B6D4] hover:underline whitespace-nowrap"
        >
          View all events →
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60">
            <tr className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <th className="px-6 py-2.5">Student</th>
              <th className="px-3 py-2.5">Category</th>
              <th className="px-3 py-2.5">Severity</th>
              <th className="px-6 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map(row => {
              const sev = STATUS_STYLE[row.status];
              return (
                <tr key={row.studentId} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-6 py-3">
                    <Link
                      href={`/pulse-beta?student=${encodeURIComponent(row.studentId)}`}
                      className="font-semibold text-slate-700 hover:text-[#06B6D4] transition-colors"
                    >
                      {row.studentId}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{row.category}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-2 text-slate-600">
                      <span className={`w-2 h-2 rounded-full ${SEVERITY_DOT[row.severity] ?? SEVERITY_DOT.medium}`} />
                      {SEVERITY_LABEL[row.severity] ?? row.severity}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sev.chip}`}>
                      {sev.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hidden > 0 && (
        <div className="px-6 py-2.5 border-t border-slate-100 bg-slate-50/60 text-[11px] text-slate-500">
          + {hidden} more {hidden === 1 ? "student" : "students"} with flagged activity this week
        </div>
      )}
    </div>
  );
}

function TodayPanel({
  events,
  pulses,
  acks,
  snoozes,
}: {
  events:  BeaconEvent[];
  pulses:  any[];
  acks:    DashboardAck[];
  snoozes: DashboardSnooze[];
}) {
  const now       = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const todayEvents = events.filter(e =>
    new Date(e.created_at) >= todayStart &&
    (e.risk === "high" || e.risk === "critical" || e.risk === "medium" || e.blocked)
  );

  const byStudent: Record<string, { events: BeaconEvent[]; topRisk: string; lastSeen: string }> = {};
  todayEvents.forEach(e => {
    if (!byStudent[e.student_id]) {
      byStudent[e.student_id] = { events: [], topRisk: "medium", lastSeen: e.created_at };
    }
    byStudent[e.student_id].events.push(e);
    const riskOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    if ((riskOrder[e.risk] || 0) > (riskOrder[byStudent[e.student_id].topRisk] || 0)) {
      byStudent[e.student_id].topRisk = e.risk;
    }
    if (new Date(e.created_at) > new Date(byStudent[e.student_id].lastSeen)) {
      byStudent[e.student_id].lastSeen = e.created_at;
    }
  });

  const nowMs = Date.now();
  const activeSnoozeSet = new Set(
    snoozes
      .filter(s => !s.broken_early && (!s.expires_at || new Date(s.expires_at).getTime() > nowMs))
      .map(s => s.student_id)
  );
  const ackedSet = new Set(acks.map(a => a.student_id));

  const students = Object.entries(byStudent)
    .sort((a, b) => {
      const riskOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      const statusA = activeSnoozeSet.has(a[0]) ? 2 : ackedSet.has(a[0]) ? 1 : 0;
      const statusB = activeSnoozeSet.has(b[0]) ? 2 : ackedSet.has(b[0]) ? 1 : 0;
      if (statusA !== statusB) return statusA - statusB;
      return (riskOrder[b[1].topRisk] || 0) - (riskOrder[a[1].topRisk] || 0);
    });

  if (students.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center">
        <div className="text-3xl mb-3">✅</div>
        <div className="font-semibold text-slate-700">No flagged activity today</div>
        <div className="text-sm text-slate-400 mt-1">All student AI usage is within normal parameters</div>
      </div>
    );
  }

  const riskOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">Students Needing Attention Today</h2>
          <p className="text-xs text-slate-400 mt-0.5">Medium and high risk activity in the last 24 hours</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold px-3 py-1 rounded-full bg-red-100 text-red-700">
            {students.length} student{students.length !== 1 ? "s" : ""}
          </span>
          <Link
            href="/pulse-beta"
            className="text-xs font-semibold text-[#06B6D4] border border-[#06B6D4] px-3 py-1 rounded-full hover:bg-cyan-50 transition-colors"
          >
            View Pulse Queue →
          </Link>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {students.map(([studentId, data]) => {
          const rs       = RISK_STYLE[data.topRisk] ?? RISK_STYLE.medium;
          const pulse    = pulses.find(p => p.student_id === studentId);
          const blocked  = data.events.filter(e => e.blocked).length;

          const now = Date.now();
          const activeSnooze = snoozes.find(s =>
            s.student_id === studentId &&
            !s.broken_early &&
            (!s.expires_at || new Date(s.expires_at).getTime() > now),
          );
          const recentAck = acks
            .filter(a => a.student_id === studentId)
            .sort((a, b) => new Date(b.acknowledged_at).getTime() - new Date(a.acknowledged_at).getTime())[0];

          const latestTime = new Date(data.lastSeen).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
          const trendArrow = pulse?.trend_direction === "rising"  ? "↑"
                           : pulse?.trend_direction === "falling" ? "↓"
                           : "→";

          const rowBg    = activeSnooze ? "bg-cyan-50/40"
                         : recentAck    ? "bg-emerald-50/40"
                         : "";
          const borderColor = activeSnooze ? "#06B6D4" : recentAck ? "#10B981" : rs.dot;

          return (
            <div key={studentId}
              className={`px-5 py-2.5 border-l-4 transition-colors hover:brightness-95 ${rowBg}`}
              style={{ borderLeftColor: borderColor }}>

              <div className="flex items-center gap-x-3 gap-y-1 min-w-0 flex-wrap">
                <span className="font-bold text-slate-800 break-all">{studentId}</span>
                <span className={`text-[11px] font-bold tracking-wide ${rs.text}`}>
                  {data.topRisk.toUpperCase()}
                </span>
                {pulse && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full border border-slate-200 bg-white" style={{ color: rs.dot }}>
                    Pulse {pulse.pulse_score} {trendArrow}
                  </span>
                )}
                {activeSnooze && (
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700">
                    💤 Snoozed in Pulse
                  </span>
                )}
                {!activeSnooze && recentAck && (
                  <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${ACK_ACTION_BADGE[recentAck.action_taken]?.cls ?? "bg-emerald-100 text-emerald-700"}`}>
                    ✓ {ACK_ACTION_BADGE[recentAck.action_taken]?.label ?? "Reviewed"}
                  </span>
                )}
                <span className="text-xs text-slate-400 flex items-center gap-2">
                  <span><span className="font-semibold text-slate-600">{data.events.length}</span> incident{data.events.length !== 1 ? "s" : ""}</span>
                  {blocked > 0 && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span><span className="font-semibold text-red-600">{blocked}</span> blocked</span>
                    </>
                  )}
                  <span className="text-slate-300">·</span>
                  <span>latest {latestTime}</span>
                </span>
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}

function OverviewSection({ events, period, setPeriod, range }: {
  events: BeaconEvent[];
  period: Period;
  setPeriod: (p: Period) => void;
  range: { start: Date; end: Date };
}) {
  const [open, setOpen] = useState(true);

  const total    = events.length;
  const high     = events.filter(e => e.risk === "high" || e.risk === "critical").length;
  const medium   = events.filter(e => e.risk === "medium").length;
  const low      = events.filter(e => e.risk === "low").length;
  const blocked  = events.filter(e => e.blocked).length;

  const platformMap: Record<string, number> = {};
  events.forEach(e => { platformMap[e.platform || "unknown"] = (platformMap[e.platform || "unknown"] || 0) + 1; });
  const platforms = Object.entries(platformMap).sort((a, b) => b[1] - a[1]);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="w-full px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOpen(o => !o)}
            className="font-semibold text-slate-700 hover:text-slate-900 transition-colors"
          >
            Term Overview
          </button>
          <div className="flex gap-1 bg-slate-100 rounded-full p-1">
            {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  period === p
                    ? "bg-[#06B6D4] text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          className="text-slate-400 text-sm hover:text-slate-600 transition-colors"
        >
          {open ? "▲ Hide" : "▼ Show details"}
        </button>
      </div>

      {open && (
        <div className="px-6 pb-6 border-t border-slate-100">

          <div className="grid grid-cols-4 gap-4 mt-4 mb-6">
            {[
              { label: "Total Prompts",  value: total,   color: "#06B6D4" },
              { label: "High Risk",      value: high,    color: "#DC2626" },
              { label: "Medium Risk",    value: medium,  color: "#F59E0B" },
              { label: "Blocked",        value: blocked, color: "#7C3AED" },
            ].map(k => (
              <div key={k.label} className="text-center bg-slate-50 rounded-xl p-4">
                <div className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</div>
                <div className="text-xs text-slate-400 mt-1">{k.label}</div>
              </div>
            ))}
          </div>

          <div className="mb-6">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Activity Trend</div>
            <TrendLine events={events} range={range} />
          </div>

          <div className="grid grid-cols-2 gap-6">

            <div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Risk Breakdown</div>
              <div className="space-y-2">
                {[
                  { label: "High / Critical", count: high,   color: "#DC2626" },
                  { label: "Medium",          count: medium, color: "#F59E0B" },
                  { label: "Low",             count: low,    color: "#10B981" },
                ].map(r => (
                  <div key={r.label} className="flex items-center gap-3">
                    <span className="text-sm text-slate-600 w-32">{r.label}</span>
                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full"
                        style={{ width: `${total ? (r.count / total) * 100 : 0}%`, background: r.color }} />
                    </div>
                    <span className="text-xs text-slate-400 w-10 text-right">
                      {total ? Math.round((r.count / total) * 100) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Platform Usage</div>
              <div className="space-y-2">
                {platforms.map(([name, count]) => (
                  <div key={name} className="flex items-center gap-3">
                    <span className="text-sm text-slate-600 w-36 truncate">{name}</span>
                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full bg-[#06B6D4]"
                        style={{ width: `${(count / total) * 100}%` }} />
                    </div>
                    <span className="text-xs text-slate-400 w-8 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardBeta() {
  const { loading: authLoading, authenticated } = useAuth();
  const [events, setEvents]   = useState<BeaconEvent[]>([]);
  const [acks, setAcks]       = useState<DashboardAck[]>([]);
  const [snoozes, setSnoozes] = useState<DashboardSnooze[]>([]);
  const [period, setPeriod]   = useState<Period>("term");
  const [live, setLive]       = useState(true);

  async function loadEvents() {
    const data = await fetchAllEvents<BeaconEvent>({ schoolId: SCHOOL_ID, ascending: false });
    setEvents(data);
  }

  async function loadPulseStatus() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [acksRes, snoozesRes] = await Promise.all([
      supabase
        .from("pulse_acknowledgements")
        .select("student_id,acknowledged_at,action_taken")
        .eq("school_id", SCHOOL_ID)
        .gte("acknowledged_at", sevenDaysAgo)
        .order("acknowledged_at", { ascending: false }),
      supabase
        .from("pulse_snooze")
        .select("student_id,expires_at,broken_early")
        .eq("school_id", SCHOOL_ID)
        .eq("broken_early", false),
    ]);
    if (acksRes.data)    setAcks(acksRes.data as DashboardAck[]);
    if (snoozesRes.data) setSnoozes(snoozesRes.data as DashboardSnooze[]);
  }

  useEffect(() => {
    loadEvents();
    loadPulseStatus();
    const channel = supabase.channel("beacon-live-beta")
      .on("postgres_changes", { event: "*", schema: "public", table: "beacon_events" }, loadEvents)
      .on("postgres_changes", { event: "*", schema: "public", table: "pulse_acknowledgements" }, loadPulseStatus)
      .on("postgres_changes", { event: "*", schema: "public", table: "pulse_snooze" }, loadPulseStatus)
      .subscribe(s => setLive(s === "SUBSCRIBED"));
    return () => { supabase.removeChannel(channel); };
  }, []);

  const range = useMemo(() => getPeriodRange(period), [period]);

  const filteredEvents = useMemo(() => {
    return events.filter(ev => {
      const d = new Date(ev.created_at);
      return d >= range.start && d <= range.end;
    });
  }, [events, range]);

  const pulses = useMemo(() => calculateAllPulses(events), [events]);

  const totalPrompts = filteredEvents.length;
  const blockedToday = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return events.filter(e => e.blocked && new Date(e.created_at) >= today).length;
  }, [events]);

  const safeUsageRate = totalPrompts > 0
    ? Math.round(((totalPrompts - filteredEvents.filter(e => e.risk !== "low").length) / totalPrompts) * 100)
    : 100;

  if (authLoading || !authenticated) return null;

  return (
    <div className="flex min-h-screen bg-[#F0F2F8]">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">

        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-[#06B6D4]">{SCHOOL_NAME} — Insight Dashboard</h1>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                Beta
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-0.5">Safeguarding intelligence · Focused view</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-xs font-semibold text-slate-500 border border-slate-200 px-4 py-2 rounded-xl hover:border-[#06B6D4] hover:text-[#06B6D4] transition-all"
            >
              ← Release Version
            </Link>
            <button onClick={loadEvents} title="Refresh"
              className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-400 hover:text-[#06B6D4] transition-all">
              ↺
            </button>
            <div className={`flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full ${live ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
              {live ? "LIVE" : "Offline"}
            </div>
          </div>
        </header>

        <main className="flex-1 p-6 space-y-5 overflow-auto">

          <BeaconIntelligence events={filteredEvents} schoolName={SCHOOL_NAME} />

          <div className="grid grid-cols-3 gap-5">
            <KPICard
              label={`Total Prompts · ${PERIOD_LABELS[period]}`}
              value={totalPrompts.toLocaleString()}
              sub={`Across all monitored AI platforms`}
              color="#06B6D4"
            />
            <KPICard
              label="Safe Usage Rate"
              value={`${safeUsageRate}%`}
              sub={`${totalPrompts - filteredEvents.filter(e => e.risk !== "low").length} of ${totalPrompts} prompts appropriate`}
              color={safeUsageRate >= 90 ? "#10B981" : safeUsageRate >= 75 ? "#F59E0B" : "#DC2626"}
              large
            />
            <KPICard
              label="Blocked Today"
              value={blockedToday}
              sub={`Prompts stopped by Beacon today`}
              color={blockedToday === 0 ? "#10B981" : blockedToday > 5 ? "#DC2626" : "#F59E0B"}
            />
          </div>

          {/* TodayPanel leads — it's the per-event "what's happened in the
              last 24h" view and surfaces the most-urgent recent activity at
              row level. */}
          <TodayPanel events={events} pulses={pulses} acks={acks} snoozes={snoozes} />

          {/* Recent Safeguarding Events sits below — concept-deck-style table
              with workflow Status as the primary verb. Provides the
              caseload-level read across the last 7 days, complementing
              TodayPanel's tighter 24h focus. */}
          <RecentSafeguardingEvents events={events} pulses={pulses} acks={acks} snoozes={snoozes} />

          <OverviewSection events={filteredEvents} period={period} setPeriod={setPeriod} range={range} />

        </main>
      </div>
    </div>
  );
}
