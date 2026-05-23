"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import Sidebar from "@/components/Sidebar";
import Image from "next/image";
import Link from "next/link";
import { calculateAllPulses, type StudentPulse } from "@/lib/pulse_engine";

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, color, width = 80, height = 28 }: { data: number[]; color: string; width?: number; height?: number }) {
  const max    = Math.max(...data, 1);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(" ");
  const last = data[data.length - 1];
  const lx   = width;
  const ly   = height - (last / max) * height;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="2.5" fill={color} />
    </svg>
  );
}

// ── Config ────────────────────────────────────────────────────────────────────
const ALERT_CONFIG = {
  critical: { label: "Critical", bg: "bg-purple-100", text: "text-purple-700", bar: "#7C3AED", light: "#F5F3FF" },
  high:     { label: "High",     bg: "bg-red-100",    text: "text-red-600",    bar: "#DC2626", light: "#FEF2F2" },
  medium:   { label: "Medium",   bg: "bg-amber-100",  text: "text-amber-700",  bar: "#F59E0B", light: "#FFFBEB" },
  low:      { label: "Low",      bg: "bg-slate-100",  text: "text-slate-500",  bar: "#10B981", light: "#F0FDF4" },
};

const TREND_CONFIG = {
  rising:  { icon: "↑", color: "text-red-500",     label: "Rising"  },
  falling: { icon: "↓", color: "text-emerald-500",  label: "Falling" },
  stable:  { icon: "→", color: "text-slate-400",    label: "Stable"  },
};

// ── Detail panel ──────────────────────────────────────────────────────────────
function StudentDetail({ pulse, events }: { pulse: StudentPulse; events: any[] }) {
  const alert = ALERT_CONFIG[pulse.alert_level];
  const trend = TREND_CONFIG[pulse.trend_direction];
  const studentEvents = events
    .filter((e: any) => e.student_id === pulse.student_id)
    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="flex flex-col">

      {/* Student header */}
      <div className="px-8 py-6 border-b border-slate-100" style={{ background: alert.light }}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">{pulse.student_id}</h2>
            <div className="flex items-center gap-3 mt-2">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${alert.bg} ${alert.text}`}>
                {alert.label} Alert
              </span>
              <span className="text-sm text-slate-400">
                {pulse.total_events} events
              </span>
              <span className="text-sm text-slate-400">
                First seen {new Date(pulse.first_seen).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </div>
          </div>

          {/* Big score */}
          <div className="text-right">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Pulse Score</div>
            <div className="text-6xl font-bold leading-none" style={{ color: alert.bar }}>
              {pulse.pulse_score}
            </div>
            <div className={`flex items-center justify-end gap-1 mt-1 text-sm font-semibold ${trend.color}`}>
              {trend.icon} {trend.label}
              {pulse.trend_delta !== 0 && (
                <span className="text-xs font-normal text-slate-400 ml-1">
                  ({pulse.trend_delta > 0 ? "+" : ""}{pulse.trend_delta} vs prior 7 days)
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="p-8 space-y-8">

        {/* 14-day timeline + sparkline side by side */}
        <div className="grid grid-cols-2 gap-6">

          {/* Timeline bar chart */}
          <div className="bg-slate-50 rounded-2xl p-5">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">14-Day Score Timeline</div>
            <div className="flex items-end gap-1.5 h-24">
              {pulse.trend.map((v, i) => {
                const max   = Math.max(...pulse.trend, 1);
                const pct   = (v / max) * 100;
                const color = v >= 70 ? "#DC2626" : v >= 40 ? "#F59E0B" : v > 0 ? "#06B6D4" : "#e2e8f0";
                const d     = new Date();
                d.setDate(d.getDate() - (13 - i));
                const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div
                      className="w-full rounded-t-sm transition-all duration-500"
                      style={{ height: `${Math.max(pct * 0.8, 2)}px`, background: color }}
                    />
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                      {label}: {v}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-2">
              <span>14 days ago</span>
              <span>Today</span>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Last Incident",   value: new Date(pulse.last_seen).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) },
              { label: "Total Events",    value: pulse.total_events.toString() },
              { label: "Trend",           value: `${trend.icon} ${trend.label}` },
              { label: "Score Change",    value: `${pulse.trend_delta > 0 ? "+" : ""}${pulse.trend_delta}` },
            ].map(s => (
              <div key={s.label} className="bg-slate-50 rounded-xl p-4">
                <div className="text-xs text-slate-400 mb-1">{s.label}</div>
                <div className="font-bold text-slate-700">{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Primary concern */}
        <div>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Primary Concern</div>
          <div
            className="rounded-2xl p-5 border-l-4"
            style={{ borderLeftColor: alert.bar, background: alert.light }}
          >
            <div className="font-bold text-slate-800 text-lg mb-1">{pulse.dominant_signal.label}</div>
            <div className="text-slate-600 text-sm leading-relaxed">{pulse.dominant_signal.detail}</div>
          </div>
        </div>

        {/* Signal breakdown */}
        <div>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Signal Breakdown</div>
          <div className="grid grid-cols-2 gap-4">
            {pulse.signals.sort((a, b) => b.score - a.score).map(sig => {
              const sigColor = sig.score >= 70 ? "#DC2626" : sig.score >= 40 ? "#F59E0B" : "#10B981";
              return (
                <div key={sig.id} className="bg-slate-50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-600">{sig.label}</span>
                    <span className="text-lg font-bold" style={{ color: sigColor }}>{sig.score}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden mb-2">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${sig.score}%`, background: sigColor }}
                    />
                  </div>
                  <div className="text-xs text-slate-400 leading-relaxed">{sig.detail}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Prompt history */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Prompt History</div>
            <button
              onClick={() => window.open(`/reports/student?student=${encodeURIComponent(pulse.student_id)}`, '_blank')}
              className="flex items-center gap-2 text-xs font-semibold text-[#06B6D4] border border-[#06B6D4] px-3 py-1.5 rounded-xl hover:bg-cyan-50 transition-all"
            >
              ⬇ Download PDF Report
            </button>
          </div>

          <div className="space-y-2">
            {studentEvents.length === 0 && (
              <div className="text-sm text-slate-400 text-center py-6">No events found</div>
            )}
            {studentEvents.map((event: any, idx: number) => {
              const riskColor =
                event.risk === "high" || event.risk === "critical" ? "#DC2626" :
                event.risk === "medium" ? "#F59E0B" : "#10B981";
              const borderColor =
                event.risk === "high" || event.risk === "critical" ? "border-red-200" :
                event.risk === "medium" ? "border-amber-200" : "border-slate-200";
              return (
                <div key={idx} className={`flex gap-4 p-4 rounded-xl border ${borderColor} bg-slate-50 hover:bg-white transition-colors`}>
                  <div className="shrink-0 text-right w-20">
                    <div className="text-xs text-slate-400">
                      {new Date(event.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </div>
                    <div className="text-xs text-slate-400">
                      {new Date(event.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="text-xs font-bold mt-1" style={{ color: riskColor }}>
                      {event.risk.toUpperCase()}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 leading-relaxed">{event.prompt}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-slate-400">{event.platform}</span>
                      {event.matched?.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {event.matched.map((m: string) => (
                            <span key={m} className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-mono">{m}</span>
                          ))}
                        </div>
                      )}
                      {event.blocked && (
                        <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">Blocked</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PulsePage() {
  const { loading: authLoading, authenticated } = useAuth();
  const [events, setEvents]     = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState<StudentPulse | null>(null);
  const [filter, setFilter]     = useState<"all" | "critical" | "high" | "medium" | "low">("all");
  const [search, setSearch]     = useState("");

  useEffect(() => {
    supabase.from("beacon_events").select("*").order("created_at", { ascending: true })
      .then(({ data }) => { setEvents(data || []); setLoading(false); });
  }, []);

  const pulses = useMemo(() => calculateAllPulses(events), [events]);

  useEffect(() => {
    if (pulses.length && !selected) setSelected(pulses[0]);
  }, [pulses]);

  const filtered = useMemo(() => pulses.filter(p => {
    if (filter !== "all" && p.alert_level !== filter) return false;
    if (search && !p.student_id.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [pulses, filter, search]);

  const summary = {
    critical: pulses.filter(p => p.alert_level === "critical").length,
    high:     pulses.filter(p => p.alert_level === "high").length,
    medium:   pulses.filter(p => p.alert_level === "medium").length,
    low:      pulses.filter(p => p.alert_level === "low").length,
  };

  if (authLoading || !authenticated) return null;

  return (
    <div className="flex min-h-screen bg-[#F0F2F8]">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">

        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Image src="/pulse_icon.png" alt="Pulse" width={32} height={32} className="object-contain" />
            <div>
              <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-[#06B6D4]">Beacon Pulse</h1>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">Release</span>
            </div>
              <p className="text-sm text-slate-400 mt-0.5">Behavioural analytics — student activity over time</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/pulse-beta"
              className="text-xs font-semibold text-slate-500 border border-slate-200 px-4 py-2 rounded-xl hover:border-[#06B6D4] hover:text-[#06B6D4] transition-all"
            >
              Try Beta Version →
            </Link>
            <div className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-cyan-50 text-[#06B6D4]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#06B6D4] animate-pulse" />
              {pulses.length} students monitored
            </div>
          </div>
        </header>

        {/* Summary pills */}
        <div className="bg-white border-b border-slate-100 px-8 py-3 flex items-center gap-3">
          {(["all", "critical", "high", "medium", "low"] as const).map(level => {
            const count = level === "all" ? pulses.length : summary[level];
            const cfg   = level === "all"
              ? { label: "All", bg: "bg-slate-100", text: "text-slate-600", bar: "#64748b" }
              : ALERT_CONFIG[level];
            return (
              <button
                key={level}
                onClick={() => setFilter(level)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  filter === level
                    ? `${cfg.bg} ${cfg.text} ring-1 ring-offset-1`
                    : "bg-slate-50 text-slate-400 hover:bg-slate-100"
                }`}
              >
                {level !== "all" && <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.bar }} />}
                {cfg.label} <span className="font-bold">{count}</span>
              </button>
            );
          })}

          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search student..."
            className="ml-auto border border-slate-200 rounded-xl px-3 py-1.5 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20"
          />
        </div>

        {/* Split view */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left — student list */}
          <div className="w-72 shrink-0 bg-white border-r border-slate-200 overflow-auto">
            {loading && (
              <div className="text-center py-12 text-slate-400 text-sm">Loading...</div>
            )}
            {!loading && filtered.map(pulse => {
              const alert   = ALERT_CONFIG[pulse.alert_level];
              const trend   = TREND_CONFIG[pulse.trend_direction];
              const isActive = selected?.student_id === pulse.student_id;
              return (
                <button
                  key={pulse.student_id}
                  onClick={() => setSelected(pulse)}
                  className={`w-full text-left px-5 py-4 border-b border-slate-50 transition-colors ${
                    isActive ? "bg-cyan-50 border-l-2 border-l-[#06B6D4]" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-slate-700 text-sm truncate">{pulse.student_id}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ml-2 ${alert.bg} ${alert.text}`}>
                      {pulse.pulse_score}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">{pulse.dominant_signal.label}</span>
                    <div className="flex items-center gap-1.5">
                      <Sparkline data={pulse.trend} color={alert.bar} width={48} height={18} />
                      <span className={`text-xs font-semibold ${trend.color}`}>{trend.icon}</span>
                    </div>
                  </div>
                </button>
              );
            })}
            {!loading && filtered.length === 0 && (
              <div className="text-center py-12 text-slate-400 text-sm">No students match</div>
            )}
          </div>

          {/* Right — detail */}
          <div className="flex-1 bg-white overflow-auto">
            {selected
              ? <StudentDetail pulse={selected} events={events} />
              : <div className="flex items-center justify-center h-full text-slate-400 text-sm">Select a student</div>
            }
          </div>

        </div>
      </div>
    </div>
  );
}
