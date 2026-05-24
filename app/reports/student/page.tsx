"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { SCHOOL_NAME } from "@/lib/config";
import Image from "next/image";
import { useAuth } from "@/lib/useAuth";

interface BeaconEvent {
  id:         number;
  created_at: string;
  student_id: string;
  platform:   string;
  prompt:     string;
  risk:       string;
  blocked:    boolean;
  matched:    string[];
}

function categoryFromMatched(matched: string[]): string {
  if (!matched?.length) return "General";
  const m = matched.join(" ").toLowerCase();
  if (m.includes("harm") || m.includes("suicide")) return "Self-harm";
  if (m.includes("bully") || m.includes("threaten")) return "Bullying";
  if (m.includes("weapon") || m.includes("violen")) return "Violence";
  if (m.includes("sex") || m.includes("explicit")) return "Inappropriate Content";
  if (m.includes("drug") || m.includes("alcohol") || m.includes("weed")) return "Substance";
  return "General";
}

const RISK_COLOR: Record<string, string> = {
  high:     "#DC2626",
  critical: "#7C3AED",
  medium:   "#F59E0B",
  low:      "#10B981",
};

function StudentReportContent() {
  const { loading: authLoading, authenticated } = useAuth();
  const params    = useSearchParams();
  const studentId = params.get("student") || "";

  const [events, setEvents]     = useState<BeaconEvent[]>([]);
  const [allStudents, setAllStudents] = useState<string[]>([]);
  const [selected, setSelected] = useState(studentId);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    supabase.from("beacon_events").select("*").order("created_at", { ascending: false })
      .range(0, 49999)
      .then(({ data }) => {
        const evts = (data as BeaconEvent[]) || [];
        setEvents(evts);
        const ids = [...new Set(evts.map(e => e.student_id))].sort();
        setAllStudents(ids);
        if (!selected && ids.length) setSelected(ids[0]);
        setLoading(false);
      });
  }, []);

  const studentEvents = useMemo(() =>
    events.filter(e => e.student_id === selected).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ),
    [events, selected]
  );

  const high    = studentEvents.filter(e => e.risk === "high" || e.risk === "critical").length;
  const medium  = studentEvents.filter(e => e.risk === "medium").length;
  const low     = studentEvents.filter(e => e.risk === "low").length;
  const blocked = studentEvents.filter(e => e.blocked).length;
  const status  = high >= 3 ? "Critical" : high >= 1 ? "Escalated" : medium >= 3 ? "Review" : "Monitoring";

  const firstSeen = studentEvents.length ? new Date(studentEvents[studentEvents.length - 1].created_at) : null;
  const lastSeen  = studentEvents.length ? new Date(studentEvents[0].created_at) : null;

  const categoryMap: Record<string, number> = {};
  studentEvents.filter(e => e.risk !== "low").forEach(e => {
    const cat = categoryFromMatched(e.matched);
    categoryMap[cat] = (categoryMap[cat] || 0) + 1;
  });

  const generatedAt = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
  });

  if (authLoading || !authenticated) return null;

  return (
    <div className="min-h-screen bg-white">

      {/* Controls — back link only, print button moved to header */}
      <div className="print:hidden bg-[#06B6D4] text-white px-8 py-3 flex items-center">
        <a href="/" className="text-white/70 hover:text-white text-sm">← Back to Dashboard</a>
      </div>

      <div className="max-w-4xl mx-auto px-10 py-10 print:px-8 print:py-6">

        {/* Header */}
        <div className="mb-8 pb-6 border-b-2 border-[#06B6D4]">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 flex items-center justify-center">
                <Image src="/insight_icon.png" alt="Beacon Insight" width={36} height={36} className="object-contain" />
              </div>
              <div>
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Beacon Insight</div>
                <div className="text-xs text-slate-400">{SCHOOL_NAME}</div>
              </div>
            </div>
            <div className="text-right text-xs text-slate-400">
              <div>Generated: {generatedAt}</div>
              <div className="mt-1 font-semibold text-slate-500">CONFIDENTIAL</div>
            </div>
          </div>

          <h1 className="text-3xl font-bold text-[#06B6D4] mb-4">Student Safeguarding Report</h1>

          {/* Student selector + download — hidden when printing */}
          <div className="print:hidden flex items-center justify-between gap-4">
            <select
              value={selected}
              onChange={e => setSelected(e.target.value)}
              className="flex-1 max-w-sm border-2 border-[#06B6D4] rounded-xl px-4 py-2.5 text-slate-700 font-medium bg-white focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20 text-sm"
            >
              <option value="" disabled>Select Student</option>
              {allStudents.map(id => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>

            <button
              onClick={() => window.print()}
              disabled={!selected}
              className="bg-[#06B6D4] text-white font-bold px-6 py-2.5 rounded-xl hover:bg-[#012d70] disabled:opacity-40 transition-all text-sm flex items-center gap-2"
            >
              ⬇ Download PDF
            </button>
          </div>

          {/* Show selected student name when printing */}
          <div className="hidden print:block text-xl text-slate-600 mt-2">{selected || "—"}</div>
        </div>

        {/* Student summary */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total Events",    value: studentEvents.length, color: "#06B6D4" },
            { label: "High Risk",       value: high,                 color: "#DC2626" },
            { label: "Medium Risk",     value: medium,               color: "#F59E0B" },
            { label: "Blocked",         value: blocked,              color: "#7C3AED" },
          ].map(k => (
            <div key={k.label} className="border border-slate-200 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold" style={{ color: k.color }}>{k.value}</div>
              <div className="text-xs text-slate-500 mt-1">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Student details */}
        <div className="bg-slate-50 rounded-xl p-5 mb-8 grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-slate-400 mb-1">Status</div>
            <span className={`text-sm font-bold px-2.5 py-1 rounded-full ${
              status === "Critical"  ? "bg-purple-100 text-purple-700" :
              status === "Escalated" ? "bg-red-100 text-red-700" :
              status === "Review"    ? "bg-amber-100 text-amber-700" :
              "bg-slate-200 text-slate-600"
            }`}>{status}</span>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">First Seen</div>
            <div className="font-medium text-slate-700">
              {firstSeen ? firstSeen.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">Last Incident</div>
            <div className="font-medium text-slate-700">
              {lastSeen ? lastSeen.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
            </div>
          </div>
        </div>

        {/* Category breakdown */}
        {Object.keys(categoryMap).length > 0 && (
          <div className="mb-8">
            <h3 className="text-lg font-bold text-[#06B6D4] mb-4 pb-2 border-b border-slate-200">Incident Categories</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left px-4 py-2 text-slate-500 font-semibold">Category</th>
                  <th className="text-right px-4 py-2 text-slate-500 font-semibold">Count</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(categoryMap).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
                  <tr key={cat} className="border-b border-slate-100">
                    <td className="px-4 py-3">{cat}</td>
                    <td className="px-4 py-3 text-right font-semibold">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Full incident log */}
        <div className="mb-8">
          <h3 className="text-lg font-bold text-[#06B6D4] mb-4 pb-2 border-b border-slate-200">
            Full Incident Log ({studentEvents.filter(e => e.risk !== "low").length} flagged events)
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="text-left px-4 py-2 text-slate-500 font-semibold">Date / Time</th>
                <th className="text-left px-4 py-2 text-slate-500 font-semibold">Platform</th>
                <th className="text-left px-4 py-2 text-slate-500 font-semibold">Risk</th>
                <th className="text-left px-4 py-2 text-slate-500 font-semibold">Prompt</th>
                <th className="text-left px-4 py-2 text-slate-500 font-semibold">Matched</th>
                <th className="text-right px-4 py-2 text-slate-500 font-semibold">Blocked</th>
              </tr>
            </thead>
            <tbody>
              {studentEvents.filter(e => e.risk !== "low").map(event => (
                <tr key={event.id} className="border-b border-slate-100 align-top">
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {new Date(event.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}<br />
                    {new Date(event.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{event.platform}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-bold" style={{ color: RISK_COLOR[event.risk] ?? "#94a3b8" }}>
                      {event.risk.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 max-w-xs">{event.prompt}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{event.matched?.join(", ") || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {event.blocked
                      ? <span className="text-xs font-bold text-red-600">Yes</span>
                      : <span className="text-xs text-slate-400">No</span>
                    }
                  </td>
                </tr>
              ))}
              {studentEvents.filter(e => e.risk !== "low").length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No flagged incidents</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-slate-200 text-xs text-slate-400 flex justify-between">
          <span>Beacon Insight — {SCHOOL_NAME} — Student Report: {selected}</span>
          <span>CONFIDENTIAL — For authorised staff only</span>
        </div>

      </div>

      <style>{`
        @media print {
          @page { margin: 15mm; size: A4; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}

export default function StudentReportPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white flex items-center justify-center text-slate-400 text-sm">Loading...</div>}>
      <StudentReportContent />
    </Suspense>
  );
}
