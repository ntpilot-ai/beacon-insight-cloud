interface Props {
  events: { risk: string }[];
}

const RISK_CONFIG = [
  { key: "low",      label: "Low Risk",    color: "#013B93" },
  { key: "medium",   label: "Medium Risk", color: "#F59E0B" },
  { key: "high",     label: "High Risk",   color: "#DC2626" },
  { key: "critical", label: "Critical",    color: "#7C3AED" },
];

export default function RiskBreakdown({ events }: Props) {
  const total = events.length || 1;

  const counts = RISK_CONFIG.map(r => ({
    ...r,
    count: events.filter(e => e.risk === r.key).length,
    pct: Math.round((events.filter(e => e.risk === r.key).length / total) * 100),
  }));

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-lg font-bold text-[#013B93]">Risk Breakdown</h2>
        <span
          title="Risk scores are calculated from prompt content and matched keywords"
          className="w-4 h-4 rounded-full bg-slate-200 text-slate-500 text-[10px] flex items-center justify-center cursor-help shrink-0"
        >?</span>
      </div>

      <div className="space-y-4 mt-5">
        {counts.map(r => (
          <div key={r.key}>
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-slate-600 font-medium">{r.label}</span>
              <span className="text-slate-400 font-semibold">{r.pct}%</span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${r.pct}%`, background: r.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
