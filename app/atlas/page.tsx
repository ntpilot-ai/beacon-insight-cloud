"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { SCHOOL_ID, SCHOOL_NAME } from "@/lib/config";
import { useAuth } from "@/lib/useAuth";
import Sidebar from "@/components/Sidebar";
import Image from "next/image";

interface Policy {
  id:        string;
  word:      string;
  severity:  "high" | "medium";
  school_id: string;
}

interface AuditEntry {
  id:         string;
  action:     "added" | "removed";
  word:       string;
  severity:   string;
  changed_by: string | null;
  changed_at: string;
}

interface SchoolSettings {
  msg_high:   string;
  msg_medium: string;
  badge_text: string;
}

const SEVERITY_CONFIG = {
  high: {
    label:  "High Risk",
    desc:   "Prompt is blocked immediately and student is warned",
    accent: "#DC2626",
    bg:     "#FEF2F2",
    badge:  "bg-red-100 text-red-700",
  },
  medium: {
    label:  "Medium Risk",
    desc:   "Prompt is allowed but flagged and a warning is shown",
    accent: "#F59E0B",
    bg:     "#FFFBEB",
    badge:  "bg-amber-100 text-amber-700",
  },
};

type Tab = "policies" | "messages" | "audit";

export default function AtlasPage() {
  const { loading: authLoading, authenticated } = useAuth();
  const [tab, setTab]             = useState<Tab>("policies");
  const [policies, setPolicies]   = useState<Policy[]>([]);
  const [audit, setAudit]         = useState<AuditEntry[]>([]);
  const [settings, setSettings]   = useState<SchoolSettings>({
    msg_high:   "",
    msg_medium: "",
    badge_text: "",
  });
  const [loading, setLoading]     = useState(true);
  const [word, setWord]           = useState("");
  const [severity, setSeverity]   = useState<"high" | "medium">("high");
  const [saving, setSaving]       = useState(false);
  const [savingMsg, setSavingMsg] = useState(false);
  const [error, setError]         = useState("");
  const [msgSaved, setMsgSaved]   = useState(false);

  async function loadAll() {
    const [polRes, audRes, setRes] = await Promise.all([
      supabase.from("beacon_policies").select("*").eq("school_id", SCHOOL_ID).order("severity").order("word"),
      supabase.from("policy_audit_log").select("*").eq("school_id", SCHOOL_ID).order("changed_at", { ascending: false }).limit(50),
      supabase.from("school_settings").select("*").eq("school_id", SCHOOL_ID).single(),
    ]);
    setPolicies((polRes.data as Policy[]) || []);
    setAudit((audRes.data as AuditEntry[]) || []);
    if (setRes.data) setSettings(setRes.data as SchoolSettings);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  async function addPolicy() {
    const clean = word.trim().toLowerCase();
    if (!clean) return;
    if (policies.some(p => p.word === clean)) { setError(`"${clean}" already exists`); return; }
    setSaving(true);
    setError("");
    await supabase.from("beacon_policies").insert({ school_id: SCHOOL_ID, word: clean, severity });
    setWord("");
    await loadAll();
    setSaving(false);
  }

  async function removePolicy(id: string) {
    await supabase.from("beacon_policies").delete().eq("id", id);
    await loadAll();
  }

  async function saveMessages() {
    setSavingMsg(true);
    await supabase.from("school_settings")
      .upsert({ school_id: SCHOOL_ID, ...settings, updated_at: new Date().toISOString() });
    setSavingMsg(false);
    setMsgSaved(true);
    setTimeout(() => setMsgSaved(false), 3000);
  }

  const high   = policies.filter(p => p.severity === "high");
  const medium = policies.filter(p => p.severity === "medium");

  if (authLoading || !authenticated) return null;

  return (
    <div className="flex min-h-screen bg-[#F0F2F8]">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Image src="/atlas_icon.png" alt="Atlas" width={32} height={32} className="object-contain" />
            <div>
              <h1 className="text-2xl font-bold text-[#06B6D4]">Beacon Atlas</h1>
              <p className="text-sm text-slate-400 mt-0.5">{SCHOOL_NAME} — governance & policy controls</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-cyan-50 text-[#06B6D4]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#06B6D4] animate-pulse" />
            {policies.length} active policies
          </div>
        </header>

        {/* Tabs */}
        <div className="bg-white border-b border-slate-200 px-8">
          <div className="flex gap-1">
            {([
              { id: "policies", label: "Keyword Policies",    icon: "🛡" },
              { id: "messages", label: "Warning Messages",    icon: "💬" },
              { id: "audit",    label: "Policy Change Log",   icon: "📋" },
            ] as { id: Tab; label: string; icon: string }[]).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
                  tab === t.id
                    ? "border-[#06B6D4] text-[#06B6D4]"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                <span>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>
        </div>

        <main className="flex-1 p-6">

          {/* ── Tab: Keyword Policies ── */}
          {tab === "policies" && (
            <>
              {/* Add policy */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
                <h2 className="text-base font-bold text-[#06B6D4] mb-4">Add Policy Keyword</h2>
                <div className="flex gap-3 items-start">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={word}
                      onChange={e => { setWord(e.target.value); setError(""); }}
                      onKeyDown={e => e.key === "Enter" && addPolicy()}
                      placeholder="Enter keyword or phrase..."
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20"
                    />
                    {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                  </div>
                  <select
                    value={severity}
                    onChange={e => setSeverity(e.target.value as "high" | "medium")}
                    className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-600 bg-white focus:outline-none"
                  >
                    <option value="high">High Risk</option>
                    <option value="medium">Medium Risk</option>
                  </select>
                  <button
                    onClick={addPolicy}
                    disabled={saving || !word.trim()}
                    className="bg-[#06B6D4] text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-[#0891b2] disabled:opacity-40 transition-all"
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
                        <div className="px-6 py-4 border-b border-slate-100" style={{ background: cfg.bg }}>
                          <div className="flex items-center justify-between">
                            <div>
                              <h2 className="font-bold text-slate-800">{cfg.label} Policies</h2>
                              <p className="text-xs text-slate-500 mt-0.5">{cfg.desc}</p>
                            </div>
                            <span className="text-xs font-bold px-2.5 py-1 rounded-full text-white" style={{ background: cfg.accent }}>
                              {items.length}
                            </span>
                          </div>
                        </div>
                        <div className="p-4 space-y-2 max-h-[500px] overflow-auto">
                          {items.length === 0 && (
                            <p className="text-sm text-slate-400 text-center py-6">No {cfg.label.toLowerCase()} policies yet</p>
                          )}
                          {items.map(policy => (
                            <div key={policy.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 group hover:bg-slate-100 transition-colors">
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

              {/* Sync info */}
              <div className="mt-6 bg-[#06B6D4]/5 border border-[#06B6D4]/10 rounded-2xl px-6 py-4 flex items-start gap-3">
                <span className="text-[#06B6D4] text-lg mt-0.5">ℹ</span>
                <div>
                  <p className="text-sm font-semibold text-[#06B6D4]">Policies sync automatically</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Changes are pushed to all monitored devices within 60 seconds via the Beacon extension.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* ── Tab: Warning Messages ── */}
          {tab === "messages" && (
            <div className="max-w-2xl space-y-6">

              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                <h2 className="text-base font-bold text-[#06B6D4] mb-1">Student Warning Messages</h2>
                <p className="text-sm text-slate-400 mb-6">
                  Customise the messages students see when their prompts are flagged or blocked. These are shown in the Beacon browser extension.
                </p>

                {/* High risk message */}
                <div className="mb-6">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    High Risk — Blocked Message
                  </label>
                  <p className="text-xs text-slate-400 mb-2">Shown when a prompt is blocked. The student cannot proceed.</p>
                  <textarea
                    value={settings.msg_high}
                    onChange={e => setSettings(s => ({ ...s, msg_high: e.target.value }))}
                    rows={3}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20 resize-none"
                    placeholder="Enter message for blocked prompts..."
                  />
                  {/* Preview */}
                  <div className="mt-2 rounded-xl p-4 text-white text-sm" style={{ background: "#DC2626" }}>
                    <div className="font-bold mb-1">🛡 Beacon Blocked Prompt</div>
                    <div className="opacity-90 text-xs">{settings.msg_high || "Enter a message above..."}</div>
                  </div>
                </div>

                {/* Medium risk message */}
                <div className="mb-6">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    Medium Risk — Warning Message
                  </label>
                  <p className="text-xs text-slate-400 mb-2">Shown as a warning. The student can continue but is alerted.</p>
                  <textarea
                    value={settings.msg_medium}
                    onChange={e => setSettings(s => ({ ...s, msg_medium: e.target.value }))}
                    rows={3}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20 resize-none"
                    placeholder="Enter warning message..."
                  />
                  <div className="mt-2 rounded-xl p-4 text-white text-sm" style={{ background: "#F59E0B" }}>
                    <div className="font-bold mb-1">⚠️ Beacon Warning</div>
                    <div className="opacity-90 text-xs">{settings.msg_medium || "Enter a message above..."}</div>
                  </div>
                </div>

                {/* Badge text */}
                <div className="mb-6">
                  <label className="text-sm font-semibold text-slate-700 mb-2 block">
                    Extension Badge Text
                  </label>
                  <p className="text-xs text-slate-400 mb-2">The label shown on the Beacon badge in the corner of the student's browser.</p>
                  <input
                    type="text"
                    value={settings.badge_text}
                    onChange={e => setSettings(s => ({ ...s, badge_text: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20"
                    placeholder="e.g. Beacon Protected"
                    maxLength={40}
                  />
                  <div className="mt-2 inline-flex items-center gap-2 bg-[#06B6D4] text-white text-xs font-bold px-4 py-2 rounded-full">
                    🛡 {settings.badge_text || "Beacon Protected"}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={saveMessages}
                    disabled={savingMsg}
                    className="bg-[#06B6D4] text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-[#0891b2] disabled:opacity-40 transition-all"
                  >
                    {savingMsg ? "Saving..." : "Save Messages"}
                  </button>
                  {msgSaved && (
                    <span className="text-sm text-emerald-600 font-semibold flex items-center gap-1">
                      ✓ Saved — syncing to all devices
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Tab: Policy Change Log ── */}
          {tab === "audit" && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-[#06B6D4]">Policy Change Log</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    All changes to safeguarding policies — automatically recorded for audit and compliance
                  </p>
                </div>
                <span className="text-xs text-slate-400">{audit.length} entries</span>
              </div>

              {audit.length === 0 ? (
                <div className="text-center py-16 text-slate-400 text-sm">
                  <div className="text-3xl mb-3">📋</div>
                  No policy changes recorded yet.
                  <br />Changes will appear here automatically when policies are added or removed.
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {audit.map(entry => {
                    const isAdd   = entry.action === "added";
                    const sevCfg  = entry.severity === "high"
                      ? { color: "#DC2626", bg: "bg-red-100 text-red-700" }
                      : { color: "#F59E0B", bg: "bg-amber-100 text-amber-700" };
                    return (
                      <div key={entry.id} className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">

                        {/* Action icon */}
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm shrink-0 ${
                          isAdd ? "bg-emerald-500" : "bg-red-400"
                        }`}>
                          {isAdd ? "+" : "−"}
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-700 text-sm">
                              {isAdd ? "Added" : "Removed"} keyword
                            </span>
                            <code className="text-sm font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                              {entry.word}
                            </code>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sevCfg.bg}`}>
                              {entry.severity} risk
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {entry.changed_by ? `by ${entry.changed_by}` : ""}
                          </div>
                        </div>

                        {/* Timestamp */}
                        <div className="text-right shrink-0">
                          <div className="text-sm text-slate-500">
                            {new Date(entry.changed_at).toLocaleDateString("en-GB", {
                              day: "numeric", month: "short", year: "numeric"
                            })}
                          </div>
                          <div className="text-xs text-slate-400">
                            {new Date(entry.changed_at).toLocaleTimeString("en-GB", {
                              hour: "2-digit", minute: "2-digit"
                            })}
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
