"use client";

/**
 * Aegis — Safeguarding Worklist (Phase 5, beta).
 *
 * The event-driven half of the Aegis/Pulse split. Per-row triage view of
 * individual flagged beacon_events. Two action types per row:
 *   - Dismiss   — client-only state, hides the row this session. Low-stakes
 *                 "reviewed, no action needed." Doesn't write to DB.
 *   - Escalate  — creates a pulse_acknowledgements row with
 *                 action_taken='escalated'. The student then appears on the
 *                 Pulse queue (promotion rule 4: manual escalation via ack).
 *
 * This page intentionally does NOT show Pulse depth: no scores, no
 * fingerprints, no trends. Aegis = "respond to events"; Pulse =
 * "understand students." See lib/promotion.ts for the split rules.
 */

import { useEffect, useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fetchAllEvents } from "@/lib/fetchEvents";
import { useAuth } from "@/lib/useAuth";
import { SCHOOL_ID } from "@/lib/config";
import Sidebar from "@/components/Sidebar";
import {
  deriveStudentStatus,
  STATUS_STYLE,
  type StudentStatus,
} from "@/lib/student_status";

interface AegisEvent {
  id:         number;
  created_at: string;
  student_id: string;
  platform:   string;
  prompt:     string;
  risk:       string;
  blocked:    boolean;
  matched:    string[];
}

interface AckRow {
  student_id:      string;
  acknowledged_at: string;
  action_taken:    string;
}

interface SnoozeRow {
  student_id:   string;
  expires_at:   string | null;
  broken_early: boolean;
}

// Category derivation — same logic as elsewhere in the app so a student's
// dominant category reads the same on Aegis as it does on Pulse.
function categoryFromMatched(matched: string[]): string {
  if (!matched?.length) return "General";
  const m = matched.join(" ").toLowerCase();
  if (m.includes("jailbreak") || m.includes("ignore") || m.includes("dan") || m.includes("bypass")) return "Jailbreak";
  if (m.includes("harm")      || m.includes("suicide"))                                              return "Self-harm";
  if (m.includes("bully")     || m.includes("threaten"))                                             return "Bullying";
  if (m.includes("weapon")    || m.includes("violen")  || m.includes("shank"))                       return "Violence";
  if (m.includes("sex")       || m.includes("explicit") || m.includes("adult") || m.includes("porn")) return "Inappropriate Content";
  if (m.includes("drug")      || m.includes("alcohol") || m.includes("weed"))                        return "Substance";
  return "General";
}

const RISK_CHIP: Record<string, { label: string; cls: string }> = {
  critical: { label: "CRITICAL", cls: "bg-indigo-100 text-indigo-700" },
  high:     { label: "HIGH",     cls: "bg-red-100 text-red-700"       },
  medium:   { label: "MEDIUM",   cls: "bg-amber-100 text-amber-700"   },
  low:      { label: "LOW",      cls: "bg-slate-100 text-slate-500"   },
};

const PLATFORM_LABEL: Record<string, string> = {
  "chatgpt.com":           "ChatGPT",
  "claude.ai":             "Claude",
  "gemini.google.com":     "Gemini",
  "copilot.microsoft.com": "Copilot",
};

function relTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return `${Math.round(diff)}s ago`;
  if (diff < 3600)  return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export default function AegisBetaPage() {
  return (
    <Suspense fallback={null}>
      <AegisBetaContent />
    </Suspense>
  );
}

function AegisBetaContent() {
  const { loading: authLoading, authenticated } = useAuth();

  const [events,  setEvents]  = useState<AegisEvent[]>([]);
  const [acks,    setAcks]    = useState<AckRow[]>([]);
  const [snoozes, setSnoozes] = useState<SnoozeRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Client-only Dismiss state — session-local hide. Per the v1 spec we
  // don't persist dismissals; refresh = reset. Cheap to layer persistence
  // in later via aegis_event_dispositions table if the page shape proves
  // out.
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  // Filters
  type RiskFilter   = "all" | "high+" | "critical" | "high" | "medium" | "blocked";
  type WindowFilter = "24h" | "7d" | "term" | "all";
  type StatusFilter = "active" | "dismissed" | "all";

  const [filterRisk,     setFilterRisk]     = useState<RiskFilter>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterPlatform, setFilterPlatform] = useState<string>("all");
  const [filterWindow,   setFilterWindow]   = useState<WindowFilter>("7d");
  const [filterStatus,   setFilterStatus]   = useState<StatusFilter>("active");
  const [search,         setSearch]         = useState("");

  // Escalation modal state
  const [escalating,         setEscalating]         = useState<AegisEvent | null>(null);
  const [escalateNotes,      setEscalateNotes]      = useState("");
  const [escalateSubmitting, setEscalateSubmitting] = useState(false);
  const [escalateError,      setEscalateError]      = useState<string | null>(null);

  useEffect(() => {
    fetchAllEvents<AegisEvent>({ schoolId: SCHOOL_ID, ascending: false })
      .then(data => { setEvents(data); setLoading(false); });
  }, []);

  useEffect(() => {
    Promise.all([
      supabase.from("pulse_acknowledgements")
        .select("student_id,acknowledged_at,action_taken")
        .eq("school_id", SCHOOL_ID)
        .order("acknowledged_at", { ascending: false }),
      supabase.from("pulse_snooze")
        .select("student_id,expires_at,broken_early")
        .eq("school_id", SCHOOL_ID)
        .eq("broken_early", false),
    ]).then(([acksRes, snoozesRes]) => {
      if (acksRes.data)    setAcks(acksRes.data as AckRow[]);
      if (snoozesRes.data) setSnoozes(snoozesRes.data as SnoozeRow[]);
    });
  }, []);

  // Realtime — same shape as the dashboard widget. New inserts pop in
  // without a refresh.
  useEffect(() => {
    const channel = supabase.channel("aegis-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "beacon_events" }, payload => {
        const row = payload.new as AegisEvent;
        // Only same-tenant; cheap client-side check
        if ((payload.new as any).school_id !== SCHOOL_ID) return;
        setEvents(prev => [row, ...prev]);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pulse_acknowledgements" }, () => {
        // Re-fetch acks so newly-escalated students' status updates here too
        supabase.from("pulse_acknowledgements")
          .select("student_id,acknowledged_at,action_taken")
          .eq("school_id", SCHOOL_ID)
          .order("acknowledged_at", { ascending: false })
          .then(({ data }) => { if (data) setAcks(data as AckRow[]); });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Pulse-status per student (used as a contextual chip next to the name —
  // tells the DSL whether the student is already known to Pulse).
  const statusByStudent = useMemo(() => {
    const map = new Map<string, StudentStatus>();
    const studentIds = new Set(events.map(e => e.student_id));
    studentIds.forEach(sid => {
      map.set(sid, deriveStudentStatus({ studentId: sid, acks, snoozes }));
    });
    return map;
  }, [events, acks, snoozes]);

  // Aegis = unreviewed events. The rule isn't "exclude students who are in
  // Pulse" (a Pulse-managed student can still commit new events that need
  // review — "he's done it again"). Instead: an event is "covered" by any
  // ack for the same student created AFTER the event. Acks act as a
  // sliding watermark — everything older than the latest ack is reviewed,
  // anything newer is unreviewed and belongs on Aegis.
  //
  // Practical effects:
  //   - Tyler's events older than his Summer ack → covered, hidden
  //   - Tyler's events from the last 24h (newer than the ack) → shown
  //   - Chloe (never ack'd, peak high) → all her events shown
  //   - Freddie (escalated via Aegis, ack created at escalation) → his
  //     originating event is now older than the ack → hidden
  //   - Amelie (no ack yet) → her single event shown
  const latestAckByStudent = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of acks) {
      const t   = new Date(a.acknowledged_at).getTime();
      const cur = map.get(a.student_id) ?? 0;
      if (t > cur) map.set(a.student_id, t);
    }
    return map;
  }, [acks]);

  // How many flagged events were filtered out because they're covered by a
  // later ack. Shown as a small "+ N reviewed earlier" link near the
  // worklist header so the DSL knows the inbox isn't accidentally hiding
  // unreviewed work.
  const ackCoveredCount = useMemo(() => {
    return events.filter(e => {
      if (e.risk === "low" && !e.blocked) return false;
      const latestAckMs = latestAckByStudent.get(e.student_id);
      if (latestAckMs === undefined)      return false;
      return new Date(e.created_at).getTime() <= latestAckMs;
    }).length;
  }, [events, latestAckByStudent]);

  // Filtered + sorted event list.
  const filteredEvents = useMemo(() => {
    const now = Date.now();
    const windowCutoff: Record<WindowFilter, number> = {
      "24h":  now - 86400000,
      "7d":   now - 7  * 86400000,
      "term": now - 90 * 86400000,
      "all":  0,
    };
    const cutoff = windowCutoff[filterWindow];

    return events.filter(e => {
      // Only flagged events appear on Aegis (low + unblocked = not safeguarding-
      // relevant, lives only in raw event log if at all).
      if (e.risk === "low" && !e.blocked) return false;

      // Covered by a later ack — already reviewed at the case level.
      // (A new event after this point would re-appear here.)
      const latestAckMs = latestAckByStudent.get(e.student_id);
      if (latestAckMs !== undefined && new Date(e.created_at).getTime() <= latestAckMs) {
        return false;
      }

      if (new Date(e.created_at).getTime() < cutoff) return false;

      if (search) {
        const q = search.toLowerCase();
        if (!e.student_id.toLowerCase().includes(q) && !e.prompt.toLowerCase().includes(q)) return false;
      }

      if (filterRisk === "high+"    && !(e.risk === "high" || e.risk === "critical"))                return false;
      if (filterRisk === "critical" && e.risk !== "critical")                                        return false;
      if (filterRisk === "high"     && e.risk !== "high")                                            return false;
      if (filterRisk === "medium"   && e.risk !== "medium")                                          return false;
      if (filterRisk === "blocked"  && !e.blocked)                                                   return false;

      if (filterCategory !== "all" && categoryFromMatched(e.matched) !== filterCategory) return false;
      if (filterPlatform !== "all" && e.platform !== filterPlatform)                     return false;

      const isDismissed = dismissed.has(e.id);
      if (filterStatus === "active"    && isDismissed)  return false;
      if (filterStatus === "dismissed" && !isDismissed) return false;

      return true;
    });
  }, [events, search, filterRisk, filterCategory, filterPlatform, filterStatus, filterWindow, dismissed, latestAckByStudent]);

  const dismissedCount = useMemo(() =>
    events.filter(e => dismissed.has(e.id) && (e.risk !== "low" || e.blocked)).length,
    [events, dismissed],
  );

  const handleDismiss   = (id: number) => setDismissed(prev => new Set([...prev, id]));
  const handleUndismiss = (id: number) => setDismissed(prev => { const n = new Set(prev); n.delete(id); return n; });

  const submitEscalation = async () => {
    if (!escalating) return;
    setEscalateSubmitting(true);
    setEscalateError(null);
    try {
      const category    = categoryFromMatched(escalating.matched);
      const alertLevel  =
        escalating.risk === "critical" ? "critical" :
        escalating.risk === "high"     ? "high"     :
                                         "medium";
      const fallback    = `Escalated from Aegis — event ${relTime(escalating.created_at)}: "${escalating.prompt.slice(0, 120)}"`;
      const { error } = await supabase.from("pulse_acknowledgements").insert({
        school_id:         SCHOOL_ID,
        student_id:        escalating.student_id,
        acknowledged_by:   "aegis-escalation",
        alert_level:       alertLevel,
        dominant_category: category,
        action_taken:      "escalated",
        notes:             escalateNotes.trim() || fallback,
      });
      if (error) throw error;
      // Auto-dismiss the originating event for immediate visual feedback.
      // The student-level promoted-filter would also hide it once the
      // ack realtime fires, but this gives instant feedback without
      // waiting for the realtime round-trip.
      setDismissed(prev => new Set([...prev, escalating.id]));
      setEscalating(null);
      setEscalateNotes("");
    } catch (e: any) {
      setEscalateError(e?.message ?? "Escalation failed");
    } finally {
      setEscalateSubmitting(false);
    }
  };

  if (authLoading || !authenticated) return null;

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold" style={{ color: "#10B981" }}>Aegis</h1>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-cyan-100 text-cyan-700">Beta</span>
            </div>
            <p className="text-sm text-slate-400 mt-0.5">
              Individual flagged events. Dismiss low-stakes one-offs; escalate patterns to Pulse.
            </p>
          </div>
          <Link href="/pulse-beta"
            className="text-xs font-semibold text-slate-500 border border-slate-200 px-3 py-1.5 rounded-xl hover:border-[#06B6D4] hover:text-[#06B6D4] transition-all">
            Pulse →
          </Link>
        </header>

        {/* Filters */}
        <div className="bg-white border-b border-slate-100 px-8 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search student or prompt..."
            className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#10B981]/20 flex-1 min-w-[200px] max-w-md" />

          <select value={filterRisk} onChange={e => setFilterRisk(e.target.value as RiskFilter)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs">
            <option value="all">Risk: All</option>
            <option value="high+">High+ only</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="blocked">Blocked only</option>
          </select>

          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs">
            <option value="all">Category: All</option>
            <option value="Jailbreak">Jailbreak</option>
            <option value="Self-harm">Self-harm</option>
            <option value="Bullying">Bullying</option>
            <option value="Violence">Violence</option>
            <option value="Inappropriate Content">Inappropriate Content</option>
            <option value="Substance">Substance</option>
            <option value="General">General</option>
          </select>

          <select value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs">
            <option value="all">Platform: All</option>
            <option value="chatgpt.com">ChatGPT</option>
            <option value="claude.ai">Claude</option>
            <option value="gemini.google.com">Gemini</option>
            <option value="copilot.microsoft.com">Copilot</option>
          </select>

          <select value={filterWindow} onChange={e => setFilterWindow(e.target.value as WindowFilter)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs">
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7d</option>
            <option value="term">Last 90d</option>
            <option value="all">All time</option>
          </select>

          <div className="flex border border-slate-200 rounded-lg overflow-hidden">
            {(["active", "dismissed", "all"] as const).map(s => (
              <button key={s}
                onClick={() => setFilterStatus(s)}
                className={`text-xs px-2.5 py-1.5 ${filterStatus === s ? "bg-[#10B981] text-white" : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"}`}>
                {s === "active" ? "Active" : s === "dismissed" ? `Dismissed (${dismissedCount})` : "All"}
              </button>
            ))}
          </div>
        </div>

        {/* Worklist */}
        <div className="flex-1 overflow-auto p-8">
          {loading ? (
            <div className="text-center text-slate-400 py-12">Loading...</div>
          ) : filteredEvents.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
              <div className="text-3xl mb-3">✅</div>
              <div className="font-semibold text-slate-700">No events match your filters</div>
              <div className="text-sm text-slate-400 mt-1">
                {ackCoveredCount > 0
                  ? <>All flagged events have been reviewed. {ackCoveredCount} earlier event{ackCoveredCount !== 1 ? "s" : ""} covered by case acknowledgements on <Link href="/pulse-beta" className="text-[#06B6D4] hover:underline">Pulse</Link>.</>
                  : filterStatus === "active" && dismissedCount > 0
                    ? `${dismissedCount} dismissed events hidden — switch to "All" to see them.`
                    : "Adjust the filters above or check back later."}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-700">
                  {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-400">
                  {ackCoveredCount > 0 && (
                    <Link href="/pulse-beta" className="hover:text-[#06B6D4] transition-colors"
                          title="Older events already reviewed at the case level — covered by an ack on Pulse">
                      + {ackCoveredCount} reviewed earlier
                    </Link>
                  )}
                  <span>most recent first</span>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50/60">
                  <tr className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="px-4 py-2.5">When</th>
                    <th className="px-3 py-2.5">Student</th>
                    <th className="px-3 py-2.5">Category</th>
                    <th className="px-3 py-2.5">Risk</th>
                    <th className="px-3 py-2.5">Platform</th>
                    <th className="px-3 py-2.5">Prompt</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEvents.map(event => {
                    const cat        = categoryFromMatched(event.matched);
                    const risk       = RISK_CHIP[event.risk] ?? RISK_CHIP.low;
                    const platLabel  = PLATFORM_LABEL[event.platform] ?? event.platform;
                    const status     = statusByStudent.get(event.student_id);
                    const isDismissed = dismissed.has(event.id);
                    return (
                      <tr key={event.id} className={`hover:bg-slate-50/60 transition-colors ${isDismissed ? "opacity-50" : ""}`}>
                        <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                          <span title={new Date(event.created_at).toLocaleString("en-GB")}>{relTime(event.created_at)}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <Link href={`/pulse-beta?student=${encodeURIComponent(event.student_id)}`}
                            className="font-semibold text-slate-700 hover:text-[#06B6D4] transition-colors inline-flex items-center gap-1.5"
                            title="Open this student in Pulse">
                            {event.student_id}
                            {status && status !== "monitoring" && (
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_STYLE[status].chip}`}
                                    title={`Pulse status: ${STATUS_STYLE[status].label}`}>
                                {STATUS_STYLE[status].label}
                              </span>
                            )}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">{cat}</td>
                        <td className="px-3 py-2.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${risk.cls}`}>
                            {risk.label}
                          </span>
                          {event.blocked && (
                            <span className="ml-1 text-[10px]" title="Blocked by Beacon">🛑</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">{platLabel}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-700 max-w-md">
                          <span className="line-clamp-1" title={event.prompt}>{event.prompt}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          {isDismissed ? (
                            <button onClick={() => handleUndismiss(event.id)}
                              className="text-xs text-slate-400 hover:text-slate-700 px-2 py-1">
                              ↶ Undo
                            </button>
                          ) : (
                            <>
                              <button onClick={() => handleDismiss(event.id)}
                                className="text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 px-2 py-1 rounded transition-colors mr-1">
                                ✕ Dismiss
                              </button>
                              <button onClick={() => { setEscalating(event); setEscalateNotes(""); setEscalateError(null); }}
                                className="text-xs font-semibold text-[#10B981] hover:bg-emerald-50 border border-[#10B981] px-2 py-1 rounded transition-colors">
                                Escalate →
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Escalation modal */}
      {escalating && (() => {
        // Count other pending Aegis events for this student. The ack we
        // create at "now" will cover all of them too — make that explicit
        // so the DSL isn't surprised when their inbox drops by N items.
        const otherPending = events.filter(e =>
          e.student_id === escalating.student_id &&
          e.id !== escalating.id &&
          (e.risk !== "low" || e.blocked) &&
          !dismissed.has(e.id) &&
          (() => {
            const latestAckMs = latestAckByStudent.get(e.student_id);
            return latestAckMs === undefined || new Date(e.created_at).getTime() > latestAckMs;
          })()
        );

        return (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
             onClick={() => !escalateSubmitting && setEscalating(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Escalate to Pulse</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Records an acknowledgement for <span className="font-semibold">{escalating.student_id}</span> with action <span className="font-mono text-amber-700">escalated</span> — they'll appear on the Pulse queue.
                </p>
              </div>
              <button onClick={() => setEscalating(null)} disabled={escalateSubmitting}
                className="text-slate-400 hover:text-slate-700 text-xl">×</button>
            </div>

            <div className="bg-slate-50 rounded-xl border border-slate-100 p-3 mb-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Event being escalated</p>
              <p className="text-xs text-slate-500">
                {relTime(escalating.created_at)} ·{" "}
                <span className={`font-bold ${RISK_CHIP[escalating.risk]?.cls.includes("red") ? "text-red-700" : RISK_CHIP[escalating.risk]?.cls.includes("indigo") ? "text-indigo-700" : "text-amber-700"}`}>
                  {RISK_CHIP[escalating.risk]?.label} risk
                </span>{" "}
                · {PLATFORM_LABEL[escalating.platform] ?? escalating.platform}
              </p>
              <p className="text-sm text-slate-700 mt-1.5 italic">"{escalating.prompt}"</p>
            </div>

            {/* Bulk-clear callout: the ack timestamp will sweep up every
                older pending event for this student. Explicit per design
                pass — keeps DSL informed instead of silently emptying
                their inbox. */}
            {otherPending.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
                <p className="text-xs text-amber-900">
                  <span className="font-bold">Also covers {otherPending.length} other pending event{otherPending.length !== 1 ? "s" : ""}</span> from {escalating.student_id}.
                  This acknowledgement will mark every flagged event from this student up to now as reviewed.
                </p>
                <details className="mt-2">
                  <summary className="text-[11px] text-amber-700 cursor-pointer hover:text-amber-900">
                    Show the {otherPending.length} other event{otherPending.length !== 1 ? "s" : ""}
                  </summary>
                  <ul className="mt-2 space-y-1 text-[11px] text-amber-800">
                    {otherPending.slice(0, 8).map(e => (
                      <li key={e.id} className="flex items-start gap-2">
                        <span className="text-amber-600 shrink-0 w-12">{relTime(e.created_at)}</span>
                        <span className="font-mono text-amber-700 shrink-0 w-14">{RISK_CHIP[e.risk]?.label ?? e.risk}</span>
                        <span className="italic truncate" title={e.prompt}>"{e.prompt}"</span>
                      </li>
                    ))}
                    {otherPending.length > 8 && (
                      <li className="text-[10px] text-amber-600 italic">+ {otherPending.length - 8} more</li>
                    )}
                  </ul>
                </details>
              </div>
            )}

            <label className="block text-xs font-semibold text-slate-600 mb-1">Notes (optional)</label>
            <textarea value={escalateNotes} onChange={e => setEscalateNotes(e.target.value)}
              placeholder="Why this needs Pulse-level review..."
              rows={3}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#10B981]/20" />
            {escalateError && (
              <p className="text-xs text-red-600 mt-2">{escalateError}</p>
            )}

            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => setEscalating(null)} disabled={escalateSubmitting}
                className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5">
                Cancel
              </button>
              <button onClick={submitEscalation} disabled={escalateSubmitting}
                className="text-xs font-semibold text-white bg-[#10B981] hover:bg-emerald-600 px-4 py-1.5 rounded-xl disabled:opacity-50">
                {escalateSubmitting
                  ? "Escalating…"
                  : otherPending.length > 0
                    ? `Confirm Escalate (+ ${otherPending.length})`
                    : "Confirm Escalate"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
