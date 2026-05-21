"use client";

import { useState } from "react";

interface BeaconEvent {
  id: number;
  created_at: string;
  student_id: string;
  platform: string;
  prompt: string;
  risk: string;
  blocked: boolean;
  matched: string[];
}

function categoryFromMatched(matched: string[]): string {
  if (!matched?.length) return "General";
  const m = matched.join(" ").toLowerCase();
  if (m.includes("harm") || m.includes("hurt") || m.includes("suicide")) return "Self-harm";
  if (m.includes("bully") || m.includes("threaten")) return "Bullying";
  if (m.includes("weapon") || m.includes("violen")) return "Violence";
  if (m.includes("sex") || m.includes("explicit") || m.includes("adult")) return "Inappropriate Content";
  if (m.includes("drug") || m.includes("alcohol")) return "Substance";
  if (m.includes("essay") || m.includes("homework") || m.includes("write")) return "Academic Integrity";
  return "General";
}

const RISK_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function highestRisk(events: BeaconEvent[]): string {
  return events.reduce((best, e) =>
    (RISK_ORDER[e.risk] ?? 0) > (RISK_ORDER[best] ?? 0) ? e.risk : best,
    "low"
  );
}

function SeverityBadge({ risk }: { risk: string }) {
  const cfg: Record<string, { label: string; dot: string; text: string }> = {
    high:     { label: "High",     dot: "#DC2626", text: "text-red-600" },
    medium:   { label: "Medium",   dot: "#F59E0B", text: "text-amber-600" },
    low:      { label: "Low",      dot: "#10B981", text: "text-emerald-600" },
    critical: { label: "Critical", dot: "#7C3AED", text: "text-purple-600" },
  };
  const c = cfg[risk] ?? cfg.low;
  return (
    <span className={`flex items-center gap-1.5 text-sm font-medium ${c.text}`}>
      <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: c.dot }} />
      {c.label}
    </span>
  );
}

function StatusBadge({ risk }: { risk: string }) {
  if (risk === "critical" || risk === "high")
    return <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Escalated</span>;
  if (risk === "medium")
    return <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">In Review</span>;
  return <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">Monitoring</span>;
}

function StudentRow({ studentId, events }: { studentId: string; events: BeaconEvent[] }) {
  const [open, setOpen] = useState(false);
  const topRisk = highestRisk(events);
  const categories = [...new Set(events.map(e => categoryFromMatched(e.matched)))];

  return (
    <>
      {/* Summary row */}
      <tr
        className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        <td className="py-3 pr-4">
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-bold transition-transform duration-200 text-slate-400 inline-block"
              style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              ▶
            </span>
            <span className="font-medium text-slate-700">{studentId}</span>
          </div>
        </td>
        <td className="py-3 pr-4 text-slate-500 text-sm">{categories.slice(0, 2).join(", ")}{categories.length > 2 ? ` +${categories.length - 2}` : ""}</td>
        <td className="py-3 pr-4"><SeverityBadge risk={topRisk} /></td>
        <td className="py-3 pr-4"><StatusBadge risk={topRisk} /></td>
        <td className="py-3 text-right">
          <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
            {events.length} event{events.length !== 1 ? "s" : ""}
          </span>
        </td>
      </tr>

      {/* Expanded rows */}
      {open && events.map((event) => (
        <tr key={event.id} className="bg-slate-50/80 border-b border-slate-100">
          <td className="py-2.5 pl-8 pr-4 text-sm text-slate-400 w-[180px]">
            {new Date(event.created_at).toLocaleString("en-GB", {
              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
            })}
          </td>
          <td className="py-2.5 pr-4 text-sm text-slate-500">{categoryFromMatched(event.matched)}</td>
          <td className="py-2.5 pr-4"><SeverityBadge risk={event.risk} /></td>
          <td className="py-2.5 pr-4"><StatusBadge risk={event.risk} /></td>
          <td className="py-2.5 text-right">
            <span className="text-xs text-slate-400 italic truncate max-w-[120px] inline-block align-bottom" title={event.prompt}>
              {event.prompt?.slice(0, 40)}{event.prompt?.length > 40 ? "…" : ""}
            </span>
          </td>
        </tr>
      ))}
    </>
  );
}

export default function EventsTable({ events }: { events: BeaconEvent[] }) {
  // Group by student, sort by highest risk then event count
  const grouped = events.reduce((acc, e) => {
    const key = e.student_id ?? "Unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(e);
    return acc;
  }, {} as Record<string, BeaconEvent[]>);

  const sorted = Object.entries(grouped).sort(([, a], [, b]) => {
    const riskDiff = (RISK_ORDER[highestRisk(b)] ?? 0) - (RISK_ORDER[highestRisk(a)] ?? 0);
    return riskDiff !== 0 ? riskDiff : b.length - a.length;
  });

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-[#06B6D4]">Recent Safeguarding Events</h2>
          <p className="text-xs text-slate-400 mt-0.5">AI-flagged incidents requiring review or follow-up</p>
        </div>
        <span className="text-xs text-slate-400 font-medium">
          {sorted.length} student{sorted.length !== 1 ? "s" : ""} · {events.length} events
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="text-left text-xs font-semibold text-slate-400 pb-3 pr-4">Student</th>
            <th className="text-left text-xs font-semibold text-slate-400 pb-3 pr-4">Category</th>
            <th className="text-left text-xs font-semibold text-slate-400 pb-3 pr-4">Severity</th>
            <th className="text-left text-xs font-semibold text-slate-400 pb-3 pr-4">Status</th>
            <th className="text-right text-xs font-semibold text-slate-400 pb-3">Events</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={5} className="py-8 text-center text-slate-400 text-sm">No events yet</td>
            </tr>
          )}
          {sorted.map(([studentId, studentEvents]) => (
            <StudentRow key={studentId} studentId={studentId} events={studentEvents} />
          ))}
        </tbody>
      </table>

      <button className="mt-4 text-sm text-[#06B6D4] font-semibold hover:underline flex items-center gap-1">
        View all events →
      </button>
    </div>
  );
}
