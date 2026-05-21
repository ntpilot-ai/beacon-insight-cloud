interface Props {
  totalPrompts: number;
  alerts: number;
  blocked: number;
  wellbeing: string;
  wellbeingDelta?: number;
}

function KPICard({
  icon,
  label,
  value,
  delta,
  deltaLabel,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  delta?: React.ReactNode;
  deltaLabel?: string;
  accent: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
          style={{ background: `${accent}18`, color: accent }}
        >
          {icon}
        </div>
        <span className="text-sm text-slate-500 font-medium">{label}</span>
      </div>
      <div className="text-4xl font-bold text-[#06B6D4]" style={{ color: accent }}>
        {value}
      </div>
      {delta !== undefined && (
        <div className="text-xs text-slate-400">
          {delta} <span className="ml-1">{deltaLabel}</span>
        </div>
      )}
    </div>
  );
}

export default function KPIGrid({ totalPrompts, alerts, blocked, wellbeing, wellbeingDelta = 0 }: Props) {
  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      <KPICard
        icon="👥"
        label="Students Monitored"
        value={totalPrompts}
        delta={<span className="text-emerald-500 font-semibold">↑ 12 this week</span>}
        accent="#06B6D4"
      />
      <KPICard
        icon="🔔"
        label="Open Alerts"
        value={<span className="text-amber-500">{alerts}</span>}
        delta={null}
        deltaLabel="5 require review today"
        accent="#F59E0B"
      />
      <KPICard
        icon="🚩"
        label="Critical Incidents"
        value={<span className="text-red-500">{blocked}</span>}
        deltaLabel="Escalated to safeguarding lead"
        accent="#DC2626"
      />
      <KPICard
        icon="💚"
        label="Average Wellbeing Score"
        value={
          <span className="text-emerald-500">
            {wellbeing}
            <span className="text-2xl text-slate-400 font-normal"> /10</span>
          </span>
        }
        delta={
          wellbeingDelta >= 0
            ? <span className="text-emerald-500 font-semibold">↑ Improved +{wellbeingDelta.toFixed(1)}</span>
            : <span className="text-red-500 font-semibold">↓ {wellbeingDelta.toFixed(1)}</span>
        }
        accent="#10B981"
      />
    </div>
  );
}
