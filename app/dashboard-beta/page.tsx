"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { fetchAllEvents } from "@/lib/fetchEvents";
import { useAuth } from "@/lib/useAuth";
import { SCHOOL_ID, SCHOOL_NAME } from "@/lib/config";
import { calculateAllPulses } from "@/lib/pulse_engine";
import Sidebar from "@/components/Sidebar";
import BeaconIntelligence from "@/components/AISummary";
import Link from "next/link";
import TrendLine from "@/components/TrendLine";

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

function getCurrentTerm(): string {
  const now = new Date();
  const current = TERMS.find(t => {
    const s = new Date(t.start);
    const e = new Date(t.end);
    e.setHours(23, 59, 59);
    return now >= s && now <= e && t.label !== "All Time";
  });
  return current?.label ?? "All Time";
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

// ── KPI Card ──────────────────────────────────────────────────────────────────
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

// ── Today's flagged students ───────────────────────────────────────────────────
function TodayPanel({ events, pulses }: { events: BeaconEvent[]; pulses: any[] }) {
  const now       = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const todayEvents = events.filter(e =>
    new Date(e.created_at) >= todayStart &&
    (e.risk === "high" || e.risk === "critical" || e.risk === "medium" || e.blocked)
  );

  // Group by student, keep highest risk
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

  const students = Object.entries(byStudent)
    .sort((a, b) => {
      const riskOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
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

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">Students Needing Attention Today</h2>
          <p className="text-xs text-slate-400 mt-0.5">Medium and high risk activity in the last 24 hours</p>
        </div>
        <span className="text-xs font-bold px-3 py-1 rounded-full bg-red-100 text-red-700">
          {students.length} student{students.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="divide-y divide-slate-50">
        {students.map(([studentId, data]) => {
          const rs        = RISK_STYLE[data.topRisk] ?? RISK_STYLE.medium;
          const pulse     = pulses.find(p => p.student_id === studentId);
          const categories = [...new Set(data.events.map(e => categoryFromMatched(e.matched)))];
          const blocked   = data.events.filter(e => e.blocked).length;
          const platforms = [...new Set(data.events.map(e => e.platform))];

          return (
            <div key={studentId} className={`px-6 py-4 hover:bg-slate-50 transition-colors ${rs.bg} border-l-4`}
              style={{ borderLeftColor: rs.dot }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-bold text-slate-800">{studentId}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${rs.text} bg-white border`}
                      style={{ borderColor: rs.dot }}>
                      {data.topRisk.toUpperCase()}
                    </span>
                    {blocked > 0 && (
                      <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                        {blocked} blocked
                      </span>
                    )}
                    {pulse && (
                      <span className="text-xs text-slate-400">
                        Pulse: <span className="font-semibold" style={{ color: rs.dot }}>{pulse.pulse_score}</span>
                        {" "}{pulse.trend_direction === "rising" ? "↑" : pulse.trend_direction === "falling" ? "↓" : "→"}
                      </span>
                    )}
                  </div>

                  {/* Most recent prompts */}
                  <div className="space-y-1.5">
                    {data.events.slice(0, 3).map((event, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: rs.dot }} />
                        <span className="text-sm text-slate-600 truncate flex-1">{event.prompt}</span>
                        <span className="text-xs text-slate-400 shrink-0">
                          {new Date(event.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ))}
                    {data.events.length > 3 && (
                      <div className="text-xs text-slate-400 ml-3.5">+{data.events.length - 3} more incidents</div>
                    )}
                  </div>
                </div>

                {/* Right meta */}
                <div className="text-right shrink-0 space-y-1">
                  <div className="text-xs text-slate-400">{categories.slice(0, 2).join(", ")}</div>
                  <div className="text-xs text-slate-400">{platforms.join(", ")}</div>
                  <Link href="/pulse" className="text-xs font-semibold text-[#06B6D4] hover:underline">
                    View in Pulse →
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Collapsible overview ──────────────────────────────────────────────────────
function OverviewSection({ events, term, setTerm }: {
  events: BeaconEvent[]; term: string; setTerm: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // Anchor the trend chart to the end of the selected term (clamped to today),
  // so "last 7 days" reflects the visible term, not wall-clock today.
  const trendAnchor = useMemo(() => {
    const t = TERMS.find(t => t.label === term) ?? TERMS[0];
    const termEnd = new Date(t.end);
    termEnd.setHours(23, 59, 59);
    const now = new Date();
    return termEnd < now ? termEnd : now;
  }, [term]);

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
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-700">Term Overview</span>
          <select
            value={term}
            onChange={e => { e.stopPropagation(); setTerm(e.target.value); }}
            onClick={e => e.stopPropagation()}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1 text-slate-500 bg-white focus:outline-none"
          >
            {TERMS.map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
          </select>
        </div>
        <span className="text-slate-400 text-sm">{open ? "▲ Hide" : "▼ Show details"}</span>
      </button>

      {open && (
        <div className="px-6 pb-6 border-t border-slate-100">

          {/* Mini KPIs */}
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

          {/* Activity trend chart */}
          <div className="mb-6">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Activity Trend</div>
            <TrendLine events={events} anchor={trendAnchor} />
          </div>

          {/* Risk breakdown + Platform side by side */}
          <div className="grid grid-cols-2 gap-6">

            {/* Risk breakdown first */}
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

            {/* Platform usage second */}
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

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DashboardV2() {
  const { loading: authLoading, authenticated } = useAuth();
  const [events, setEvents] = useState<BeaconEvent[]>([]);
  const [term, setTerm]     = useState(getCurrentTerm);
  const [live, setLive]     = useState(true);

  async function loadEvents() {
    const data = await fetchAllEvents<BeaconEvent>({ schoolId: SCHOOL_ID, ascending: false });
    setEvents(data);
  }

  useEffect(() => {
    loadEvents();
    const channel = supabase.channel("beacon-live-v2")
      .on("postgres_changes", { event: "*", schema: "public", table: "beacon_events" }, loadEvents)
      .subscribe(s => setLive(s === "SUBSCRIBED"));
    return () => { supabase.removeChannel(channel); };
  }, []);

  const filteredEvents = useMemo(() => {
    const t = TERMS.find(t => t.label === term) ?? TERMS[0];
    const s = new Date(t.start), e = new Date(t.end);
    e.setHours(23, 59, 59);
    return events.filter(ev => { const d = new Date(ev.created_at); return d >= s && d <= e; });
  }, [events, term]);

  const pulses = useMemo(() => calculateAllPulses(events), [events]);

  // KPI calculations
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

        {/* Header */}
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
              ← Switch to Release Version
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

          {/* Zone 1 — Beacon Intelligence */}
          <BeaconIntelligence events={filteredEvents} schoolName={SCHOOL_NAME} />

          {/* Zone 2 — 3 KPIs */}
          <div className="grid grid-cols-3 gap-5">
            <KPICard
              label="Total Prompts This Term"
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

          {/* Zone 3 — Students needing attention today */}
          <TodayPanel events={events} pulses={pulses} />

          {/* Zone 4 — Collapsible term overview */}
          <OverviewSection events={filteredEvents} term={term} setTerm={setTerm} />

        </main>
      </div>
    </div>
  );
}
