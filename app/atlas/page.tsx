"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Sidebar from "@/components/Sidebar";

interface Policy {
  id: string;
  word: string;
  severity: "high" | "medium";
  school_id: string;
}

const SEVERITY_CONFIG = {
  high: {
    label:      "High Risk",
    desc:       "Prompt is blocked immediately and student is warned",
    accent:     "#DC2626",
    bg:         "#FEF2F2",
    badge:      "bg-red-100 text-red-700",
  },
  medium: {
    label:      "Medium Risk",
    desc:       "Prompt is allowed but flagged and a warning is shown",
    accent:     "#F59E0B",
    bg:         "#FFFBEB",
    badge:      "bg-amber-100 text-amber-700",
  },
};

const SCHOOL_ID = "default"; // extend later for multi-school

export default function AtlasPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading]   = useState(true);
  const [word, setWord]         = useState("");
  const [severity, setSeverity] = useState<"high" | "medium">("high");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  async function loadPolicies() {
    const { data } = await supabase
      .from("beacon_policies")
      .select("*")
      .eq("school_id", SCHOOL_ID)
      .order("severity")
      .order("word");
    setPolicies((data as Policy[]) || []);
    setLoading(false);
  }

  useEffect(() => { loadPolicies(); }, []);

  async function addPolicy() {
    const clean = word.trim().toLowerCase();
    if (!clean) return;
    if (policies.some(p => p.word === clean)) {
      setError(`"${clean}" already exists`);
      return;
    }
    setSaving(true);
    setError("");
    const { error: err } = await supabase
      .from("beacon_policies")
      .insert({ school_id: SCHOOL_ID, word: clean, severity });
    if (err) {
      setError(err.message);
    } else {
      setWord("");
      await loadPolicies();
    }
    setSaving(false);
  }

  async function removePolicy(id: string) {
    await supabase.from("beacon_policies").delete().eq("id", id);
    await loadPolicies();
  }

  const high   = policies.filter(p => p.severity === "high");
  const medium = policies.filter(p => p.severity === "medium");

  return (
    <div className="flex min-h-screen bg-[#F0F2F8]">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-2xl font-bold text-[#013B93]">Beacon Atlas</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Runtime safeguarding keyword policies — synced to all monitored devices
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-600">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {policies.length} active policies
          </div>
        </header>

        <main className="flex-1 p-6">

          {/* Add policy */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
            <h2 className="text-base font-bold text-[#013B93] mb-4">Add Policy Keyword</h2>
            <div className="flex gap-3 items-start">
              <div className="flex-1">
                <input
                  type="text"
                  value={word}
                  onChange={e => { setWord(e.target.value); setError(""); }}
                  onKeyDown={e => e.key === "Enter" && addPolicy()}
                  placeholder="Enter keyword or phrase..."
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#013B93]/20"
                />
                {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
              </div>

              <select
                value={severity}
                onChange={e => setSeverity(e.target.value as "high" | "medium")}
                className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-[#013B93]/20"
              >
                <option value="high">High Risk</option>
                <option value="medium">Medium Risk</option>
              </select>

              <button
                onClick={addPolicy}
                disabled={saving || !word.trim()}
                className="bg-[#013B93] text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-[#012d70] disabled:opacity-40 transition-all"
              >
                {saving ? "Adding..." : "Add Policy"}
              </button>
            </div>
          </div>

          {/* Policy columns */}
          {loading ? (
            <div className="text-sm text-slate-400 text-center py-12">Loading policies...</div>
          ) : (
            <div className="grid grid-cols-2 gap-6">
              {(["high", "medium"] as const).map(sev => {
                const cfg   = SEVERITY_CONFIG[sev];
                const items = sev === "high" ? high : medium;
                return (
                  <div key={sev} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">

                    {/* Column header */}
                    <div className="px-6 py-4 border-b border-slate-100" style={{ background: cfg.bg }}>
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="font-bold text-slate-800">{cfg.label} Policies</h2>
                          <p className="text-xs text-slate-500 mt-0.5">{cfg.desc}</p>
                        </div>
                        <span
                          className="text-xs font-bold px-2.5 py-1 rounded-full text-white"
                          style={{ background: cfg.accent }}
                        >
                          {items.length}
                        </span>
                      </div>
                    </div>

                    {/* Keywords */}
                    <div className="p-4 space-y-2 max-h-[500px] overflow-auto">
                      {items.length === 0 && (
                        <p className="text-sm text-slate-400 text-center py-6">No {cfg.label.toLowerCase()} policies yet</p>
                      )}
                      {items.map(policy => (
                        <div
                          key={policy.id}
                          className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 group hover:bg-slate-100 transition-colors"
                        >
                          <span className="text-sm font-medium text-slate-700">{policy.word}</span>
                          <button
                            onClick={() => removePolicy(policy.id)}
                            className="text-xs font-semibold text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all px-2 py-1 rounded-lg hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>

                  </div>
                );
              })}
            </div>
          )}

          {/* Info banner */}
          <div className="mt-6 bg-[#013B93]/5 border border-[#013B93]/10 rounded-2xl px-6 py-4 flex items-start gap-3">
            <span className="text-[#013B93] text-lg mt-0.5">ℹ</span>
            <div>
              <p className="text-sm font-semibold text-[#013B93]">Policies sync automatically</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Changes made here are pushed to all monitored devices within 60 seconds via the Beacon extension.
                The extension polls Supabase on each page load and caches policies locally as a fallback.
              </p>
            </div>
          </div>

        </main>
      </div>
    </div>
  );
}
