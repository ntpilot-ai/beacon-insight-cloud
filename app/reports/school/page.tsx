"use client";

import { useEffect, useState, useMemo } from "react";
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

const TERMS = [
  { label: "Summer Term 2026", start: "2026-04-14", end: "2026-07-18" },
  { label: "Spring Term 2026", start: "2026-01-05", end: "2026-04-04" },
  { label: "Autumn Term 2025", start: "2025-09-02", end: "2025-12-19" },
  { label: "All Time",         start: "2000-01-01", end: "2099-12-31" },
];

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

export default function SchoolReportPage() {
  const { loading: authLoading, authenticated } = useAuth();
  const [events, setEvents]   = useState<BeaconEvent[]>([]);
  const [term, setTerm]       = useState(TERMS[0].label);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("beacon_events").select("*").order("created_at", { ascending: false })
      .range(0, 49999)
      .then(({ data }) => { setEvents((data as BeaconEvent[]) || []); setLoading(false); });
  }, []);

  const filtered = useMemo(() => {
    const t = TERMS.find(t => t.label === term) ?? TERMS[0];
    const s = new Date(t.start), e = new Date(t.end);
    e.setHours(23, 59, 59);
    return events.filter(ev => { const d = new Date(ev.created_at); return d >= s && d <= e; });
  }, [events, term]);

  const total    = filtered.length;
  const high     = filtered.filter(e => e.risk === "high" || e.risk === "critical").length;
  const medium   = filtered.filter(e => e.risk === "medium").length;
  const low      = filtered.filter(e => e.risk === "low").length;
  const blocked  = filtered.filter(e => e.blocked).length;
  const wellbeing = Math.max(1, 10 - ((high + medium) / Math.max(total, 1)) * 10).toFixed(1);

  const platformMap: Record<string, number> = {};
  filtered.forEach(e => { platformMap[e.platform || "unknown"] = (platformMap[e.platform || "unknown"] || 0) + 1; });
  const platforms = Object.entries(platformMap).sort((a, b) => b[1] - a[1]);

  const studentMap: Record<string, { high: number; medium: number; total: number; last: string }> = {};
  filtered.filter(e => e.risk !== "low").forEach(e => {
    if (!studentMap[e.student_id]) studentMap[e.student_id] = { high: 0, medium: 0, total: 0, last: e.created_at };
    if (e.risk === "high" || e.risk === "critical") studentMap[e.student_id].high++;
    if (e.risk === "medium") studentMap[e.student_id].medium++;
    studentMap[e.student_id].total++;
    if (new Date(e.created_at) > new Date(studentMap[e.student_id].last)) studentMap[e.student_id].last = e.created_at;
  });
  const students = Object.entries(studentMap).sort((a, b) => b[1].total - a[1].total);

  const categoryMap: Record<string, number> = {};
  filtered.filter(e => e.risk !== "low").forEach(e => {
    const cat = categoryFromMatched(e.matched);
    categoryMap[cat] = (categoryMap[cat] || 0) + 1;
  });
  const categories = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);

  const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

  if (authLoading) return null;
  if (!authenticated) return null;

  return (
    <div className="min-h-screen bg-white">

      {/* Print controls — hidden when printing */}
      <div className="print:hidden bg-[#06B6D4] text-white px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="text-white/70 hover:text-white text-sm">← Back to Dashboard</a>
          <select
            value={term}
            onChange={e => setTerm(e.target.value)}
            className="text-sm bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-white"
          >
            {TERMS.map(t => <option key={t.label} value={t.label} className="text-slate-800">{t.label}</option>)}
          </select>
        </div>
        <button
          onClick={() => window.print()}
          className="bg-white text-[#06B6D4] font-bold px-6 py-2 rounded-xl hover:bg-blue-50 transition-all text-sm"
        >
          ⬇ Download PDF
        </button>
      </div>

      {/* Report content */}
      <div className="max-w-4xl mx-auto px-10 py-10 print:px-8 print:py-6">

        {/* Header */}
        <div className="flex items-start justify-between mb-8 pb-6 border-b-2 border-[#06B6D4]">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 flex items-center justify-center">
                <Image src="/insight_icon.png" alt="Beacon Insight" width={36} height={36} className="object-contain" />
              </div>
              <div>
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Beacon Insight</div>
                <div className="text-xs text-slate-400">Safeguarding Intelligence Platform</div>
              </div>
            </div>
            <h1 className="text-3xl font-bold text-[#06B6D4] mt-3">{SCHOOL_NAME}</h1>
            <h2 className="text-xl text-slate-600 mt-1">Safeguarding Report — {term}</h2>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div>Generated: {generatedAt}</div>
            <div className="mt-1 font-semibold text-slate-500">CONFIDENTIAL</div>
          </div>
        </div>

        {/* KPI summary */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total Prompts",     value: total,    color: "#06B6D4" },
            { label: "High Risk",          value: high,     color: "#DC2626" },
            { label: "Medium Risk",        value: medium,   color: "#F59E0B" },
            { label: "Wellbeing Score",    value: wellbeing, color: "#10B981" },
          ].map(k => (
            <div key={k.label} className="border border-slate-200 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold" style={{ color: k.color }}>{k.value}</div>
              <div className="text-xs text-slate-500 mt-1">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Risk breakdown */}
        <div className="mb-8">
          <h3 className="text-lg font-bold text-[#06B6D4] mb-4 pb-2 border-b border-slate-200">Risk Breakdown</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="text-left px-4 py-2 text-slate-500 font-semibold">Risk Level</th>
                <th className="text-right px-4 py-2 text-slate-500 font-semibold">Count</th>
                <th className="text-right px-4 py-2 text-slate-500 font-semibold">% of Total</th>
                <th className="text-right px-4 py-2 text-slate-500 font-semibold">Blocked</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "High / Critical", count: high,   color: "#DC2626" },
                { label: "Medium",          count: medium, color: "#F59E0B" },
                { label: "Low",             count: low,    color: "#10B981" },
              ].map(r => (
                <tr key={r.label} className="border-b border-slate-100">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />
                      {r.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{r.count}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{total ? ((r.count / total) * 100).toFixed(1) : 0}%</td>
                  <td className="px-4 py-3 text-right text-slate-500">{r.label.includes("High") ? blocked : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Platform usage */}
        <div className="mb-8">
          <h3 className="text-lg font-bold text-[#06B6D4] mb-4 pb-2 border-b border-slate-200">Platform Usage</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="text-left px-4 py-2 text-slate-500 font-semibold">Platform</th>
                <th className="text-right px-4 py-2 text-slate-500 font-semibold">Prompts</th>
                <th className="text-right px-4 py-2 text-slate-500 font-semibold">% Share</th>
              </tr>
            </thead>
            <tbody>
              {platforms.map(([name, count]) => (
                <tr key={name} className="border-b border-slate-100">
                  <td className="px-4 py-3">{name}</td>
                  <td className="px-4 py-3 text-right font-semibold">{count}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{total ? ((count / total) * 100).toFixed(1) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Incident categories */}
        {categories.length > 0 && (
          <div className="mb-8">
            <h3 className="text-lg font-bold text-[#06B6D4] mb-4 pb-2 border-b border-slate-200">Incident Categories</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left px-4 py-2 text-slate-500 font-semibold">Category</th>
                  <th className="text-right px-4 py-2 text-slate-500 font-semibold">Incidents</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(([cat, count]) => (
                  <tr key={cat} className="border-b border-slate-100">
                    <td className="px-4 py-3">{cat}</td>
                    <td className="px-4 py-3 text-right font-semibold">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Students of concern */}
        {students.length > 0 && (
          <div className="mb-8">
            <h3 className="text-lg font-bold text-[#06B6D4] mb-4 pb-2 border-b border-slate-200">Students of Concern</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left px-4 py-2 text-slate-500 font-semibold">Student</th>
                  <th className="text-right px-4 py-2 text-slate-500 font-semibold">High Risk</th>
                  <th className="text-right px-4 py-2 text-slate-500 font-semibold">Medium Risk</th>
                  <th className="text-right px-4 py-2 text-slate-500 font-semibold">Total</th>
                  <th className="text-right px-4 py-2 text-slate-500 font-semibold">Last Incident</th>
                  <th className="text-left px-4 py-2 text-slate-500 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {students.map(([id, s]) => {
                  const status = s.high >= 3 ? "Critical" : s.high >= 1 ? "Escalated" : s.medium >= 3 ? "Review" : "Monitoring";
                  return (
                    <tr key={id} className="border-b border-slate-100">
                      <td className="px-4 py-3 font-medium">{id}</td>
                      <td className="px-4 py-3 text-right text-red-600 font-semibold">{s.high}</td>
                      <td className="px-4 py-3 text-right text-amber-500 font-semibold">{s.medium}</td>
                      <td className="px-4 py-3 text-right font-semibold">{s.total}</td>
                      <td className="px-4 py-3 text-right text-slate-500 text-xs">
                        {new Date(s.last).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          status === "Critical" ? "bg-purple-100 text-purple-700" :
                          status === "Escalated" ? "bg-red-100 text-red-700" :
                          status === "Review" ? "bg-amber-100 text-amber-700" :
                          "bg-slate-100 text-slate-500"
                        }`}>{status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-slate-200 text-xs text-slate-400 flex justify-between">
          <span>Beacon Insight — {SCHOOL_NAME} — {term}</span>
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
