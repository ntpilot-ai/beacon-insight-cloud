import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculateAllPulsesV3, type BeaconEvent, type PulseAcknowledgement, type StudentPulseV3 } from "@/lib/pulse_engine_v3";
import { fetchTermContext } from "@/lib/terms";
import { groupSessions, mergeAnalyses, type SessionAnalysis } from "@/lib/sessions";
import { buildTriagePrompt, parseTriageVerdict, isActiveStudent, TRIAGE_SYSTEM_PROMPT, type TriageResult } from "@/lib/triage";
import { activeSnoozeFor, shouldBreakSnooze, type PulseSnooze } from "@/lib/snooze";
import { type StudentSignalSuppression } from "@/lib/feedback";
import { detectClusters, type StudentCluster } from "@/lib/cluster_engine";

/**
 * POST /api/triage/run
 *
 * Phase 3 daily triage classifier. For every "active" student (≥1 event in
 * the last 48h) who doesn't already have a triage row for today, builds a
 * structured behavioural summary from the v3 engine and asks Haiku for a
 * staff-facing verdict. Upserts one row per (school, student, day).
 *
 * On-demand for now — wire a Vercel cron when the surface stabilises.
 *
 * Body:
 *   {
 *     requested_by: string,
 *     school_id?:   string,  // defaults to env NEXT_PUBLIC_SCHOOL_ID
 *     force?:       boolean  // re-run for students already triaged today
 *   }
 */

const PAGE_SIZE     = 1000;
const HISTORY_DAYS  = 14;   // enough for v3 fingerprint + near-term + categories
const CONCURRENCY   = 4;    // parallel Haiku calls

export async function POST(req: NextRequest) {
  const apiKey  = process.env.ANTHROPIC_API_KEY;
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!apiKey || !supaUrl || !supaKey) {
    return NextResponse.json({ error: "Required env vars not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const requested_by = String(body?.requested_by || "").slice(0, 200);
  const school_id    = String(body?.school_id || process.env.NEXT_PUBLIC_SCHOOL_ID || "beacon-academy");
  const force        = !!body?.force;

  if (!requested_by) {
    return NextResponse.json({ error: "requested_by is required" }, { status: 400 });
  }

  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
  const now      = Date.now();
  const cutoff   = new Date(now - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const todayUtc = new Date(now).toISOString().slice(0, 10);

  // ── Gather inputs ──
  const events = await fetchEvents(supabase, school_id, cutoff);
  if (events.length === 0) {
    return NextResponse.json({ status: "no_events", processed: 0, triaged: [] });
  }

  const [acks, analyses, existingToday, snoozes, suppressions, termContext] = await Promise.all([
    fetchAcks(supabase, school_id),
    fetchAnalyses(supabase, school_id, cutoff),
    fetchTodaysTriage(supabase, school_id, todayUtc),
    fetchSnoozes(supabase, school_id),
    fetchSuppressions(supabase, school_id, now),
    fetchTermContext(supabase, school_id),
  ]);

  // ── Score everyone with the v3 engine, then filter ──
  const rawPulses = calculateAllPulsesV3(events, acks, analyses, termContext ?? undefined);
  // Apply active signal suppressions (triage-only: suppressions affect the
  // prompt and threshold decisions but never write back to the live Pulse page).
  const pulses = rawPulses.map(p => applySuppressions(p, suppressions, now));
  const sessions = mergeAnalyses(groupSessions(events), analyses);

  const eventsByStudent = bucket(events, e => e.student_id);
  const alreadyTriaged  = new Set(existingToday.map(t => t.student_id));

  // Snooze gating + override evaluation. For each active student we decide:
  //   - candidate:    run the LLM
  //   - snoozed:      skip the LLM, no DB write
  //   - break-then-run: snooze had an override fire — mark broken_early,
  //                     then run the LLM (counted as candidate)
  const candidates: StudentPulseV3[] = [];
  const skippedSnoozed: { student_id: string; expires_at: string | null }[] = [];
  const brokenSnoozes:  { student_id: string; snooze_id: string; reason: string }[] = [];

  for (const p of pulses) {
    const evs = eventsByStudent.get(p.student_id) || [];
    if (!isActiveStudent(evs, now))                continue;
    if (!force && alreadyTriaged.has(p.student_id)) continue;

    const snooze = activeSnoozeFor(p.student_id, snoozes, now);
    if (snooze) {
      const breakReason = shouldBreakSnooze(p, snooze);
      if (breakReason) {
        brokenSnoozes.push({ student_id: p.student_id, snooze_id: snooze.id, reason: breakReason });
        candidates.push(p);
      } else {
        skippedSnoozed.push({ student_id: p.student_id, expires_at: snooze.expires_at });
      }
    } else {
      candidates.push(p);
    }
  }

  // Mark broken snoozes up-front so the UI reflects the new state even if
  // some Haiku calls fail later in the run.
  for (const b of brokenSnoozes) {
    await supabase.from("pulse_snooze").update({
      broken_early:  true,
      broken_at:     new Date(now).toISOString(),
      broken_reason: b.reason,
    }).eq("id", b.snooze_id);
  }

  if (candidates.length === 0) {
    return NextResponse.json({
      status: "nothing_to_do",
      reason: existingToday.length > 0 ? "all_active_students_already_triaged_today" : "no_active_students",
      active_students: pulses.filter(p => isActiveStudent(eventsByStudent.get(p.student_id) || [], now)).length,
      already_triaged_today: existingToday.length,
      snoozed_skipped: skippedSnoozed.length,
    });
  }

  // ── Run Haiku in bounded-parallel batches ──
  const results: TriageResult[] = [];
  const failures: { student_id: string; error: string }[] = [];

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(p =>
      triageOne({
        pulse:    p,
        sessions,
        acks,
        apiKey:   apiKey!,
        school_id,
        requested_by,
        now,
      }),
    ));

    settled.forEach((s, idx) => {
      const sid = batch[idx].student_id;
      if (s.status === "fulfilled") results.push(s.value);
      else                          failures.push({ student_id: sid, error: String(s.reason).slice(0, 300) });
    });
  }

  // ── Upsert into beacon_triage_results ──
  // The unique index is on (school_id, student_id, day-of-assessed_at), which
  // ON CONFLICT can't target (expression index, not a constraint). So we
  // UPDATE today's row first; if no rows match, INSERT. The anon RLS grants
  // SELECT/INSERT/UPDATE but not DELETE, so the previous delete-then-insert
  // pattern silently lost re-run verdicts under RLS.
  const dayStart = `${todayUtc}T00:00:00Z`;
  const dayEnd   = `${todayUtc}T23:59:59.999Z`;
  let upsertedCount = 0;

  for (const r of results) {
    const updatePatch = {
      assessed_at:        r.assessed_at,
      triage:             r.triage,
      concern_summary:    r.concern_summary,
      suggested_action:   r.suggested_action,
      notify_immediately: r.notify_immediately,
      reasoning:          r.reasoning,
      input_snapshot:     r.input_snapshot,
      model_version:      r.model_version,
      requested_by:       r.requested_by,
    };

    const updateRes = await supabase
      .from("beacon_triage_results")
      .update(updatePatch)
      .eq("school_id",  r.school_id)
      .eq("student_id", r.student_id)
      .gte("assessed_at", dayStart)
      .lte("assessed_at", dayEnd)
      .select();

    if (updateRes.error) {
      failures.push({ student_id: r.student_id, error: `Update failed: ${updateRes.error.message}` });
      continue;
    }

    if (updateRes.data && updateRes.data.length > 0) {
      upsertedCount++;
      continue;
    }

    // No existing row for today — insert fresh.
    const insertRes = await supabase.from("beacon_triage_results").insert(r);
    if (insertRes.error) {
      failures.push({ student_id: r.student_id, error: `Insert failed: ${insertRes.error.message}` });
    } else {
      upsertedCount++;
    }
  }

  // ── Cluster detection (runs across all active pulses, not just today's candidates) ──
  const allClusters    = detectClusters(events, pulses, now);
  const todayClusters  = await fetchTodayClusters(supabase, school_id, todayUtc);
  const existingKeys   = new Set(todayClusters.map((c: { cluster_key: string }) => c.cluster_key));
  const newClusters    = force ? allClusters : allClusters.filter(c => !existingKeys.has(c.cluster_key));

  const clusterResults: { cluster_key: string; triage: string; notify_immediately: boolean }[] = [];
  const clusterFailures: { cluster_key: string; error: string }[] = [];

  for (let i = 0; i < newClusters.length; i += CONCURRENCY) {
    const batch = newClusters.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map(async c => {
      try {
        const clusterId = await upsertCluster(supabase, school_id, c, todayUtc);
        if (!clusterId) return;

        const verdict = await triageCluster(c, apiKey!, now);
        await supabase.from("cluster_triage_results").insert({
          school_id,
          cluster_id:        clusterId,
          triaged_at:        new Date(now).toISOString(),
          triage:            verdict.triage,
          concern_summary:   verdict.concern_summary,
          suggested_action:  verdict.suggested_action,
          notify_immediately: verdict.notify_immediately,
          reasoning:         verdict.reasoning ?? null,
          model_version:     "claude-haiku-4-5",
          requested_by,
        });

        clusterResults.push({
          cluster_key:       c.cluster_key,
          triage:            verdict.triage,
          notify_immediately: verdict.notify_immediately,
        });
      } catch (err: any) {
        clusterFailures.push({ cluster_key: c.cluster_key, error: String(err).slice(0, 300) });
      }
    }));
  }

  return NextResponse.json({
    status:    "ok",
    processed: candidates.length,
    succeeded: upsertedCount,
    failed:    failures.length,
    snoozed_skipped:   skippedSnoozed.length,
    snoozes_broken:    brokenSnoozes.length,
    clusters_detected: allClusters.length,
    clusters_triaged:  clusterResults.length,
    triaged:   results.map(r => ({
      student_id:         r.student_id,
      triage:             r.triage,
      notify_immediately: r.notify_immediately,
    })),
    clusters: clusterResults,
    failures,
    cluster_failures: clusterFailures,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function triageOne(opts: {
  pulse:        StudentPulseV3;
  sessions:     ReturnType<typeof mergeAnalyses>;
  acks:         PulseAcknowledgement[];
  apiKey:       string;
  school_id:    string;
  requested_by: string;
  now:          number;
}): Promise<TriageResult> {
  const prompt = buildTriagePrompt({
    pulse:    opts.pulse,
    sessions: opts.sessions as any,
    acks:     opts.acks,
    now:      opts.now,
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system:     TRIAGE_SYSTEM_PROMPT,
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Haiku call failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.content?.map((c: any) => c.text ?? "").join("") ?? "";
  const verdict = parseTriageVerdict(text);

  return {
    school_id:          opts.school_id,
    student_id:         opts.pulse.student_id,
    assessed_at:        new Date(opts.now).toISOString(),
    triage:             verdict.triage,
    concern_summary:    verdict.concern_summary,
    suggested_action:   verdict.suggested_action,
    notify_immediately: verdict.notify_immediately,
    reasoning:          verdict.reasoning,
    input_snapshot:     prompt,
    model_version:      "claude-haiku-4-5",
    requested_by:       opts.requested_by,
  };
}

async function fetchEvents(supabase: any, schoolId: string, cutoff: string): Promise<BeaconEvent[]> {
  const all: BeaconEvent[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("beacon_events")
      .select("id,created_at,student_id,platform,prompt,risk,blocked,matched")
      .eq("school_id", schoolId)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...(data as BeaconEvent[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

async function fetchAcks(supabase: any, schoolId: string): Promise<PulseAcknowledgement[]> {
  const { data, error } = await supabase
    .from("pulse_acknowledgements")
    .select("id,school_id,student_id,acknowledged_by,acknowledged_at,alert_level,dominant_category,action_taken,notes,expires_at")
    .eq("school_id", schoolId)
    .order("acknowledged_at", { ascending: false });
  if (error || !data) return [];
  return data as PulseAcknowledgement[];
}

async function fetchAnalyses(supabase: any, schoolId: string, cutoff: string): Promise<SessionAnalysis[]> {
  const { data, error } = await supabase
    .from("beacon_session_analysis")
    .select("session_id,escalated_to_llm,sentiment_score,sentiment_messages,sentiment_trend,llm_requested_by,llm_requested_at,context_risk,sentiment_arc,concern_summary,requires_review,reasoning,behavioural_indicators,analyzed_at")
    .eq("school_id", schoolId)
    .gte("ended_at", cutoff)
    .order("analyzed_at", { ascending: false });
  if (error || !data) return [];
  return data as SessionAnalysis[];
}

async function fetchSnoozes(supabase: any, schoolId: string): Promise<PulseSnooze[]> {
  // Only fetch potentially-active rows: not broken_early, and either no
  // expiry or expiry in the future. activeSnoozeFor still picks the most
  // recent per student client-side.
  const { data, error } = await supabase
    .from("pulse_snooze")
    .select("id,school_id,student_id,snoozed_by,snoozed_at,expires_at,duration_label,reason,broken_early,broken_at,broken_reason,snooze_time_score,snooze_time_alert_level")
    .eq("school_id", schoolId)
    .eq("broken_early", false)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("snoozed_at", { ascending: false });
  if (error || !data) return [];
  return data as PulseSnooze[];
}

async function fetchSuppressions(supabase: any, schoolId: string, now: number): Promise<StudentSignalSuppression[]> {
  const { data, error } = await supabase
    .from("student_signal_suppression")
    .select("id,school_id,student_id,signal_id,category,factor,expires_at,reason,feedback_id")
    .eq("school_id", schoolId)
    .gt("expires_at", new Date(now).toISOString());
  if (error || !data) return [];
  return data as StudentSignalSuppression[];
}

function applySuppressions(
  pulse:        StudentPulseV3,
  suppressions: StudentSignalSuppression[],
  now:          number,
): StudentPulseV3 {
  const active = suppressions.filter(
    s => s.student_id === pulse.student_id && new Date(s.expires_at).getTime() > now,
  );
  if (!active.length) return pulse;

  const dominantCat = pulse.categories[0]?.name ?? null;
  const signals = pulse.signals.map(sig => {
    const sup = active.find(s =>
      (!s.signal_id || s.signal_id === sig.id) &&
      (!s.category    || s.category === dominantCat),
    );
    if (!sup) return sig;
    return { ...sig, score: Math.round(sig.score * sup.factor) };
  });

  const totalWeight = signals.reduce((s, sig) => s + sig.weight, 0);
  const newScore    = totalWeight > 0
    ? Math.round(signals.reduce((s, sig) => s + sig.score * sig.weight, 0) / totalWeight)
    : 0;
  const newLevel: StudentPulseV3["alert_level"] =
    newScore >= 70 ? "critical" : newScore >= 50 ? "high" : newScore >= 25 ? "medium" : "low";
  const newDominant = [...signals].sort(
    (a, b) => b.score * b.weight - a.score * a.weight,
  )[0] ?? pulse.dominant_signal;

  return { ...pulse, signals, pulse_score: newScore, alert_level: newLevel, dominant_signal: newDominant };
}

async function fetchTodaysTriage(supabase: any, schoolId: string, todayUtc: string): Promise<{ student_id: string }[]> {
  const { data, error } = await supabase
    .from("beacon_triage_results")
    .select("student_id")
    .eq("school_id", schoolId)
    .gte("assessed_at", `${todayUtc}T00:00:00Z`)
    .lte("assessed_at", `${todayUtc}T23:59:59.999Z`);
  if (error || !data) return [];
  return data as { student_id: string }[];
}

function bucket<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const arr = map.get(k);
    if (arr) arr.push(item); else map.set(k, [item]);
  }
  return map;
}

async function fetchTodayClusters(
  supabase:  any,
  schoolId:  string,
  todayUtc:  string,
): Promise<{ cluster_key: string }[]> {
  const { data, error } = await supabase
    .from("student_clusters")
    .select("cluster_key")
    .eq("school_id", schoolId)
    .gte("detected_at", `${todayUtc}T00:00:00Z`)
    .lte("detected_at", `${todayUtc}T23:59:59.999Z`);
  if (error || !data) return [];
  return data;
}

async function upsertCluster(
  supabase:  any,
  schoolId:  string,
  cluster:   StudentCluster,
  todayUtc:  string,
): Promise<string | null> {
  const row = {
    school_id:         schoolId,
    cluster_key:       cluster.cluster_key,
    detected_at:       cluster.detected_at,
    detected_date:     todayUtc,
    cluster_type:      cluster.cluster_type,
    student_ids:       cluster.student_ids,
    student_count:     cluster.student_count,
    category:          cluster.category,
    time_window_hours: cluster.time_window_hours,
    group_context:     cluster.group_context ?? null,
    severity:          cluster.severity,
    summary:           cluster.summary,
    individual_pulses: cluster.individual_pulses,
    requires_review:   cluster.requires_review,
  };

  const dayStart = `${todayUtc}T00:00:00Z`;
  const dayEnd   = `${todayUtc}T23:59:59.999Z`;

  // Update-first pattern (same as individual triage) because the unique index
  // is on an expression and ON CONFLICT can't target it.
  const upd = await supabase
    .from("student_clusters")
    .update(row)
    .eq("school_id",   schoolId)
    .eq("cluster_key", cluster.cluster_key)
    .gte("detected_at", dayStart)
    .lte("detected_at", dayEnd)
    .select("id");

  if (upd.data && upd.data.length > 0) return upd.data[0].id as string;

  const ins = await supabase
    .from("student_clusters")
    .insert(row)
    .select("id");

  if (ins.error || !ins.data?.length) return null;
  return ins.data[0].id as string;
}

const CLUSTER_SYSTEM_PROMPT = `You are a school safeguarding analyst assessing a group-level behavioural pattern detected across multiple students.
You must not identify, name, or reference individual students.
Assess whether this pattern represents a collective concern that requires staff attention beyond what individual student reviews would surface.
Consider: coordinated behaviour, shared stressors, group dynamics, and safeguarding implications.

Respond with valid JSON only — no prose, no markdown fences.
Schema:
{
  "triage": "notable" | "significant" | "critical",
  "concern_summary": "...",
  "suggested_action": "...",
  "notify_immediately": boolean,
  "reasoning": "..."
}

triage levels:
  notable      — worth awareness but no urgent action needed
  significant  — staff should review together before individual sessions
  critical     — immediate collective response required

notify_immediately true only for: coordinated jailbreak patterns OR critical severity sentiment waves.`;

async function triageCluster(
  cluster: StudentCluster,
  apiKey:  string,
  now:     number,
): Promise<{ triage: string; concern_summary: string; suggested_action: string; notify_immediately: boolean; reasoning?: string }> {
  const prompt = `Group pattern detected:
Type: ${cluster.cluster_type.replace(/-/g, " ")}
Category: ${cluster.category}
Students affected: ${cluster.student_count} (anonymised)
Time window: ${cluster.time_window_hours} hours
Group context: ${cluster.group_context ?? "mixed platforms"}
Engine severity: ${cluster.severity}
Individual alert levels: ${cluster.individual_pulses.join(", ")}
Summary: ${cluster.summary}

Assess whether this constitutes a safeguarding concern at the group level. Consider whether the collective pattern is more significant than the sum of individual alerts.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system:     CLUSTER_SYSTEM_PROMPT,
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) throw new Error(`Haiku cluster triage failed (${response.status})`);

  const data   = await response.json();
  const text   = (data.content?.map((c: any) => c.text ?? "").join("") ?? "").trim();
  const clean  = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

  try {
    const parsed = JSON.parse(clean);
    return {
      triage:            ["notable","significant","critical"].includes(parsed.triage) ? parsed.triage : cluster.severity,
      concern_summary:   String(parsed.concern_summary || "").slice(0, 500),
      suggested_action:  String(parsed.suggested_action || "").slice(0, 500),
      notify_immediately: !!parsed.notify_immediately,
      reasoning:         String(parsed.reasoning || "").slice(0, 500),
    };
  } catch {
    // Fallback: use engine-computed values if LLM output is unparseable
    return {
      triage:            cluster.severity,
      concern_summary:   cluster.summary,
      suggested_action:  cluster.requires_review ? "Review group pattern with pastoral lead." : "Monitor individually.",
      notify_immediately: cluster.cluster_type === "coordinated_jailbreak" || cluster.severity === "critical",
    };
  }
}
