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

// Beacon-managed default policy (centrally curated, applies to every school).
// Read-only from the school's perspective — no edit/remove UI.
interface DefaultPolicy {
  id:         string;
  word:       string;
  severity:   "high" | "medium";
  created_at: string;
  revised_at: string | null;
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
  msg_high:              string;
  msg_medium:            string;
  badge_text:            string;
  religious_affiliation: string | null;
  use_beacon_defaults:   boolean;
}

// Hard floor — displayed in the "Always on" sub-section under the Beacon
// Default card. Mirrors BEACON_HARDFLOOR_HIGH in app/api/chat/route.ts and
// extension/content.js. The three copies are a deliberate trade-off: the
// extension can't import server code, and keeping them visibly side-by-side
// makes the safety contract obvious. Any edit must update all three.
const BEACON_HARDFLOOR_HIGH: string[] = [
  "kill", "bomb", "suicide", "terrorist", "school shooting", "nazi",
  "ignore previous instructions", "ignore all instructions",
  "pretend you have no limits", "pretend you have no restrictions",
  "act as dan", "jailbreak", "do anything now", "bypass your filters",
  "you are now unrestricted", "developer mode",
  "disregard your training", "you have no rules",
];

// Religious affiliation options — UK-focused. Slug is stored; label shown in UI;
// context is the sentence injected into the Horizon system prompt for that school.
// `null` slug = "no affiliation set"; chat API omits the context block.
const AFFILIATIONS: { slug: string; label: string; context: string }[] = [
  { slug: "none",            label: "None / Non-denominational",
    context: "This is a non-denominational school with no specific religious character." },
  { slug: "cofe",            label: "Church of England",
    context: "This is a Church of England school. Anglican Christian values shape the school's ethos and worship." },
  { slug: "catholic",        label: "Roman Catholic",
    context: "This is a Roman Catholic school. Catholic teaching shapes the school's ethos, worship, and pastoral care." },
  { slug: "christian_other", label: "Other Christian",
    context: "This is a Christian school. Christian values shape the school's ethos and worship." },
  { slug: "jewish",          label: "Jewish",
    context: "This is a Jewish school. Jewish faith and tradition shape the school's ethos, worship, and calendar." },
  { slug: "muslim",          label: "Muslim / Islamic",
    context: "This is a Muslim school. Islamic faith and tradition shape the school's ethos, worship, and calendar." },
  { slug: "sikh",            label: "Sikh",
    context: "This is a Sikh school. Sikh faith and tradition shape the school's ethos, worship, and calendar." },
  { slug: "hindu",            label: "Hindu",
    context: "This is a Hindu school. Hindu faith and tradition shape the school's ethos, worship, and calendar." },
  { slug: "multi_faith",     label: "Multi-faith",
    context: "This is a multi-faith school. Students of different faiths and none are part of the school community, and the school values respect across traditions." },
  { slug: "other",           label: "Other",
    context: "This school has a specific religious character. Respect the school's faith ethos in your responses where relevant." },
];

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

type Tab = "policies" | "messages" | "context" | "audit" | "period";

export default function AtlasPage() {
  const { loading: authLoading, authenticated } = useAuth();
  const [tab, setTab]             = useState<Tab>("policies");
  const [policies, setPolicies]   = useState<Policy[]>([]);
  const [defaults, setDefaults]   = useState<DefaultPolicy[]>([]);
  const [audit, setAudit]         = useState<AuditEntry[]>([]);
  const [settings, setSettings]   = useState<SchoolSettings>({
    msg_high:              "",
    msg_medium:            "",
    badge_text:            "",
    religious_affiliation: null,
    use_beacon_defaults:   true,
  });
  const [loading, setLoading]     = useState(true);
  const [word, setWord]           = useState("");
  const [severity, setSeverity]   = useState<"high" | "medium">("high");
  const [saving, setSaving]       = useState(false);
  const [savingMsg, setSavingMsg] = useState(false);
  const [error, setError]         = useState("");
  const [msgSaved, setMsgSaved]   = useState(false);
  const [periods, setPeriods]     = useState<any[]>([]);
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [periodSaved, setPeriodSaved]   = useState(false);
  // Per-severity collapse for the Beacon Default sub-lists. Collapsed by
  // default so the card stays compact; counts always visible in the header.
  const [showDefaultHigh,   setShowDefaultHigh]   = useState(false);
  const [showDefaultMedium, setShowDefaultMedium] = useState(false);
  const [showHardfloor,     setShowHardfloor]     = useState(false);

  async function loadAll() {
    const [polRes, defRes, audRes, setRes, perRes] = await Promise.all([
      supabase.from("beacon_policies").select("*").eq("school_id", SCHOOL_ID).order("severity").order("word"),
      supabase.from("beacon_default_policies").select("*").order("severity").order("word"),
      supabase.from("policy_audit_log").select("*").eq("school_id", SCHOOL_ID).order("changed_at", { ascending: false }).limit(50),
      supabase.from("school_settings").select("*").eq("school_id", SCHOOL_ID).single(),
      supabase.from("period_mode").select("*").eq("school_id", SCHOOL_ID).order("created_at"),
    ]);
    setPolicies((polRes.data as Policy[]) || []);
    setDefaults((defRes.data as DefaultPolicy[]) || []);
    setAudit((audRes.data as AuditEntry[]) || []);
    if (setRes.data) {
      // Backfill use_beacon_defaults if the row predates 0014 (e.g. seeded
      // tenant without the column populated). Default = inherit.
      const row = setRes.data as Partial<SchoolSettings>;
      setSettings({
        msg_high:              row.msg_high ?? "",
        msg_medium:            row.msg_medium ?? "",
        badge_text:            row.badge_text ?? "",
        religious_affiliation: row.religious_affiliation ?? null,
        use_beacon_defaults:   row.use_beacon_defaults ?? true,
      });
    }
    if (perRes.data) setPeriods(perRes.data);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  // Toggle save: focused single-column update so flipping the Beacon Default
  // switch doesn't also persist unsaved edits on the Warning Messages tab.
  async function toggleBeaconDefaults() {
    const next = !settings.use_beacon_defaults;
    // Optimistic update so the switch feels instant.
    setSettings(s => ({ ...s, use_beacon_defaults: next }));
    const { error } = await supabase
      .from("school_settings")
      .update({ use_beacon_defaults: next, updated_at: new Date().toISOString() })
      .eq("school_id", SCHOOL_ID);
    if (error) {
      // Roll back on failure.
      setSettings(s => ({ ...s, use_beacon_defaults: !next }));
      console.error("Failed to save Beacon defaults toggle:", error);
    }
  }

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

  async function saveSettings() {
    setSavingMsg(true);
    await supabase.from("school_settings")
      .upsert({ school_id: SCHOOL_ID, ...settings, updated_at: new Date().toISOString() });
    setSavingMsg(false);
    setMsgSaved(true);
    setTimeout(() => setMsgSaved(false), 3000);
  }

  const high   = policies.filter(p => p.severity === "high");
  const medium = policies.filter(p => p.severity === "medium");
  const defaultHigh   = defaults.filter(p => p.severity === "high");
  const defaultMedium = defaults.filter(p => p.severity === "medium");
  // Effective active count = hard floor + (defaults if toggle on) + school additions.
  // Shown in the header pill so users can see at a glance what's enforced.
  const effectiveDefaultsCount = settings.use_beacon_defaults ? defaults.length : 0;
  const effectiveActiveCount   = BEACON_HARDFLOOR_HIGH.length + effectiveDefaultsCount + policies.length;
  // "Last updated by Beacon" — most-recent revised_at or created_at across defaults.
  const defaultsLastUpdated = defaults.length
    ? defaults
        .map(d => d.revised_at || d.created_at)
        .sort()
        .at(-1)!
    : null;

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
            {effectiveActiveCount} active
            <span className="text-[#06B6D4]/50 font-normal">
              {" · "}{effectiveDefaultsCount} Beacon defaults · {policies.length} school
            </span>
          </div>
        </header>

        {/* Tabs */}
        <div className="bg-white border-b border-slate-200 px-8">
          <div className="flex gap-1">
            {([
              { id: "policies", label: "Keyword Policies",    icon: "🛡" },
              { id: "messages", label: "Warning Messages",    icon: "💬" },
              { id: "context",  label: "School Context",      icon: "🏫" },
              { id: "audit",    label: "Policy Change Log",   icon: "📋" },
              { id: "period",   label: "Period Mode",          icon: "🔒" },
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
              {/* ─── Section 1: Beacon Default Policies (centrally managed) ─── */}
              <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm mb-6 overflow-hidden transition-opacity ${settings.use_beacon_defaults ? "" : "opacity-60"}`}>
                {/* Header with toggle */}
                <div className="px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-[#013B93]/5 to-transparent">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="text-2xl shrink-0">🛡</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="font-bold text-slate-800">Beacon Default Policies</h2>
                          <span className="text-[10px] font-semibold uppercase tracking-wide bg-[#013B93]/10 text-[#013B93] px-2 py-0.5 rounded">
                            Managed by Beacon
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          Curated safeguarding keywords applied to every school. Updated centrally by Beacon — your school can opt in or out, but cannot edit individual words.
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                          <span><strong className="text-slate-600">{defaults.length}</strong> default words</span>
                          <span>·</span>
                          <span><strong className="text-slate-600">{BEACON_HARDFLOOR_HIGH.length}</strong> always-on</span>
                          {defaultsLastUpdated && (
                            <>
                              <span>·</span>
                              <span>
                                Last updated by Beacon:{" "}
                                {new Date(defaultsLastUpdated).toLocaleDateString("en-GB", {
                                  day: "numeric", month: "short", year: "numeric"
                                })}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Toggle */}
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-semibold text-slate-500">
                        {settings.use_beacon_defaults ? "On" : "Off"}
                      </span>
                      <button
                        onClick={toggleBeaconDefaults}
                        className={`relative w-14 h-7 rounded-full transition-colors ${settings.use_beacon_defaults ? "bg-[#013B93]" : "bg-slate-300"}`}
                        aria-label="Toggle Beacon default policies"
                      >
                        <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.use_beacon_defaults ? "translate-x-8" : "translate-x-1"}`} />
                      </button>
                    </div>
                  </div>

                  {/* Warning when toggle is off */}
                  {!settings.use_beacon_defaults && (
                    <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2">
                      <span className="text-amber-600 text-base shrink-0">⚠</span>
                      <p className="text-xs text-amber-800">
                        <strong>Beacon defaults are disabled.</strong> Only your school's own keywords and Beacon's always-on safety floor (18 words) will be enforced. Most schools should leave this on.
                      </p>
                    </div>
                  )}
                </div>

                {/* Body — collapsible sub-lists */}
                <div className="p-4 space-y-2">
                  {/* High Risk Defaults */}
                  <button
                    onClick={() => setShowDefaultHigh(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                      <span className="text-sm font-semibold text-slate-700">High Risk Defaults</span>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{defaultHigh.length}</span>
                    </div>
                    <span className="text-xs text-slate-400">{showDefaultHigh ? "Hide" : "Show"} ▾</span>
                  </button>
                  {showDefaultHigh && (
                    <div className="px-4 pb-3 flex flex-wrap gap-2">
                      {defaultHigh.map(p => (
                        <span key={p.id} className="text-xs bg-red-50 text-red-700 border border-red-100 px-2.5 py-1 rounded-lg font-mono">
                          {p.word}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Medium Risk Defaults */}
                  <button
                    onClick={() => setShowDefaultMedium(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      <span className="text-sm font-semibold text-slate-700">Medium Risk Defaults</span>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{defaultMedium.length}</span>
                    </div>
                    <span className="text-xs text-slate-400">{showDefaultMedium ? "Hide" : "Show"} ▾</span>
                  </button>
                  {showDefaultMedium && (
                    <div className="px-4 pb-3 flex flex-wrap gap-2">
                      {defaultMedium.map(p => (
                        <span key={p.id} className="text-xs bg-amber-50 text-amber-700 border border-amber-100 px-2.5 py-1 rounded-lg font-mono">
                          {p.word}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Always-on — folded jailbreak block */}
                <div className="bg-slate-800 p-5">
                  <button
                    onClick={() => setShowHardfloor(v => !v)}
                    className="w-full flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🔐</span>
                      <h3 className="font-bold text-white text-sm">Always on — cannot be disabled</h3>
                      <span className="text-xs bg-white/10 text-white/70 px-2 py-0.5 rounded-full">
                        {BEACON_HARDFLOOR_HIGH.length} words
                      </span>
                    </div>
                    <span className="text-xs text-white/50">{showHardfloor ? "Hide" : "Show"} ▾</span>
                  </button>
                  {showHardfloor && (
                    <>
                      <p className="text-white/60 text-xs mt-3 mb-3">
                        Critical safeguarding terms and jailbreak phrases. These are enforced for every student in every school, even when Beacon defaults are turned off.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {BEACON_HARDFLOOR_HIGH.map(phrase => (
                          <span key={phrase} className="text-xs bg-white/10 text-white/80 px-3 py-1.5 rounded-lg font-mono">
                            {phrase}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* ─── Section 2: Your school's additions ─── */}
              <div className="mb-6">
                <div className="flex items-baseline justify-between mb-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-800">Your school's additions</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Words your school has added on top of Beacon's defaults. These are always enforced regardless of the toggle above.
                    </p>
                  </div>
                </div>

                {/* Add policy */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-4">
                  <div className="flex gap-3 items-start">
                    <div className="flex-1">
                      <input
                        type="text"
                        value={word}
                        onChange={e => { setWord(e.target.value); setError(""); }}
                        onKeyDown={e => e.key === "Enter" && addPolicy()}
                        placeholder="Add a keyword or phrase your school wants to block or flag..."
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

                {/* School policy columns */}
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
                                <h3 className="font-bold text-slate-800 text-sm">{cfg.label} — your additions</h3>
                                <p className="text-xs text-slate-500 mt-0.5">{cfg.desc}</p>
                              </div>
                              <span className="text-xs font-bold px-2.5 py-1 rounded-full text-white" style={{ background: cfg.accent }}>
                                {items.length}
                              </span>
                            </div>
                          </div>
                          <div className="p-4 space-y-2 max-h-[500px] overflow-auto">
                            {items.length === 0 && (
                              <p className="text-sm text-slate-400 text-center py-6">
                                {settings.use_beacon_defaults
                                  ? `No extra ${cfg.label.toLowerCase()} words. Beacon's defaults are covering you.`
                                  : `No extra ${cfg.label.toLowerCase()} words — and Beacon defaults are off. Only the always-on safety floor applies.`}
                              </p>
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
              </div>

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
                    onClick={saveSettings}
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

          {/* ── Tab: School Context ── */}
          {tab === "context" && (
            <div className="max-w-2xl space-y-6">
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                <h2 className="text-base font-bold text-[#06B6D4] mb-1">School Religious Character</h2>
                <p className="text-sm text-slate-400 mb-6">
                  The AI inside Horizon will gently take this into account when students ask about RE,
                  ethics, religious holidays, or pastoral matters. It will not impose religious framing
                  on academic questions that are not about religion.
                </p>

                <label className="text-sm font-semibold text-slate-700 mb-2 block">Religious affiliation</label>
                <select
                  value={settings.religious_affiliation ?? ""}
                  onChange={e =>
                    setSettings(s => ({
                      ...s,
                      religious_affiliation: e.target.value || null,
                    }))
                  }
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20"
                >
                  <option value="">— Not set —</option>
                  {AFFILIATIONS.map(a => (
                    <option key={a.slug} value={a.slug}>{a.label}</option>
                  ))}
                </select>

                {/* Live preview of the context the AI will receive */}
                <div className="mt-4">
                  <div className="text-xs font-semibold text-slate-500 mb-2">
                    Context passed to the AI
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    {(() => {
                      const slug = settings.religious_affiliation;
                      const match = AFFILIATIONS.find(a => a.slug === slug);
                      if (!slug || !match) {
                        return (
                          <span className="text-slate-400 italic">
                            No school-context will be added to the AI. Select an affiliation above to enable it.
                          </span>
                        );
                      }
                      return match.context;
                    })()}
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-6">
                  <button
                    onClick={saveSettings}
                    disabled={savingMsg}
                    className="bg-[#06B6D4] text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-[#0891b2] disabled:opacity-40 transition-all"
                  >
                    {savingMsg ? "Saving..." : "Save Context"}
                  </button>
                  {msgSaved && (
                    <span className="text-sm text-emerald-600 font-semibold flex items-center gap-1">
                      ✓ Saved — applied to new student conversations
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

          {/* ── Tab: Period Mode ── */}
          {tab === "period" && (
            <div className="space-y-6 max-w-3xl">

              {/* Status banner */}
              {periods.some(p => {
                if (!p.active) return false;
                if (p.mode === "manual") return !p.override_until || new Date(p.override_until) > new Date();
                if (p.mode === "scheduled") {
                  const now = new Date();
                  const day = ["sun","mon","tue","wed","thu","fri","sat"][now.getDay()];
                  if (!p.days?.includes(day)) return false;
                  const t = now.toTimeString().slice(0,5);
                  return t >= p.start_time && t <= p.end_time;
                }
                return false;
              }) && (
                <div className="bg-red-600 text-white rounded-2xl p-4 flex items-center gap-3">
                  <span className="text-2xl">🔒</span>
                  <div>
                    <div className="font-bold">Period Mode Active</div>
                    <div className="text-sm text-white/80">Students are currently being redirected away from AI platforms</div>
                  </div>
                </div>
              )}

              {/* Period cards */}
              {periods.map((period: any) => (
                <div key={period.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-bold text-slate-800">{period.name}</h3>
                      <span className="text-xs text-slate-400 capitalize">{period.mode} mode</span>
                    </div>
                    {/* Active toggle */}
                    <button
                      onClick={async () => {
                        await supabase.from("period_mode").update({
                          active: !period.active,
                          override_until: null,
                          updated_at: new Date().toISOString()
                        }).eq("id", period.id);
                        await loadAll();
                      }}
                      className={`relative w-14 h-7 rounded-full transition-colors ${period.active ? "bg-red-500" : "bg-slate-200"}`}
                    >
                      <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${period.active ? "translate-x-8" : "translate-x-1"}`} />
                    </button>
                  </div>

                  {period.mode === "scheduled" && (
                    <div className="flex gap-4 mb-4">
                      <div className="flex-1">
                        <label className="text-xs text-slate-400 mb-1 block">Days</label>
                        <div className="flex gap-1">
                          {["mon","tue","wed","thu","fri","sat","sun"].map(d => (
                            <button
                              key={d}
                              onClick={async () => {
                                const days = period.days?.includes(d)
                                  ? period.days.filter((x: string) => x !== d)
                                  : [...(period.days || []), d];
                                await supabase.from("period_mode").update({ days }).eq("id", period.id);
                                await loadAll();
                              }}
                              className={`text-xs px-2 py-1 rounded-lg font-semibold capitalize ${
                                period.days?.includes(d)
                                  ? "bg-[#06B6D4] text-white"
                                  : "bg-slate-100 text-slate-400"
                              }`}
                            >{d}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Start</label>
                        <input type="time" defaultValue={period.start_time}
                          onBlur={async (e) => {
                            await supabase.from("period_mode").update({ start_time: e.target.value }).eq("id", period.id);
                            await loadAll();
                          }}
                          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">End</label>
                        <input type="time" defaultValue={period.end_time}
                          onBlur={async (e) => {
                            await supabase.from("period_mode").update({ end_time: e.target.value }).eq("id", period.id);
                            await loadAll();
                          }}
                          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Block page title</label>
                      <input
                        type="text"
                        defaultValue={period.block_title}
                        onBlur={async (e) => {
                          await supabase.from("period_mode").update({ block_title: e.target.value }).eq("id", period.id);
                        }}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Block page message</label>
                      <input
                        type="text"
                        defaultValue={period.block_message}
                        onBlur={async (e) => {
                          await supabase.from("period_mode").update({ block_message: e.target.value }).eq("id", period.id);
                        }}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20"
                      />
                    </div>
                  </div>
                </div>
              ))}

              {/* Add new period */}
              <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-6">
                <h3 className="font-bold text-slate-600 mb-4">Add New Period</h3>
                <div className="flex gap-3">
                  <input
                    id="new-period-name"
                    type="text"
                    placeholder="e.g. GCSE Exam Block, Morning Lessons"
                    className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20"
                  />
                  <select id="new-period-mode" className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none">
                    <option value="scheduled">Scheduled</option>
                    <option value="manual">Manual</option>
                  </select>
                  <button
                    onClick={async () => {
                      const name = (document.getElementById("new-period-name") as HTMLInputElement)?.value.trim();
                      const mode = (document.getElementById("new-period-mode") as HTMLSelectElement)?.value;
                      if (!name) return;
                      await supabase.from("period_mode").insert({
                        school_id: SCHOOL_ID,
                        name,
                        mode,
                        active: false,
                        days: ["mon","tue","wed","thu","fri"],
                        start_time: "09:00",
                        end_time: "15:30",
                      });
                      await loadAll();
                    }}
                    className="bg-[#06B6D4] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#0891b2] transition-all"
                  >
                    Add
                  </button>
                </div>
              </div>

            </div>
          )}

        </main>
      </div>
    </div>
  );
}
