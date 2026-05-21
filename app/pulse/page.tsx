"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import Sidebar from "@/components/Sidebar";
import Image from "next/image";
import { calculateAllPulses, StudentPulse } from "@/lib/pulse_engine";

// ── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max    = Math.max(...data, 1);
  const w      = 80;
  const h      = 28;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * h;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Last point dot */}
      {data.length > 0 && (() => {
        const last = data[data.length - 1];
        const x    = w;
        const y    = h - (last / max) * h;
        return <circle cx={x} cy={y} r="2.5" fill={color} />;
      })()}
    </svg>
  );
}

// ── Alert level config ───────────────────────────────────────────────────────

const ALERT_CONFIG = {
  critical: { label: "Critical",  bg: "bg-purple-100", text: "text-purple-700", bar: "#7C3AED", border: "border-purple-200" },
  high:     { label: "High",      bg: "bg-red-100",    text: "text-red-700",    bar: "#DC2626", border: "border-red-200"    },
  medium:   { label: "Medium",    bg: "bg-amber-100",  text: "text-amber-700",  bar: "#F59E0B", border: "border-amber-200"  },
  low:      { label: "Low",       bg: "bg-slate-100",  text: "text-slate-500",  bar: "#10B981", border: "border-slate-200"  },
};

const TREND_CONFIG = {
  rising:  { icon: "↑", color: "text-red-500",    label: "Rising"  },
  falling: { icon: "↓", color: "text-emerald-500", label: "Falling" },
  stable:  { icon: "→", color: "text-slate-400",   label: "Stable"  },
};

// ── Student detail panel ─────────────────────────────────────────────────────

function StudentDetail({ pulse, onClose }: { pulse: StudentPulse; onClose: () => void }) {
  const alert  = ALERT_CONFIG[pulse.alert_level];
  const trend  = TREND_CONFIG[pulse.trend_direction];

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-end" onClick={onClose}>
      <div
        className="bg-white h-full w-full max-w-lg shadow-2xl overflow-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#06B6D4] text-white px-6 py-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Image src="/pulse_icon.png" alt="Pulse" width={28} height={28} className="object-contain opacity-90" />
              <span className="text-sm font-semibold opacity-80">Beacon Pulse</span>
            </div>
            <button onClick={onClose} className="text-white/60 hover:text-white text-xl">✕</button>
          </div>
          <h2 className="text-2xl font-bold">{pulse.student_id}</h2>
          <div className="flex items-center gap-3 mt-2">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full bg-white/20`}>
              {alert.label} Alert
            </span>
            <span className="text-white/70 text-sm">
              {pulse.total_events} events · First seen {new Date(pulse.first_seen).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
          </div>
        </div>

        <div className="p-6 space-y-6">

          {/* Pulse score + sparkline */}
          <div className="flex items-center justify-between bg-slate-50 rounded-2xl p-5">
            <div>
              <div className="text-xs text-slate-400 mb-1 font-semibold uppercase tracking-wide">Pulse Score</div>
              <div className="text-5xl font-bold" style={{ color: alert.bar }}>{pulse.pulse_score}</div>
              <div className={`flex items-center gap-1 mt-1 text-sm font-semibold ${trend.color}`}>
                {trend.icon} {trend.label}
                {pulse.trend_delta !== 0 && (
                  <span className="text-xs font-normal text-slate-400 ml-1">
                    ({pulse.trend_delta > 0 ? "+" : ""}{pulse.trend_delta} vs prior 7 days)
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400 mb-2">14-day trend</div>
              <Sparkline data={pulse.trend} color={alert.bar} />
            </div>
          </div>

          {/* Dominant signal */}
          <div className={`rounded-xl border-l-4 p-4 ${alert.border} bg-slate-50`} style={{ borderLeftColor: alert.bar }}>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Primary Concern</div>
            <div className="font-semibold text-slate-700">{pulse.dominant_signal.label}</div>
            <div className="text-sm text-slate-500 mt-1">{pulse.dominant_signal.detail}</div>
          </div>

          {/* All signals */}
          <div>
            <h3 className="text-sm font-bold text-slate-600 mb-3 uppercase tracking-wide">Signal Breakdown</h3>
            <div className="space-y-3">
              {pulse.signals.sort((a, b) => b.score - a.score).map(sig => (
                <div key={sig.id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-slate-600">{sig.label}</span>
                    <span className="text-sm font-bold" style={{
                      color: sig.score >= 70 ? "#DC2626" : sig.score >= 40 ? "#F59E0B" : "#10B981"
                    }}>{sig.score}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${sig.score}%`,
                        background: sig.score >= 70 ? "#DC2626" : sig.score >= 40 ? "#F59E0B" : "#10B981"
                      }}
                    />
                  </div>
                  <div className="text-xs text-slate-400 mt-1">{sig.detail}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline */}
          <div>
            <h3 className="text-sm font-bold text-slate-600 mb-2 uppercase tracking-wide">14-Day Score Timeline</h3>
            <div className="flex items-end gap-1 h-20 bg-slate-50 rounded-xl p-3">
              {pulse.trend.map((v, i) => {
                const max   = Math.max(...pulse.trend, 1);
                const pct   = (v / max) * 100;
                const color = v >= 70 ? "#DC2626" : v >= 40 ? "#F59E0B" : v > 0 ? "#06B6D4" : "#e2e8f0";
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full rounded-sm transition-all duration-500"
                      style={{ height: `${Math.max(pct * 0.56, 2)}px`, background: color }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1 px-1">
              <span>14 days ago</span>
              <span>Today</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

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

      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Image src="/pulse_icon.png" alt="Pulse" width={36} height={36} className="object-contain" />
            <div>
              <h1 className="text-2xl font-bold text-[#06B6D4]">Beacon Pulse</h1>
              <p className="text-sm text-slate-400 mt-0.5">Behavioural analytics — student activity over time</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-cyan-50 text-[#06B6D4]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#06B6D4] animate-pulse" />
            {pulses.length} students monitored
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {(["critical","high","medium","low"] as const).map(level => {
              const cfg   = ALERT_CONFIG[level];
              const count = summary[level];
              return (
                <button
                  key={level}
                  onClick={() => setFilter(filter === level ? "all" : level)}
                  className={`bg-white rounded-2xl border p-5 text-left transition-all hover:shadow-md ${
                    filter === level ? `ring-2 ring-offset-1` : "border-slate-100"
                  }`}
                  style={filter === level ? { ringColor: cfg.bar } : {}}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
                      {cfg.label}
                    </span>
                    {filter === level && <span className="text-xs text-slate-400">✓ filtered</span>}
                  </div>
                  <div className="text-4xl font-bold" style={{ color: cfg.bar }}>{count}</div>
                  <div className="text-xs text-slate-400 mt-1">students</div>
                </button>
              );
            })}
          </div>

          {/* Search + filter bar */}
          <div className="flex items-center gap-3 mb-4">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search student..."
              className="border border-slate-200 rounded-xl px-4 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20"
            />
            {filter !== "all" && (
              <button
                onClick={() => setFilter("all")}
                className="text-xs text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg px-3 py-2"
              >
                Clear filter ✕
              </button>
            )}
            <span className="text-sm text-slate-400 ml-auto">{filtered.length} students</span>
          </div>

          {/* Student table */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left text-xs font-semibold text-slate-400 px-6 py-3">Student</th>
                  <th className="text-left text-xs font-semibold text-slate-400 px-4 py-3">Pulse Score</th>
                  <th className="text-left text-xs font-semibold text-slate-400 px-4 py-3">14-Day Trend</th>
                  <th className="text-left text-xs font-semibold text-slate-400 px-4 py-3">Direction</th>
                  <th className="text-left text-xs font-semibold text-slate-400 px-4 py-3">Primary Concern</th>
                  <th className="text-left text-xs font-semibold text-slate-400 px-4 py-3">Alert</th>
                  <th className="text-left text-xs font-semibold text-slate-400 px-4 py-3">Events</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">Loading behavioural data...</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">No students match this filter</td></tr>
                )}
                {filtered.map(pulse => {
                  const alert = ALERT_CONFIG[pulse.alert_level];
                  const trend = TREND_CONFIG[pulse.trend_direction];
                  return (
                    <tr
                      key={pulse.student_id}
                      className="border-b border-slate-50 hover:bg-slate-50/60 cursor-pointer transition-colors"
                      onClick={() => setSelected(pulse)}
                    >
                      <td className="px-6 py-4 font-medium text-slate-700">{pulse.student_id}</td>

                      {/* Score with bar */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pulse.pulse_score}%`, background: alert.bar }}
                            />
                          </div>
                          <span className="font-bold text-sm" style={{ color: alert.bar }}>
                            {pulse.pulse_score}
                          </span>
                        </div>
                      </td>

                      {/* Sparkline */}
                      <td className="px-4 py-4">
                        <Sparkline data={pulse.trend} color={alert.bar} />
                      </td>

                      {/* Direction */}
                      <td className="px-4 py-4">
                        <span className={`flex items-center gap-1 text-sm font-semibold ${trend.color}`}>
                          {trend.icon} {trend.label}
                        </span>
                      </td>

                      {/* Primary concern */}
                      <td className="px-4 py-4 max-w-[200px]">
                        <div className="text-xs font-semibold text-slate-600">{pulse.dominant_signal.label}</div>
                        <div className="text-xs text-slate-400 truncate mt-0.5">{pulse.dominant_signal.detail}</div>
                      </td>

                      {/* Alert badge */}
                      <td className="px-4 py-4">
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${alert.bg} ${alert.text}`}>
                          {alert.label}
                        </span>
                      </td>

                      {/* Event count */}
                      <td className="px-4 py-4 text-slate-400 text-sm">{pulse.total_events}</td>

                      {/* Arrow */}
                      <td className="px-4 py-4 text-slate-300">→</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

        </main>
      </div>

      {/* Detail panel */}
      {selected && <StudentDetail pulse={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
