"use client";

import { useMemo, useState } from "react";

interface BeaconEvent {
  id:         number;
  student_id: string;
  risk:       string;
  blocked:    boolean;
  created_at: string;
  prompt:     string;
  matched:    string[];
  platform:   string;
}

interface Props {
  events: BeaconEvent[];
}

interface StudentSummary {
  student_id: string;
  high:       number;
  medium:     number;
  total:      number;
  last_seen:  string;
  status:     "Critical" | "Escalated" | "Review" | "Monitoring";
  incidents:  BeaconEvent[];
}

function statusFromCounts(high: number, medium: number): StudentSummary["status"] {
  if (high >= 3)   return "Critical";
  if (high >= 1)   return "Escalated";
  if (medium >= 3) return "Review";
  return "Monitoring";
}

const STATUS_STYLE: Record<StudentSummary["status"], { badge: string }> = {
  Critical:   { badge: "bg-purple-100 text-purple-700" },
  Escalated:  { badge: "bg-red-100 text-red-700"       },
  Review:     { badge: "bg-amber-100 text-amber-700"   },
  Monitoring: { badge: "bg-slate-100 text-slate-500"   },
};

const RISK_STYLE: Record<string, { dot: string; text: string; row: string }> = {
  high:     { dot: "#DC2626", text: "text-red-600",    row: "border-red-200 bg-red-50/40"    },
  critical: { dot: "#7C3AED", text: "text-purple-600", row: "border-purple-200 bg-purple-50/40" },
  medium:   { dot: "#F59E0B", text: "text-amber-600",  row: "border-amber-200 bg-amber-50/40"  },
};

function categoryFromMatched(matched: string[]): string {
  if (!matched?.length) return "General";
  const m = matched.join(" ").toLowerCase();
  if (m.includes("harm") || m.includes("hurt") || m.includes("suicide")) return "Self-harm";
  if (m.includes("bully") || m.includes("threaten")) return "Bullying";
  if (m.includes("weapon") || m.includes("violen")) return "Violence";
  if (m.includes("sex") || m.includes("explicit") || m.includes("adult")) return "Inappropriate Content";
  if (m.includes("drug") || m.includes("alcohol") || m.includes("weed")) return "Substance";
  if (m.includes("essay") || m.includes("homework") || m.includes("write")) return "Academic Integrity";
  return "General";
}

function StudentRow({ student, maxTotal }: { student: StudentSummary; maxTotal: number }) {
  const [open, setOpen]           = useState(false);
  const [expanded, setExpanded]   = useState<number | null>(null);
  const style                     = STATUS_STYLE[student.status];
  const highPct                   = (student.high   / maxTotal) * 100;
  const medPct                    = (student.medium / maxTotal) * 100;

  return (
    <>
      {/* ── Summary row ─────────────────────────────────────────────────── */}
      <tr
        className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        <td className="py-3 pr-4">
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-bold text-slate-400 inline-block transition-transform duration-200"
              style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
            >▶</span>
            <span className="font-medium text-slate-700">{student.student_id}</span>
          </div>
        </td>

        {/* Stacked bar */}
        <td className="py-3 pr-4">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden flex">
              <div className="h-full transition-all duration-500" style={{ width: `${highPct}%`,  background: "#DC2626" }} />
              <div className="h-full transition-all duration-500" style={{ width: `${medPct}%`,   background: "#F59E0B" }} />
            </div>
            <span className="text-xs text-slate-400 w-12 text-right shrink-0">{student.total} total</span>
          </div>
        </td>

        <td className="py-3 pr-4 text-center">
          <span className={`text-sm font-bold ${student.high > 0 ? "text-red-600" : "text-slate-300"}`}>{student.high}</span>
        </td>
        <td className="py-3 pr-4 text-center">
          <span className={`text-sm font-bold ${student.medium > 0 ? "text-amber-500" : "text-slate-300"}`}>{student.medium}</span>
        </td>

        <td className="py-3 pr-4 text-slate-500 text-xs">
          {new Date(student.last_seen).toLocaleDateString("en-GB", {
            day: "numeric", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit"
          })}
        </td>

        <td className="py-3">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${style.badge}`}>
            {student.status}
          </span>
        </td>
      </tr>

      {/* ── Expanded incident rows ───────────────────────────────────────── */}
      {open && (
        <>
          {/* Sub-header */}
          <tr className="bg-slate-50">
            <td colSpan={6} className="px-8 py-2">
              <div className="flex items-center gap-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <span className="w-32">Date / Time</span>
                <span className="w-28">Platform</span>
                <span className="w-24">Category</span>
                <span className="w-20">Severity</span>
                <span className="flex-1">Prompt</span>
                <span className="w-20">Blocked</span>
              </div>
            </td>
          </tr>

          {student.incidents.map((event, idx) => {
            const rs      = RISK_STYLE[event.risk] ?? RISK_STYLE.medium;
            const isOpen  = expanded === idx;
            const short   = event.prompt?.slice(0, 80);
            const hasMore = event.prompt?.length > 80;

            return (
              <tr
                key={event.id ?? idx}
                className={`border-b border-l-2 ${rs.row} transition-colors`}
              >
                <td colSpan={6} className="px-8 py-3">
                  <div className="flex items-start gap-4 text-sm">

                    {/* Timestamp */}
                    <div className="w-32 shrink-0 text-xs text-slate-500 pt-0.5">
                      {new Date(event.created_at).toLocaleDateString("en-GB", {
                        day: "numeric", month: "short"
                      })}
                      <br />
                      <span className="text-slate-400">
                        {new Date(event.created_at).toLocaleTimeString("en-GB", {
                          hour: "2-digit", minute: "2-digit", second: "2-digit"
                        })}
                      </span>
                    </div>

                    {/* Platform */}
                    <div className="w-28 shrink-0 text-xs text-slate-500 pt-0.5 truncate">
                      {event.platform?.replace("www.", "") ?? "—"}
                    </div>

                    {/* Category */}
                    <div className="w-24 shrink-0 text-xs text-slate-500 pt-0.5">
                      {categoryFromMatched(event.matched)}
                    </div>

                    {/* Severity */}
                    <div className="w-20 shrink-0 pt-0.5">
                      <span className={`flex items-center gap-1.5 text-xs font-semibold ${rs.text}`}>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: rs.dot }} />
                        {event.risk.charAt(0).toUpperCase() + event.risk.slice(1)}
                      </span>
                    </div>

                    {/* Prompt */}
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-700 leading-relaxed break-words">
                        {isOpen ? event.prompt : short}
                        {hasMore && !isOpen && "…"}
                      </p>
                      {hasMore && (
                        <button
                          onClick={e => { e.stopPropagation(); setExpanded(isOpen ? null : idx); }}
                          className={`mt-1 text-xs font-semibold ${rs.text} hover:underline`}
                        >
                          {isOpen ? "Show less ↑" : "Show full prompt ↓"}
                        </button>
                      )}
                      {event.matched?.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {event.matched.map(m => (
                            <span key={m} className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Blocked */}
                    <div className="w-20 shrink-0 text-center pt-0.5">
                      {event.blocked
                        ? <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">Blocked</span>
                        : <span className="text-xs text-slate-400">Allowed</span>
                      }
                    </div>

                  </div>
                </td>
              </tr>
            );
          })}
        </>
      )}
    </>
  );
}

export default function RepeatIncidents({ events }: Props) {
  const [sortBy, setSortBy] = useState<"total" | "high" | "medium" | "last_seen">("total");
  const [showAll, setShowAll] = useState(false);

  const students = useMemo<StudentSummary[]>(() => {
    const map: Record<string, StudentSummary> = {};

    events.forEach(e => {
      if (e.risk === "low") return;
      const id = e.student_id ?? "Unknown";
      if (!map[id]) {
        map[id] = { student_id: id, high: 0, medium: 0, total: 0, last_seen: e.created_at, status: "Monitoring", incidents: [] };
      }
      if (e.risk === "high" || e.risk === "critical") map[id].high++;
      if (e.risk === "medium") map[id].medium++;
      map[id].total++;
      map[id].incidents.push(e);
      if (new Date(e.created_at) > new Date(map[id].last_seen)) {
        map[id].last_seen = e.created_at;
      }
    });

    return Object.values(map)
      .map(s => ({
        ...s,
        status: statusFromCounts(s.high, s.medium),
        // Sort incidents chronologically newest first
        incidents: s.incidents.sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ),
      }))
      .filter(s => s.total >= 1)
      .sort((a, b) => {
        if (sortBy === "last_seen") return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
        return b[sortBy] - a[sortBy];
      });
  }, [events, sortBy]);

  const visible  = showAll ? students : students.slice(0, 5);
  const maxTotal = students[0]?.total || 1;

  if (!students.length) return null;

  const summary = {
    critical:  students.filter(s => s.status === "Critical").length,
    escalated: students.filter(s => s.status === "Escalated").length,
    review:    students.filter(s => s.status === "Review").length,
  };

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">

      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-[#06B6D4]">Repeat Incidents</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Click any student to see their full incident history
          </p>
        </div>

        <div className="flex items-center gap-2">
          {summary.critical > 0 && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">{summary.critical} Critical</span>
          )}
          {summary.escalated > 0 && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700">{summary.escalated} Escalated</span>
          )}
          {summary.review > 0 && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">{summary.review} Review</span>
          )}
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
          {visible.map(s => (
            <StudentRow key={s.student_id} student={s} maxTotal={maxTotal} />
          ))}
        </tbody>
      </table>

      {students.length > 5 && (
        <button
          onClick={() => setShowAll(s => !s)}
          className="mt-4 text-sm text-[#06B6D4] font-semibold hover:underline"
        >
          {showAll ? "Show less ↑" : `Show all ${students.length} students ↓`}
        </button>
      )}

    </section>
  );
}
