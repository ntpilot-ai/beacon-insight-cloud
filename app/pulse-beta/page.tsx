"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import Sidebar from "@/components/Sidebar";
import Image from "next/image";
import Link from "next/link";
import { calculateAllPulsesV2, type StudentPulse } from "@/lib/pulse_engine_v2";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";


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

// ── Student detail ────────────────────────────────────────────────────────────
function StudentDetail({ pulse, events }: { pulse: StudentPulse; events: any[] }) {
  const alert = ALERT[pulse.alert_level];
  const trend = TREND_DIR[pulse.trend_direction];

  const studentEvents = useMemo(() =>
    events.filter((e: any) => e.student_id === pulse.student_id)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [events, pulse.student_id]
  );

  const chartData = useMemo(() =>
    Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const dayEnd   = dayStart + 86400000;
      const day = studentEvents.filter((e: any) => {
        const t = new Date(e.created_at).getTime();
        return t >= dayStart && t < dayEnd;
      });
      return {
        date:     d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        critical: day.filter((e: any) => e.risk === "critical").length,
        high:     day.filter((e: any) => e.risk === "high").length,
        medium:   day.filter((e: any) => e.risk === "medium").length,
        low:      day.filter((e: any) => e.risk === "low").length,
      };
    }),
    [studentEvents]
  );

  const hasRisk = useMemo(() => ({
    critical: studentEvents.some((e: any) => e.risk === "critical"),
    high:     studentEvents.some((e: any) => e.risk === "high"),
    medium:   studentEvents.some((e: any) => e.risk === "medium"),
    low:      studentEvents.some((e: any) => e.risk === "low"),
  }), [studentEvents]);

  const groupedEvents = useMemo(() => ({
    high:   studentEvents.filter((e: any) => e.risk === "high" || e.risk === "critical"),
    medium: studentEvents.filter((e: any) => e.risk === "medium"),
    low:    studentEvents.filter((e: any) => e.risk === "low"),
  }), [studentEvents]);

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

        {/* ── Concern categories + primary concern ── */}
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

        {/* Primary concern inline */}
        <div className="mt-3 flex items-start gap-2">
          <div className="w-1 rounded-full self-stretch shrink-0" style={{ background: alert.bar }} />
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Primary Concern · </span>
            <span className="text-sm font-bold text-slate-700">{pulse.dominant_signal.label}</span>
            <span className="text-sm text-slate-500"> — {pulse.dominant_signal.detail}</span>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 p-6 space-y-6 overflow-auto">

        {/* Timeline + signals side by side */}
        <div className="grid grid-cols-[1fr_1fr] gap-5">

          {/* 14-day timeline */}
          <div className="bg-slate-50 rounded-2xl p-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">
              14-Day Timeline · {SHAPE_ICON[pulse.trend_shape]} {pulse.trend_shape.replace("_", " ")}
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} interval={6} />
                <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0", padding: "6px 10px" }}
                  labelStyle={{ fontWeight: 700, marginBottom: 4, color: "#334155" }}
                  itemStyle={{ padding: "1px 0" }}
                />
                {hasRisk.critical && <Line type="monotone" dataKey="critical" stroke="#6366F1" strokeWidth={2} dot={false} name="Critical" />}
                {hasRisk.high     && <Line type="monotone" dataKey="high"     stroke="#EF4444" strokeWidth={2} dot={false} name="High"     />}
                {hasRisk.medium   && <Line type="monotone" dataKey="medium"   stroke="#EAB308" strokeWidth={2} dot={false} name="Medium"   />}
                {hasRisk.low      && <Line type="monotone" dataKey="low"      stroke="#22C55E" strokeWidth={2} dot={false} name="Low"      />}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Signal bars — compact */}
          <div className="bg-slate-50 rounded-2xl p-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Signal Breakdown</div>
            <div className="space-y-2.5">
              {pulse.signals.map(sig => {
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
            <RiskGroup riskKey="high"   events={groupedEvents.high}   />
            <RiskGroup riskKey="medium" events={groupedEvents.medium} />
            <RiskGroup riskKey="low"    events={groupedEvents.low}    />
            {studentEvents.length === 0 && (
              <div className="text-sm text-slate-400 text-center py-6">No events found</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Student list item ─────────────────────────────────────────────────────────
function StudentListItem({ pulse, isActive, onClick }: { pulse: StudentPulse; isActive: boolean; onClick: () => void }) {
  const alert = ALERT[pulse.alert_level];

  return (
    <button onClick={onClick}
      className={`w-full text-left px-4 py-2.5 border-b border-slate-50 transition-colors flex items-center gap-2 ${
        isActive ? "bg-cyan-50 border-l-2 border-l-[#06B6D4]" : "hover:bg-slate-50"
      }`}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: alert.bar }} />
      <div className="flex items-center gap-1 min-w-0 flex-1">
        {pulse.rapid_escalation && <span className="text-xs shrink-0">⚡</span>}
        <span className="font-medium text-slate-700 text-sm truncate">{pulse.student_id}</span>
      </div>
      <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${alert.bg} ${alert.text}`}>
        {pulse.pulse_score}
      </span>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PulseBetaPage() {
  const { loading: authLoading, authenticated } = useAuth();
  const [events, setEvents]     = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState<StudentPulse | null>(null);
  const [search, setSearch]     = useState("");
  const [openTiers, setOpenTiers] = useState<Record<string, boolean>>({ critical: true, high: false, medium: false, low: false });

  useEffect(() => {
    supabase.from("beacon_events").select("*").order("created_at", { ascending: true })
      .then(({ data }) => { setEvents(data || []); setLoading(false); });
  }, []);

  const pulses = useMemo(() => calculateAllPulsesV2(events), [events]);

  useEffect(() => {
    if (pulses.length && !selected) setSelected(pulses[0]);
  }, [pulses]);

  const filtered = useMemo(() =>
    pulses.filter(p => !search || p.student_id.toLowerCase().includes(search.toLowerCase())),
    [pulses, search]
  );

  const schoolAvg  = useMemo(() =>
    pulses.length ? Math.round(pulses.reduce((s, p) => s + p.pulse_score, 0) / pulses.length) : 0, [pulses]);
  const rapidCount = pulses.filter(p => p.rapid_escalation).length;

  const TIERS = [
    { key: "critical" as const, label: "Critical" },
    { key: "high"     as const, label: "High"     },
    { key: "medium"   as const, label: "Medium"   },
    { key: "low"      as const, label: "Low"      },
  ];

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
              ? <StudentDetail pulse={selected} events={events} />
              : <div className="flex items-center justify-center h-full text-slate-400 text-sm">Select a student</div>
            }
          </div>

        </div>
      </div>
    </div>
  );
}
