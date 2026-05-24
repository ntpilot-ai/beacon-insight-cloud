"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
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
  const [term, setTerm]     = useState(getCurrentTerm);
  const [live, setLive]     = useState(true);

  async function loadEvents() {
    const { data } = await supabase
      .from("beacon_events")
      .select("*")
      .eq("school_id", SCHOOL_ID)
      .order("created_at", { ascending: false });
    setEvents((data as BeaconEvent[]) || []);
  }

  useEffect(() => {
    loadEvents();
    const channel = supabase.channel("beacon-live-lite")
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
            <select
              value={term}
              onChange={e => setTerm(e.target.value)}
              className="text-xs border border-slate-200 rounded-xl px-3 py-2 text-slate-500 bg-white focus:outline-none"
            >
              {TERMS.map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
            </select>
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
              label="Total Prompts This Term"
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

          <TrendLine events={filteredEvents} />

          <PlatformUsage events={filteredEvents} />

        </main>
      </div>
    </div>
  );
}
