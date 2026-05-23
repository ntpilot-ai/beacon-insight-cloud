"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import Sidebar from "@/components/Sidebar";
import Image from "next/image";
import Link from "next/link";
import { calculateAllPulsesV2, type StudentPulse } from "@/lib/pulse_engine_v2";

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, color, width = 56, height = 20 }: { data: number[]; color: string; width?: number; height?: number }) {
  const max    = Math.max(...data, 1);
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * height}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={height - (data[data.length-1] / max) * height} r="2.5" fill={color} />
    </svg>
  );
}

const ALERT = {
  critical: { label: "Critical", bg: "bg-purple-100", text: "text-purple-700", bar: "#7C3AED", light: "#F5F3FF", ring: "ring-purple-300" },
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

// ── Student detail ────────────────────────────────────────────────────────────
function StudentDetail({ pulse, events }: { pulse: StudentPulse; events: any[] }) {
  const alert = ALERT[pulse.alert_level];
  const trend = TREND_DIR[pulse.trend_direction];

  const studentEvents = useMemo(() =>
    events.filter((e: any) => e.student_id === pulse.student_id)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [events, pulse.student_id]
  );

  return (
    <div className="flex flex-col h-full overflow-auto">

      {/* ── Header strip ── */}
      <div className="px-6 py-5 border-b border-slate-100 shrink-0" style={{ background: alert.light }}>
        <div className="flex items-start justify-between gap-4">

          {/* Left: name + badges */}
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h2 className="text-xl font-bold text-slate-800">{pulse.student_id}</h2>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${alert.bg} ${alert.text}`}>
                {alert.label}
              </span>
              {pulse.rapid_escalation && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-600 text-white animate-pulse">
                  ⚡ Rapid Escalation
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span>{pulse.total_events} events</span>
              <span>First seen {new Date(pulse.first_seen).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              <span>Last incident {new Date(pulse.last_seen).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
            </div>
          </div>

          {/* Right: score */}
          <div className="text-right shrink-0">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pulse Score</div>
            <div className="text-5xl font-bold leading-none mt-1" style={{ color: alert.bar }}>{pulse.pulse_score}</div>
            <div className={`text-xs font-semibold mt-1 ${trend.color}`}>
              {trend.icon} {pulse.trend_direction}
              {pulse.vs_school_avg !== undefined && pulse.vs_school_avg !== 0 && (
                <span className={`ml-2 ${pulse.vs_school_avg > 0 ? "text-red-400" : "text-emerald-400"}`}>
                  ({pulse.vs_school_avg > 0 ? "+" : ""}{pulse.vs_school_avg} vs avg)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Concern categories — prominent ── */}
        {pulse.categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {pulse.categories.map(cat => (
              <div key={cat.name} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-white text-xs font-bold"
                style={{ background: CAT_COLOR[cat.name] || "#64748b" }}>
                {cat.name}
                <span className="bg-white/20 px-1.5 py-0.5 rounded-full">{cat.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 p-6 space-y-6 overflow-auto">

        {/* Primary concern */}
        <div className="rounded-2xl p-4 border-l-4" style={{ borderLeftColor: alert.bar, background: alert.light }}>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Primary Concern</div>
          <div className="font-bold text-slate-800">{pulse.dominant_signal.label}</div>
          <div className="text-sm text-slate-600 mt-0.5 leading-relaxed">{pulse.dominant_signal.detail}</div>
        </div>

        {/* Timeline + signals side by side */}
        <div className="grid grid-cols-[1fr_1fr] gap-5">

          {/* 14-day timeline */}
          <div className="bg-slate-50 rounded-2xl p-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">
              14-Day Timeline · {SHAPE_ICON[pulse.trend_shape]} {pulse.trend_shape.replace("_", " ")}
            </div>
            <div className="flex items-end gap-1 h-16">
              {pulse.trend.map((v, i) => {
                const max   = Math.max(...pulse.trend, 1);
                const color = v >= 70 ? "#DC2626" : v >= 40 ? "#F59E0B" : v > 0 ? "#06B6D4" : "#e2e8f0";
                return (
                  <div key={i} className="flex-1 rounded-t-sm transition-all"
                    style={{ height: `${Math.max((v / max) * 64, 2)}px`, background: color }} />
                );
              })}
            </div>
            <div className="flex justify-between text-[9px] text-slate-400 mt-1">
              <span>14d ago</span><span>Today</span>
            </div>
          </div>

          {/* Signal bars — compact */}
          <div className="bg-slate-50 rounded-2xl p-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Signal Breakdown</div>
            <div className="space-y-2.5">
              {pulse.signals.sort((a, b) => b.score - a.score).map(sig => {
                const c = sig.score >= 70 ? "#DC2626" : sig.score >= 40 ? "#F59E0B" : "#10B981";
                return (
                  <div key={sig.id} className="flex items-center gap-2">
                    <div className="w-28 text-xs text-slate-500 truncate shrink-0">{sig.label}</div>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${sig.score}%`, background: c }} />
                    </div>
                    <div className="text-xs font-bold w-6 text-right shrink-0" style={{ color: c }}>{sig.score}</div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* Prompt history */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Prompt History</div>
            <button
              onClick={() => window.open(`/reports/student?student=${encodeURIComponent(pulse.student_id)}`, "_blank")}
              className="text-xs font-semibold text-[#06B6D4] border border-[#06B6D4] px-3 py-1.5 rounded-xl hover:bg-cyan-50 transition-all"
            >
              ⬇ PDF Report
            </button>
          </div>
          <div className="space-y-2">
            {studentEvents.filter((e: any) => e.risk !== "low").map((event: any, idx: number) => {
              const rc = event.risk === "high" || event.risk === "critical" ? "#DC2626" : "#F59E0B";
              const bc = event.risk === "high" || event.risk === "critical" ? "border-red-200" : "border-amber-200";
              return (
                <div key={idx} className={`flex gap-3 p-3 rounded-xl border ${bc} bg-white`}>
                  <div className="shrink-0 w-16 text-right">
                    <div className="text-[10px] text-slate-400">{new Date(event.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
                    <div className="text-[10px] text-slate-400">{new Date(event.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
                    <div className="text-[10px] font-bold mt-0.5" style={{ color: rc }}>{event.risk?.toUpperCase()}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 leading-relaxed">{event.prompt}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] text-slate-400">{event.platform}</span>
                      {event.matched?.map((m: string) => (
                        <span key={m} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">{m}</span>
                      ))}
                      {event.blocked && <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">Blocked</span>}
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

// ── Student list item ─────────────────────────────────────────────────────────
function StudentListItem({ pulse, isActive, onClick }: { pulse: StudentPulse; isActive: boolean; onClick: () => void }) {
  const alert = ALERT[pulse.alert_level];
  const trend = TREND_DIR[pulse.trend_direction];

  return (
    <button onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-slate-50 transition-colors ${
        isActive ? "bg-cyan-50 border-l-2 border-l-[#06B6D4]" : "hover:bg-slate-50"
      }`}>

      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {pulse.rapid_escalation && <span className="text-xs shrink-0">⚡</span>}
          <span className="font-semibold text-slate-700 text-sm truncate">{pulse.student_id}</span>
        </div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ml-2 ${alert.bg} ${alert.text}`}>
          {pulse.pulse_score}
        </span>
      </div>

      {/* Categories — top concern only */}
      {pulse.categories.length > 0 && (
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[10px] font-bold text-white px-2 py-0.5 rounded-full"
            style={{ background: CAT_COLOR[pulse.categories[0].name] || "#64748b" }}>
            {pulse.categories[0].name}
          </span>
          {pulse.categories.length > 1 && (
            <span className="text-[10px] text-slate-400">+{pulse.categories.length - 1} more</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-semibold ${trend.color}`}>
          {trend.icon} {pulse.trend_direction}
          {pulse.vs_school_avg !== undefined && Math.abs(pulse.vs_school_avg) >= 15 && (
            <span className={`ml-1.5 ${pulse.vs_school_avg > 0 ? "text-red-400" : "text-emerald-400"}`}>
              ({pulse.vs_school_avg > 0 ? "+" : ""}{pulse.vs_school_avg} avg)
            </span>
          )}
        </span>
        <Sparkline data={pulse.trend} color={alert.bar} />
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PulseBetaPage() {
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

  const pulses = useMemo(() => calculateAllPulsesV2(events), [events]);

  useEffect(() => {
    if (pulses.length && !selected) setSelected(pulses[0]);
  }, [pulses]);

  const filtered = useMemo(() => pulses.filter(p => {
    if (filter !== "all" && p.alert_level !== filter) return false;
    if (search && !p.student_id.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [pulses, filter, search]);

  const schoolAvg  = useMemo(() =>
    pulses.length ? Math.round(pulses.reduce((s, p) => s + p.pulse_score, 0) / pulses.length) : 0, [pulses]);
  const rapidCount = pulses.filter(p => p.rapid_escalation).length;
  const summary    = {
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
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Image src="/pulse_icon.png" alt="Pulse" width={28} height={28} className="object-contain" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[#06B6D4]">Beacon Pulse</h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Beta v2</span>
                {rapidCount > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600 text-white animate-pulse">
                    ⚡ {rapidCount} Rapid
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">School avg: {schoolAvg} · {pulses.length} students</p>
            </div>
          </div>
          <Link href="/pulse"
            className="text-xs font-semibold text-slate-500 border border-slate-200 px-3 py-1.5 rounded-xl hover:border-[#06B6D4] hover:text-[#06B6D4] transition-all">
            ← Release Version
          </Link>
        </header>

        {/* Filter bar */}
        <div className="bg-white border-b border-slate-100 px-6 py-2 flex items-center gap-2">
          {(["all","critical","high","medium","low"] as const).map(level => {
            const count = level === "all" ? pulses.length : summary[level];
            const cfg   = level === "all"
              ? { label: "All", bg: "bg-slate-100", text: "text-slate-600", bar: "#64748b" }
              : ALERT[level];
            return (
              <button key={level} onClick={() => setFilter(level)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                  filter === level ? `${cfg.bg} ${cfg.text}` : "text-slate-400 hover:bg-slate-100"
                }`}>
                {level !== "all" && <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.bar }} />}
                {cfg.label} {count}
              </button>
            );
          })}
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="ml-auto border border-slate-200 rounded-xl px-3 py-1 text-xs w-36 focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20" />
        </div>

        {/* Split view */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left list — narrower */}
          <div className="w-60 shrink-0 bg-white border-r border-slate-200 overflow-auto">
            {loading && <div className="text-center py-8 text-slate-400 text-xs">Loading...</div>}
            {!loading && filtered.map(pulse => (
              <StudentListItem
                key={pulse.student_id}
                pulse={pulse}
                isActive={selected?.student_id === pulse.student_id}
                onClick={() => setSelected(pulse)}
              />
            ))}
          </div>

          {/* Right detail */}
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
