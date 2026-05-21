"use client";

import { useMemo, useState } from "react";

interface BeaconEvent {
  student_id: string;
  risk: string;
  blocked: boolean;
  created_at: string;
}

interface Props {
  events: BeaconEvent[];
}

interface StudentSummary {
  student_id: string;
  high:        number;
  medium:      number;
  total:       number;
  last_seen:   string;
  status:      "Critical" | "Escalated" | "Review" | "Monitoring";
}

function statusFromCounts(high: number, medium: number): StudentSummary["status"] {
  if (high >= 3)               return "Critical";
  if (high >= 1)               return "Escalated";
  if (medium >= 3)             return "Review";
  return "Monitoring";
}

const STATUS_STYLE: Record<StudentSummary["status"], { badge: string; bar: string }> = {
  Critical:   { badge: "bg-purple-100 text-purple-700", bar: "#7C3AED" },
  Escalated:  { badge: "bg-red-100 text-red-700",       bar: "#DC2626" },
  Review:     { badge: "bg-amber-100 text-amber-700",   bar: "#F59E0B" },
  Monitoring: { badge: "bg-slate-100 text-slate-500",   bar: "#10B981" },
};

export default function RepeatIncidents({ events }: Props) {
  const [sortBy, setSortBy] = useState<"total" | "high" | "medium" | "last_seen">("total");
  const [showAll, setShowAll] = useState(false);

  const students = useMemo<StudentSummary[]>(() => {
    const map: Record<string, StudentSummary> = {};

    events.forEach(e => {
      if (e.risk === "low") return; // only count medium/high
      const id = e.student_id ?? "Unknown";
      if (!map[id]) {
        map[id] = { student_id: id, high: 0, medium: 0, total: 0, last_seen: e.created_at, status: "Monitoring" };
      }
      if (e.risk === "high" || e.risk === "critical") map[id].high++;
      if (e.risk === "medium") map[id].medium++;
      map[id].total++;
      if (new Date(e.created_at) > new Date(map[id].last_seen)) {
        map[id].last_seen = e.created_at;
      }
    });

    return Object.values(map)
      .map(s => ({ ...s, status: statusFromCounts(s.high, s.medium) }))
      .filter(s => s.total >= 1)
      .sort((a, b) => {
        if (sortBy === "last_seen") return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
        return b[sortBy] - a[sortBy];
      });
  }, [events, sortBy]);

  const visible   = showAll ? students : students.slice(0, 5);
  const maxTotal  = students[0]?.total || 1;

  if (!students.length) return null;

  const summary = {
    critical:  students.filter(s => s.status === "Critical").length,
    escalated: students.filter(s => s.status === "Escalated").length,
    review:    students.filter(s => s.status === "Review").length,
  };

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-[#013B93]">Repeat Incidents</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Students with 2 or more medium/high risk events
          </p>
        </div>

        {/* Summary pills */}
        <div className="flex items-center gap-2">
          {summary.critical > 0 && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">
              {summary.critical} Critical
            </span>
          )}
          {summary.escalated > 0 && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700">
              {summary.escalated} Escalated
            </span>
          )}
          {summary.review > 0 && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
              {summary.review} Review
            </span>
          )}

          {/* Sort control */}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="ml-2 text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-500 bg-white focus:outline-none"
          >
            <option value="total">Sort: Total</option>
            <option value="high">Sort: High Risk</option>
            <option value="medium">Sort: Medium Risk</option>
            <option value="last_seen">Sort: Recent</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="text-left text-xs font-semibold text-slate-400 pb-3 pr-4">Student</th>
            <th className="text-left text-xs font-semibold text-slate-400 pb-3 pr-4">Incident Breakdown</th>
            <th className="text-center text-xs font-semibold text-slate-400 pb-3 pr-4 w-20">High</th>
            <th className="text-center text-xs font-semibold text-slate-400 pb-3 pr-4 w-20">Medium</th>
            <th className="text-left text-xs font-semibold text-slate-400 pb-3 pr-4">Last Incident</th>
            <th className="text-left text-xs font-semibold text-slate-400 pb-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(s => {
            const style    = STATUS_STYLE[s.status];
            const highPct  = (s.high   / maxTotal) * 100;
            const medPct   = (s.medium / maxTotal) * 100;

            return (
              <tr key={s.student_id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">

                {/* Student */}
                <td className="py-3 pr-4 font-medium text-slate-700 w-40">
                  {s.student_id}
                </td>

                {/* Stacked bar */}
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden flex">
                      <div
                        className="h-full rounded-l-full transition-all duration-500"
                        style={{ width: `${highPct}%`, background: "#DC2626" }}
                      />
                      <div
                        className="h-full transition-all duration-500"
                        style={{ width: `${medPct}%`, background: "#F59E0B" }}
                      />
                    </div>
                    <span className="text-xs text-slate-400 w-12 text-right shrink-0">
                      {s.total} total
                    </span>
                  </div>
                </td>

                {/* High count */}
                <td className="py-3 pr-4 text-center">
                  <span className={`text-sm font-bold ${s.high > 0 ? "text-red-600" : "text-slate-300"}`}>
                    {s.high}
                  </span>
                </td>

                {/* Medium count */}
                <td className="py-3 pr-4 text-center">
                  <span className={`text-sm font-bold ${s.medium > 0 ? "text-amber-500" : "text-slate-300"}`}>
                    {s.medium}
                  </span>
                </td>

                {/* Last incident */}
                <td className="py-3 pr-4 text-slate-500 text-xs">
                  {new Date(s.last_seen).toLocaleDateString("en-GB", {
                    day: "numeric", month: "short", year: "numeric",
                    hour: "2-digit", minute: "2-digit"
                  })}
                </td>

                {/* Status badge */}
                <td className="py-3">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${style.badge}`}>
                    {s.status}
                  </span>
                </td>

              </tr>
            );
          })}
        </tbody>
      </table>

      {students.length > 5 && (
        <button
          onClick={() => setShowAll(s => !s)}
          className="mt-4 text-sm text-[#013B93] font-semibold hover:underline"
        >
          {showAll ? "Show less ↑" : `Show all ${students.length} students ↓`}
        </button>
      )}

    </section>
  );
}
