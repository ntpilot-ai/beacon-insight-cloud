"use client";

const BEACON_BLUE = "#013B93";

export function SubjectRail({
  subjects,
  active,
  totalCount,
  onPick,
}: {
  subjects:   { subject: string; count: number }[];
  active:     string | null;
  totalCount: number;
  onPick:     (subject: string | null) => void;
}) {
  return (
    <aside className="hidden md:block w-56 shrink-0 border-r border-slate-100 bg-white overflow-y-auto">
      <div className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        Subjects
      </div>
      <nav className="px-2 pb-4 space-y-0.5">
        <button
          onClick={() => onPick(null)}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
            active === null
              ? "bg-[#E6EDF8] text-[#013B93] font-semibold"
              : "text-slate-700 hover:bg-slate-50"
          }`}
        >
          <span>All notes</span>
          <span className="text-xs text-slate-400">{totalCount}</span>
        </button>
        {subjects.map(s => (
          <button
            key={s.subject}
            onClick={() => onPick(s.subject)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
              active === s.subject
                ? "bg-[#E6EDF8] text-[#013B93] font-semibold"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <span className="truncate">{s.subject}</span>
            <span className="text-xs text-slate-400">{s.count}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
