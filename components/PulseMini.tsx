"use client";

import { useMemo } from "react";
import Link from "next/link";
import { calculateAllPulses } from "@/lib/pulse_engine";

interface BeaconEvent {
  student_id: string;
  risk:        string;
  blocked:     boolean;
  created_at:  string;
  prompt:      string;
  matched:     string[];
  platform:    string;
}

const ALERT_CONFIG = {
  critical: { bar: "#7C3AED", bg: "bg-purple-100", text: "text-purple-700", label: "Critical" },
  high:     { bar: "#DC2626", bg: "bg-red-100",    text: "text-red-600",    label: "High"     },
  medium:   { bar: "#F59E0B", bg: "bg-amber-100",  text: "text-amber-700",  label: "Medium"   },
  low:      { bar: "#10B981", bg: "bg-slate-100",  text: "text-slate-500",  label: "Low"      },
};

const TREND_ICON = { rising: "↑", falling: "↓", stable: "→" };
const TREND_COLOR = { rising: "text-red-500", falling: "text-emerald-500", stable: "text-slate-400" };

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const max    = Math.max(...data, 1);
  const w = 56; const h = 20;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function PulseMini({ events }: { events: BeaconEvent[] }) {
  const pulses = useMemo(() => calculateAllPulses(events), [events]);
  const top    = pulses.filter(p => p.pulse_score > 0).slice(0, 5);

  const summary = {
    critical: pulses.filter(p => p.alert_level === "critical").length,
    high:     pulses.filter(p => p.alert_level === "high").length,
  };

  if (!top.length) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm mb-6 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[#06B6D4] animate-pulse" />
            <span className="font-bold text-slate-700 text-sm">Pulse — Behavioural Watch</span>
          </div>
          {summary.critical > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
              {summary.critical} Critical
            </span>
          )}
          {summary.high > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
              {summary.high} High
            </span>
          )}
        </div>
        <Link
          href="/pulse"
          className="text-xs font-semibold text-[#06B6D4] hover:underline flex items-center gap-1"
        >
          View all in Pulse →
        </Link>
      </div>

      <div className="divide-y divide-slate-50">
        {top.map(pulse => {
          const alert = ALERT_CONFIG[pulse.alert_level];
          return (
            <Link
              key={pulse.student_id}
              href="/pulse"
              className="flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50 transition-colors"
            >
              {/* Score bar */}
              <div className="flex items-center gap-2 w-28 shrink-0">
                <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pulse.pulse_score}%`, background: alert.bar }} />
                </div>
                <span className="text-sm font-bold w-8 text-right shrink-0" style={{ color: alert.bar }}>
                  {pulse.pulse_score}
                </span>
              </div>

              {/* Student name */}
              <span className="font-medium text-slate-700 text-sm w-36 truncate shrink-0">
                {pulse.student_id}
              </span>

              {/* Alert badge */}
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${alert.bg} ${alert.text}`}>
                {alert.label}
              </span>

              {/* Dominant signal */}
              <span className="text-xs text-slate-400 flex-1 truncate">
                {pulse.dominant_signal.label}
              </span>

              {/* Sparkline + trend */}
              <div className="flex items-center gap-1.5 shrink-0">
                <MiniSparkline data={pulse.trend} color={alert.bar} />
                <span className={`text-sm font-bold ${TREND_COLOR[pulse.trend_direction]}`}>
                  {TREND_ICON[pulse.trend_direction]}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
