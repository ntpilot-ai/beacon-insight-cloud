"use client";

const BEACON_BLUE = "#013B93";

export function QuizBanner({
  topic,
  onStop,
}: {
  topic:  string;
  onStop: () => void;
}) {
  return (
    <div
      className="px-4 md:px-5 py-2.5 flex items-center justify-between gap-3 shrink-0 border-b"
      style={{ backgroundColor: "#E6EDF8", borderColor: "#C6D4ED" }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-white text-xs font-bold"
          style={{ backgroundColor: BEACON_BLUE }}
          aria-hidden
        >
          ✓
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: BEACON_BLUE }}>
            Quiz mode
          </div>
          <div className="text-sm font-semibold text-slate-800 truncate">{topic}</div>
        </div>
      </div>
      <button
        onClick={onStop}
        className="text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg transition-colors shrink-0"
      >
        Stop quiz
      </button>
    </div>
  );
}
