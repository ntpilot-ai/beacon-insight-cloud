"use client";

import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

interface BeaconEvent {
  created_at: string;
  risk: string;
  blocked: boolean;
}

interface Props {
  events: BeaconEvent[];
  // The reference date the window ends on. Lets the caller scope the chart to a
  // historical term so "last 7 days" means the last 7 days of that term, not of
  // wall-clock today. Defaults to today.
  anchor?: Date;
  // Explicit date range. When provided, drives chart entirely: daily/weekly/monthly
  // buckets are picked automatically by span, and the internal mode toggle is hidden.
  range?: { start: Date; end: Date };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d: Date) {
  // Monday-anchored week
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function pickBucket(start: Date, end: Date): "daily" | "weekly" | "monthly" {
  const days = Math.ceil((end.getTime() - start.getTime()) / DAY_MS);
  if (days <= 14)  return "daily";
  if (days <= 120) return "weekly";
  return "monthly";
}

function getRangeBuckets(events: BeaconEvent[], start: Date, end: Date, bucket: "daily" | "weekly" | "monthly") {
  const spans: Array<{ s: Date; e: Date; label: string }> = [];

  if (bucket === "daily") {
    let cur = startOfDay(start);
    while (cur <= end) {
      const next = addDays(cur, 1);
      spans.push({
        s: cur,
        e: next,
        label: cur.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" }),
      });
      cur = next;
    }
  } else if (bucket === "weekly") {
    let cur = startOfWeek(start);
    while (cur <= end) {
      const next = addDays(cur, 7);
      spans.push({
        s: cur,
        e: next,
        label: cur.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      });
      cur = next;
    }
  } else {
    let cur = startOfMonth(start);
    while (cur <= end) {
      const next = addMonths(cur, 1);
      spans.push({
        s: cur,
        e: next,
        label: cur.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
      });
      cur = next;
    }
  }

  return spans.map(({ s, e, label }) => {
    const bucketEvents = events.filter(ev => {
      const d = new Date(ev.created_at);
      return d >= s && d < e;
    });
    return {
      label,
      Prompts: bucketEvents.length,
      Alerts:  bucketEvents.filter(ev => ev.risk !== "low").length,
      Blocked: bucketEvents.filter(ev => ev.blocked).length,
    };
  });
}

function getBuckets(events: BeaconEvent[], mode: "daily" | "weekly", now: Date) {
  if (mode === "daily") {
    // Last 7 days, one bucket per day
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));
      const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
      const dayStr = d.toISOString().slice(0, 10);

      const dayEvents = events.filter(e => e.created_at.slice(0, 10) === dayStr);
      return {
        label,
        Prompts: dayEvents.length,
        Alerts: dayEvents.filter(e => e.risk !== "low").length,
        Blocked: dayEvents.filter(e => e.blocked).length,
      };
    });
  } else {
    // Last 8 weeks, one bucket per week
    return Array.from({ length: 8 }, (_, i) => {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() - (7 * (7 - i)));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const label = `${weekStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;

      const weekEvents = events.filter(e => {
        const d = new Date(e.created_at);
        return d >= weekStart && d <= weekEnd;
      });

      return {
        label,
        Prompts: weekEvents.length,
        Alerts: weekEvents.filter(e => e.risk !== "low").length,
        Blocked: weekEvents.filter(e => e.blocked).length,
      };
    });
  }
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-lg text-sm">
      <div className="font-bold text-slate-700 mb-2">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-semibold" style={{ color: p.color }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function TrendLine({ events, anchor, range }: Props) {
  const [mode, setMode] = useState<"daily" | "weekly">("daily");

  const anchorTime = anchor?.getTime();
  const now = useMemo(
    () => (anchorTime !== undefined ? new Date(anchorTime) : new Date()),
    [anchorTime],
  );
  const isAnchored = anchorTime !== undefined;

  const rangeBucket = useMemo(
    () => (range ? pickBucket(range.start, range.end) : null),
    [range],
  );

  const data = useMemo(
    () =>
      range && rangeBucket
        ? getRangeBuckets(events, range.start, range.end, rangeBucket)
        : getBuckets(events, mode, now),
    [events, mode, now, range, rangeBucket],
  );

  const totalInPeriod = data.reduce((s, d) => s + d.Prompts, 0);
  const prev = useMemo(() => {
    if (range) {
      // Compare to the prior equivalent span
      const span = range.end.getTime() - range.start.getTime();
      const prevEnd = new Date(range.start.getTime());
      const prevStart = new Date(range.start.getTime() - span);
      return events.filter(e => {
        const d = new Date(e.created_at);
        return d >= prevStart && d < prevEnd;
      }).length;
    }
    // Compare to the prior equivalent period for the trend indicator
    const periodDays = mode === "daily" ? 7 : 56;
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - periodDays);
    const prior = new Date(cutoff);
    prior.setDate(prior.getDate() - periodDays);
    return events.filter(e => {
      const d = new Date(e.created_at);
      return d >= prior && d < cutoff;
    }).length;
  }, [events, mode, now, range]);

  const pctChange = prev === 0 ? null : Math.round(((totalInPeriod - prev) / prev) * 100);

  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - (mode === "daily" ? 6 : 55));
  const windowLabel = range
    ? `${fmt(range.start)} – ${fmt(range.end)}`
    : isAnchored
      ? `${fmt(windowStart)} – ${fmt(now)}`
      : (mode === "daily" ? "Last 7 days" : "Last 8 weeks");

  return (
    <section className="bg-white rounded-3xl p-6 shadow-sm">

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-3xl font-bold">Activity Trend</h2>
          <p className="text-slate-400 text-sm mt-1">
            {windowLabel} &nbsp;·&nbsp;
            {totalInPeriod} prompts
            {pctChange !== null && (
              <span className={`ml-2 font-semibold ${pctChange > 0 ? "text-amber-500" : "text-emerald-500"}`}>
                {pctChange > 0 ? "▲" : "▼"} {Math.abs(pctChange)}% vs prior period
              </span>
            )}
          </p>
        </div>

        {!range && (
          <div className="flex gap-1 bg-slate-100 rounded-full p-1">
            {(["daily", "weekly"] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`
                  px-4 py-1.5 rounded-full text-sm font-semibold transition-all
                  ${mode === m
                    ? "bg-[#06B6D4] text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700"}
                `}
              >
                {m === "daily" ? "7 Days" : "8 Weeks"}
              </button>
            ))}
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 16, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: "13px", paddingTop: "16px" }}
            iconType="circle"
            iconSize={8}
          />
          <Line
            type="monotone"
            dataKey="Prompts"
            stroke="#06B6D4"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "#06B6D4", strokeWidth: 0 }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="Alerts"
            stroke="#F59E0B"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "#F59E0B", strokeWidth: 0 }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="Blocked"
            stroke="#DC2626"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "#DC2626", strokeWidth: 0 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>

    </section>
  );
}
