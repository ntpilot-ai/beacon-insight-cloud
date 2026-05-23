"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { SCHOOL_ID, SCHOOL_NAME } from "@/lib/config";
import { useAuth } from "@/lib/useAuth";

import Sidebar from "@/components/Sidebar";
import KPIGrid from "@/components/KPIGrid";
import EventsTable from "@/components/EventsTable";
import RiskBreakdown from "@/components/RiskBreakdown";
import TrendLine from "@/components/TrendLine";
import RepeatIncidents from "@/components/RepeatIncidents";
import PlatformUsage from "@/components/PlatformUsage";
import BeaconIntelligence from "@/components/AISummary";
import PulseMini from "@/components/PulseMini";

interface BeaconEvent {
  id: number;
  created_at: string;
  student_id: string;
  school_id: string;
  platform: string;
  prompt: string;
  risk: string;
  blocked: boolean;
  matched: string[];
  hostname: string;
}

// UK school term date ranges
const TERMS = [
  { label: "Summer Term 2026", start: "2026-04-14", end: "2026-07-18" },
  { label: "Spring Term 2026", start: "2026-01-05", end: "2026-04-04" },
  { label: "Autumn Term 2025", start: "2025-09-02", end: "2025-12-19" },
  { label: "Summer Term 2025", start: "2025-04-22", end: "2025-07-18" },
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

export default function Dashboard() {
  const { loading: authLoading, authenticated } = useAuth();
  const [events, setEvents] = useState<BeaconEvent[]>([]);
  const [term, setTerm] = useState(getCurrentTerm);
  const [live, setLive] = useState(true);

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

    const channel = supabase
      .channel("beacon-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "beacon_events" },
        () => { loadEvents(); }
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
      });

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Filter events by selected term
  const filteredEvents = useMemo(() => {
    const selected = TERMS.find(t => t.label === term) ?? TERMS[0];
    const start = new Date(selected.start);
    const end = new Date(selected.end);
    end.setHours(23, 59, 59);
    return events.filter(e => {
      const d = new Date(e.created_at);
      return d >= start && d <= end;
    });
  }, [events, term]);

  // KPIs
  const totalPrompts = filteredEvents.length;
  const studentCount = new Set(filteredEvents.map(e => e.student_id)).size;
  const alerts = filteredEvents.filter(e => e.risk !== "low").length;
  const blocked = filteredEvents.filter(e => e.blocked).length;
  const wellbeing = parseFloat(
    Math.max(1, 10 - (alerts / Math.max(totalPrompts, 1)) * 10).toFixed(1)
  );
  const wellbeingDelta = 0.6;

  if (authLoading) return <div className="min-h-screen bg-[#F0F2F8] flex items-center justify-center"><div className="text-slate-400 text-sm">Loading...</div></div>;
  if (!authenticated) return null;

  return (
    <div className="flex min-h-screen bg-[#F0F2F8]">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">

        {/* Top bar */}
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-[#06B6D4]">{SCHOOL_NAME} — Insight Dashboard</h1>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">Release</span>
            </div>
            <p className="text-sm text-slate-400 mt-0.5">Teacher safeguarding, wellbeing and engagement overview</p>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/dashboard-beta"
              className="text-xs font-semibold text-slate-500 border border-slate-200 px-4 py-2 rounded-xl hover:border-[#06B6D4] hover:text-[#06B6D4] transition-all"
            >
              Try Beta Version →
            </a>

            <select
              value={term}
              onChange={e => setTerm(e.target.value)}
              className="text-sm border border-slate-200 rounded-xl px-4 py-2 text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20 cursor-pointer"
            >
              {TERMS.map(t => (
                <option key={t.label} value={t.label}>{t.label}</option>
              ))}
            </select>

            <button
              onClick={loadEvents}
              title="Refresh data"
              className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-400 hover:text-[#06B6D4] hover:border-[#06B6D4] transition-all"
            >
              ↺
            </button>

            <div className={`flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full ${live ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
              {live ? "LIVE" : "Offline"}
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 p-6 overflow-auto">

          <BeaconIntelligence events={filteredEvents} schoolName={SCHOOL_NAME} />

          <PulseMini events={filteredEvents} />

          <KPIGrid
            totalPrompts={totalPrompts}
            studentCount={studentCount}
            alerts={alerts}
            blocked={blocked}
            wellbeing={wellbeing.toFixed(1)}
            wellbeingDelta={wellbeingDelta}
          />

          {/* Trend + Platform row */}
          <div className="grid grid-cols-2 gap-5 mb-6">
            <TrendLine events={filteredEvents} />
            <PlatformUsage events={filteredEvents} />
          </div>

          {/* Repeat Incidents */}
          <div className="mb-6" id="repeat-incidents">
            <RepeatIncidents events={filteredEvents} />
          </div>



          <div className="grid grid-cols-[1fr_340px] gap-5 mb-6">
            <EventsTable events={filteredEvents} />
            <div className="flex flex-col gap-5">
              <RiskBreakdown events={filteredEvents} />
            </div>
          </div>

        </main>
      </div>
    </div>
  );
}
