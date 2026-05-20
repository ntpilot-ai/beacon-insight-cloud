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

function SeverityBadge({ risk }: { risk: string }) {
  const cfg: Record<string, { label: string; dot: string; text: string }> = {
    high:   { label: "High",     dot: "#DC2626", text: "text-red-600" },
    medium: { label: "Medium",   dot: "#F59E0B", text: "text-amber-600" },
    low:    { label: "Low",      dot: "#10B981", text: "text-emerald-600" },
    critical:{ label: "Critical", dot: "#7C3AED", text: "text-purple-600" },
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
  if (risk === "high" || risk === "critical") {
    return <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Escalated</span>;
  }
  if (risk === "medium") {
    return <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">In Review</span>;
  }
  return <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">Monitoring</span>;
}

export default function EventsTable({ events }: { events: BeaconEvent[] }) {
  const rows = events.slice(0, 8);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-[#013B93]">Recent Safeguarding Events</h2>
          <p className="text-xs text-slate-400 mt-0.5">AI-flagged incidents requiring review or follow-up</p>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="text-left text-xs font-semibold text-slate-400 pb-3 pr-4">Student</th>
            <th className="text-left text-xs font-semibold text-slate-400 pb-3 pr-4">Category</th>
            <th className="text-left text-xs font-semibold text-slate-400 pb-3 pr-4">Severity</th>
            <th className="text-left text-xs font-semibold text-slate-400 pb-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((event) => (
            <tr key={event.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
              <td className="py-3 pr-4 font-medium text-slate-700">{event.student_id ?? "Unknown"}</td>
              <td className="py-3 pr-4 text-slate-500">{categoryFromMatched(event.matched)}</td>
              <td className="py-3 pr-4"><SeverityBadge risk={event.risk} /></td>
              <td className="py-3"><StatusBadge risk={event.risk} /></td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-8 text-center text-slate-400 text-sm">No events yet</td>
            </tr>
          )}
        </tbody>
      </table>

      <button className="mt-4 text-sm text-[#013B93] font-semibold hover:underline flex items-center gap-1">
        View all events →
      </button>
    </div>
  );
}
