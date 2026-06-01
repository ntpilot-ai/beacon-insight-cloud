"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { fetchAllEvents } from "@/lib/fetchEvents";
import { useAuth } from "@/lib/useAuth";
import { SCHOOL_ID, SCHOOL_NAME } from "@/lib/config";
import {
  calculateAllPulsesV3,
  type PulseAcknowledgement,
} from "@/lib/pulse_engine_v3";
import { evaluatePulseEligibility } from "@/lib/promotion";
import Sidebar from "@/components/Sidebar";
import BeaconIntelligence from "@/components/AISummary";
import Link from "next/link";
import TrendLine from "@/components/TrendLine";
import { ShieldAlert, Activity, ArrowRight } from "lucide-react";

// Use the engine's PulseAcknowledgement type so calculateAllPulsesV3 gets
// every field it reads from acks. loadPulseStatus must select * to match.

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

// ── Queue summary cards (replaces TodayPanel) ─────────────────────────────
// Two-up summary of the Aegis and Pulse queues. Each card = current student
// count + link to the page. Aegis = unique students with unreviewed flagged
// events in the last 7 days (matches the Aegis page's default window).
// Pulse = students currently on the Pulse queue (eligibility via
// evaluatePulseEligibility, same rule the Pulse page uses).
//
// Visual treatment: navigable cards (whole card is the link, light hover
// lift), large count, icon matching the sidebar nav, "View →" affordance.

function QueueSummaryCard({
  title,
  href,
  count,
  Icon,
  accent,
  iconBg,
  hint,
}: {
  title:  string;
  href:   string;
  count:  number;
  Icon:   typeof ShieldAlert;
  accent: string;
  iconBg: string;
  hint:   string;
}) {
  const pluralised = count === 1 ? "student" : "students";
  return (
    <Link
      href={href}
      className="group bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex items-center gap-5 hover:shadow-md hover:border-slate-200 transition-all"
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0`} style={{ background: iconBg, color: accent }}>
        <Icon size={24} strokeWidth={1.75} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-500 font-medium">{title}</div>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-4xl font-bold leading-none" style={{ color: accent }}>
            {count.toLocaleString()}
          </span>
          <span className="text-sm text-slate-400 font-medium">{pluralised}</span>
        </div>
        <div className="text-xs text-slate-400 mt-1.5">{hint}</div>
      </div>

      <div className="text-xs font-semibold text-slate-400 group-hover:text-slate-700 transition-colors flex items-center gap-1 shrink-0">
        View
        <ArrowRight size={14} strokeWidth={2} className="group-hover:translate-x-0.5 transition-transform" />
      </div>
    </Link>
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

export default function Dashboard() {
  const { loading: authLoading, authenticated } = useAuth();
  const [events, setEvents]   = useState<BeaconEvent[]>([]);
  const [acks, setAcks]       = useState<PulseAcknowledgement[]>([]);
  const [snoozes, setSnoozes] = useState<DashboardSnooze[]>([]);
  const [period, setPeriod]   = useState<Period>("term");
  const [live, setLive]       = useState(true);

  async function loadEvents() {
    const data = await fetchAllEvents<BeaconEvent>({ schoolId: SCHOOL_ID, ascending: false });
    setEvents(data);
  }

  async function loadPulseStatus() {
    // v3 engine reads multiple fields (alert_level, dominant_category,
    // action_taken, expires_at, etc.); fetch the full row. Drop the
    // 7-day time filter — Pulse eligibility needs the full ack history to
    // correctly identify escalated/referred students.
    const [acksRes, snoozesRes] = await Promise.all([
      supabase
        .from("pulse_acknowledgements")
        .select("*")
        .eq("school_id", SCHOOL_ID)
        .order("acknowledged_at", { ascending: false }),
      supabase
        .from("pulse_snooze")
        .select("student_id,expires_at,broken_early")
        .eq("school_id", SCHOOL_ID)
        .eq("broken_early", false),
    ]);
    if (acksRes.data)    setAcks(acksRes.data as PulseAcknowledgement[]);
    if (snoozesRes.data) setSnoozes(snoozesRes.data as DashboardSnooze[]);
  }

  useEffect(() => {
    loadEvents();
    loadPulseStatus();
    const channel = supabase.channel("beacon-live")
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

  // ── Aegis queue count ────────────────────────────────────────────────
  // Mirrors the Aegis page's default view: events in the last 7 days that
  // are flagged (medium/high/critical OR blocked) and are NOT covered by a
  // later ack for the same student. Count = unique students with ≥1 such
  // event. Aegis's session-local "dismiss" is intentionally not modelled
  // here — the dashboard shows the server-truth queue, not one DSL's
  // session.
  const aegisStudentCount = useMemo(() => {
    const cutoff = Date.now() - 7 * 86400000;

    // Latest ack timestamp per student — events older than this are
    // considered reviewed.
    const latestAckByStudent = new Map<string, number>();
    for (const a of acks) {
      const t   = new Date(a.acknowledged_at).getTime();
      const cur = latestAckByStudent.get(a.student_id) ?? 0;
      if (t > cur) latestAckByStudent.set(a.student_id, t);
    }

    const studentIds = new Set<string>();
    for (const e of events) {
      if (e.risk === "low" && !e.blocked)               continue;
      const ts = new Date(e.created_at).getTime();
      if (ts < cutoff)                                  continue;
      const latestAck = latestAckByStudent.get(e.student_id);
      if (latestAck !== undefined && ts <= latestAck)   continue;
      studentIds.add(e.student_id);
    }
    return studentIds.size;
  }, [events, acks]);

  // ── Pulse queue count ────────────────────────────────────────────────
  // Mirrors the Pulse page's eligibility logic: v3 engine output filtered
  // via evaluatePulseEligibility. Includes snoozed students — they still
  // appear on the Pulse page (in a separate band), so they count toward
  // "students currently on Pulse." No term context is passed; the engine
  // falls back to unbounded computation, same fallback the Pulse page
  // hits when the term-context fetch fails.
  const pulseStudentCount = useMemo(() => {
    const pulsesV3 = calculateAllPulsesV3(events, acks);

    const eventsByStudent = new Map<string, BeaconEvent[]>();
    for (const e of events) {
      const list = eventsByStudent.get(e.student_id);
      if (list) list.push(e);
      else      eventsByStudent.set(e.student_id, [e]);
    }

    const escalationAckSet = new Set<string>();
    for (const a of acks) {
      if (a.action_taken === "escalated" || a.action_taken === "referred") {
        escalationAckSet.add(a.student_id);
      }
    }

    let count = 0;
    for (const p of pulsesV3) {
      const elig = evaluatePulseEligibility({
        pulse:            p,
        events:           eventsByStudent.get(p.student_id) ?? [],
        hasEscalationAck: escalationAckSet.has(p.student_id),
      });
      if (elig.appearsInPulse) count++;
    }
    return count;
  }, [events, acks]);

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
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
                Release
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-0.5">Safeguarding intelligence · Focused view</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard-beta"
              className="text-xs font-semibold text-slate-500 border border-slate-200 px-4 py-2 rounded-xl hover:border-[#06B6D4] hover:text-[#06B6D4] transition-all"
            >
              Try Beta Version →
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

          {/* Queue summary — two-up "what's on each list" KPIs that link
              into the Aegis and Pulse pages. Replaces the older TodayPanel
              row-level view; the row-level read now lives entirely on the
              Aegis page. */}
          <div className="grid grid-cols-2 gap-5">
            <QueueSummaryCard
              title="Students on Aegis"
              href="/aegis-beta"
              count={aegisStudentCount}
              Icon={ShieldAlert}
              accent="#DC2626"
              iconBg="#FEF2F2"
              hint="Unreviewed flagged events · last 7 days"
            />
            <QueueSummaryCard
              title="Students on Pulse"
              href="/pulse-beta"
              count={pulseStudentCount}
              Icon={Activity}
              accent="#06B6D4"
              iconBg="#ECFEFF"
              hint="Pattern, severity, or manual escalation"
            />
          </div>

          <OverviewSection events={filteredEvents} period={period} setPeriod={setPeriod} range={range} />

        </main>
      </div>
    </div>
  );
}
