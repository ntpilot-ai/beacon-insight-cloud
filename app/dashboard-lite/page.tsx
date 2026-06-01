"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { fetchAllEvents } from "@/lib/fetchEvents";
import { useAuth } from "@/lib/useAuth";
import { SCHOOL_ID, SCHOOL_NAME } from "@/lib/config";
import Sidebar from "@/components/Sidebar";
import TrendLine from "@/components/TrendLine";
import PlatformUsage from "@/components/PlatformUsage";
import Link from "next/link";

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

function RiskBreakdownCard({ events }: { events: BeaconEvent[] }) {
  const total  = events.length;
  const high   = events.filter(e => e.risk === "high" || e.risk === "critical").length;
  const medium = events.filter(e => e.risk === "medium").length;
  const low    = events.filter(e => e.risk === "low").length;

  const rows = [
    { label: "High / Critical", count: high,   color: "#DC2626" },
    { label: "Medium",          count: medium, color: "#F59E0B" },
    { label: "Low",             count: low,    color: "#10B981" },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex flex-col">
      <div className="text-sm text-slate-500 font-medium mb-4">Risk Breakdown</div>
      <div className="space-y-2.5 flex-1 flex flex-col justify-center">
        {rows.map(r => (
          <div key={r.label} className="flex items-center gap-2">
            <span className="text-xs text-slate-500 w-24 shrink-0">{r.label}</span>
            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full"
                style={{ width: `${total ? (r.count / total) * 100 : 0}%`, background: r.color }} />
            </div>
            <span className="text-xs font-semibold w-10 text-right" style={{ color: r.color }}>
              {total ? Math.round((r.count / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardLite() {
  const { loading: authLoading, authenticated } = useAuth();
  const [events, setEvents] = useState<BeaconEvent[]>([]);
  const [period, setPeriod] = useState<Period>("term");
  const [live, setLive]     = useState(true);

  async function loadEvents() {
    const data = await fetchAllEvents<BeaconEvent>({ schoolId: SCHOOL_ID, ascending: false });
    setEvents(data);
  }

  useEffect(() => {
    loadEvents();
    const channel = supabase.channel("beacon-live-lite")
      .on("postgres_changes", { event: "*", schema: "public", table: "beacon_events" }, loadEvents)
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

  const totalPrompts = filteredEvents.length;

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
              <h1 className="text-2xl font-bold text-[#06B6D4]">{SCHOOL_NAME} — Insight Lite</h1>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-cyan-100 text-cyan-700">
                Lite
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-0.5">At-a-glance activity overview</p>
          </div>
          <div className="flex items-center gap-3">
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

          <div className="grid grid-cols-3 gap-5">
            <KPICard
              label={`Total Prompts · ${PERIOD_LABELS[period]}`}
              value={totalPrompts.toLocaleString()}
              sub="Across all monitored AI platforms"
              color="#06B6D4"
            />
            <KPICard
              label="Safe Usage Rate"
              value={`${safeUsageRate}%`}
              sub={`${totalPrompts - filteredEvents.filter(e => e.risk !== "low").length} of ${totalPrompts} prompts appropriate`}
              color={safeUsageRate >= 90 ? "#10B981" : safeUsageRate >= 75 ? "#F59E0B" : "#DC2626"}
              large
            />
            <RiskBreakdownCard events={filteredEvents} />
          </div>

          <TrendLine events={filteredEvents} range={range} />

          <PlatformUsage events={filteredEvents} />

        </main>
      </div>
    </div>
  );
}
