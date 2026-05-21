"use client";

import { useRouter } from "next/navigation";

export default function QuickActions() {
  const router = useRouter();

  const ACTIONS = [
    {
      icon:    "🔍",
      label:   "Review Critical Alerts",
      onClick: () => document.getElementById("repeat-incidents")?.scrollIntoView({ behavior: "smooth" }),
    },
    {
      icon:    "⬇",
      label:   "Download Safeguarding Report",
      onClick: () => router.push("/reports/school"),
    },
    {
      icon:    "👨‍👩‍👧",
      label:   "Student Report",
      onClick: () => router.push("/reports/student"),
    },
    {
      icon:    "🛡",
      label:   "Manage Policies",
      onClick: () => router.push("/atlas"),
    },
  ];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
      <h2 className="text-lg font-bold text-[#06B6D4] mb-4">Quick Actions</h2>
      <div className="grid grid-cols-2 gap-3">
        {ACTIONS.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className="flex items-center gap-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl px-4 py-3 hover:border-[#06B6D4] hover:text-[#06B6D4] hover:bg-blue-50/50 transition-all text-left"
          >
            <span className="text-base shrink-0">{a.icon}</span>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
