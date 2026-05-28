/**
 * Beacon Pulse test fixtures — wipe + reseed for scenario students.
 *
 * Run:   npx tsx --env-file=.env.local scripts/seed_fixtures.ts
 * Verify: npx tsx --env-file=.env.local scripts/verify_fixtures.ts
 *
 * Scope: only the 12 students named in TARGET_STUDENTS. Everything else
 * in the beacon-academy tenant (Sept-1 cohort, middle-case students) is
 * left untouched. Re-runnable: re-running wipes the same 12 students
 * and re-seeds the 9 scenario shapes deterministically.
 *
 * Convention: all timestamps are RELATIVE to runtime (now() - N), never
 * absolute dates, so scenarios don't rot as the engine's rolling windows
 * move forward.
 *
 * Convention: `risk` is only ever "low" | "medium" | "high" — never
 * "critical". Critical is engine-derived (pulse_score ≥ 70). Students
 * intended to reach critical do so via Layer-3 conditions (≥3 flagged
 * events in last 24h) plus weighted signal scores.
 */

import { createClient } from "@supabase/supabase-js";

const SCHOOL_ID = "beacon-academy";

// Students this script owns. Anything not in this list is left alone.
const TARGET_STUDENTS = [
  // Scenario students — wiped + reseeded
  "aisha.rahman", "ryan.patel", "sophie.chen", "emma.davies",
  "chloe.morrison", "james.okafor", "tyler.brooks", "david.mann",
  // Scratch — wiped, reseeded empty
  "niktu",
  // Junk / leaked manual testing — wiped, no reseed
  "niktuson@outlook.com", "STU-001", "Student-1042",
];

// Time helpers — all offsets in milliseconds from "now".
const MIN  = 60 * 1000;
const HOUR = 60 * MIN;
const DAY  = 24 * HOUR;

function iso(offsetMsAgo: number): string {
  return new Date(Date.now() - offsetMsAgo).toISOString();
}

interface SeedEvent {
  offset:   number;        // ms ago
  risk:     "low" | "medium" | "high";
  blocked?: boolean;
  matched?: string[];
  prompt:   string;
  platform?: string;
}

// ── Scenario shapes ─────────────────────────────────────────────────────────

// AISHA — target CRITICAL. Defends Layer-3 floor + broken-snooze fixture
// + FIX1 fpEnd cap. Escalating arc over ~7 days with a fresh cluster in
// the last 24h. Inappropriate Content category (matched=["explicit"]).
const aishaEvents: SeedEvent[] = [
  { offset: 7  * DAY,         risk: "medium", matched: ["explicit"],            prompt: "test-marker-aisha-arc-seed" },
  { offset: 6  * DAY,         risk: "high",   matched: ["explicit"],            prompt: "test-marker-aisha-arc-001" },
  { offset: 5  * DAY,         risk: "high",   matched: ["explicit"],            prompt: "test-marker-aisha-arc-002a" },
  { offset: 5  * DAY - 5*MIN, risk: "high",   matched: ["explicit"],            prompt: "test-marker-aisha-arc-002b" },
  { offset: 4  * DAY,         risk: "high",   matched: ["explicit"],            prompt: "test-marker-aisha-arc-003a" },
  { offset: 4  * DAY - 5*MIN, risk: "medium", matched: ["explicit"],            prompt: "test-marker-aisha-arc-003b" },
  { offset: 3  * DAY,         risk: "high",   matched: ["explicit", "threaten"], prompt: "test-marker-aisha-arc-004" },
  { offset: 2  * DAY,         risk: "medium", matched: [],                       prompt: "test-marker-aisha-arc-gap"  },
  { offset: 23 * HOUR,        risk: "high",   matched: ["explicit"],            prompt: "test-marker-aisha-l3-001" },
  { offset: 12 * HOUR,        risk: "high",   matched: ["explicit"],            prompt: "test-marker-aisha-l3-002" },
  { offset: 12 * HOUR - 5*MIN, risk: "high",  matched: ["explicit"],            prompt: "test-marker-aisha-l3-003" },
  { offset: 4  * HOUR,        risk: "high",   matched: ["explicit"],            prompt: "test-marker-aisha-l3-004" },
  { offset: 30 * MIN,         risk: "high",   matched: ["explicit"],            prompt: "test-marker-aisha-l3-005" },
];

// TYLER — target HIGH-CRITICAL. Defends Block & Re-attempt signal.
// 7 paired blocked→high re-attempts within 5 min of each block. matched=
// ["bypass","ignore"] → Jailbreak category.
// The "1 day ago" pair is placed at 22*HOUR (not 1*DAY) so both events sit
// safely inside the Layer-3 24h window even with a few minutes of drift
// between seed and verify. Exactly-24h-ago events drift out.
const tylerPairs: number[] = [5 * DAY, 4 * DAY, 3 * DAY, 2 * DAY, 22 * HOUR, 12 * HOUR, 3 * HOUR];
const tylerEvents: SeedEvent[] = tylerPairs.flatMap((offset, i) => [
  { offset: offset,           risk: "high" as const, blocked: true,  matched: ["bypass", "ignore"], prompt: `test-marker-tyler-blk-${String(i+1).padStart(2,"0")}` },
  { offset: offset - 3*MIN,   risk: "high" as const, blocked: false, matched: ["bypass", "ignore"], prompt: `test-marker-tyler-ret-${String(i+1).padStart(2,"0")}` },
]);

// DAVID — target HIGH. Substance cluster (matched=["drug"]). Single
// flagged event in last 24h to keep Layer 3 OFF — defends the "high
// without Layer-3 floor" path.
const davidEvents: SeedEvent[] = [
  { offset: 5 * DAY,  risk: "medium", matched: ["drug"],         prompt: "test-marker-david-001" },
  { offset: 4 * DAY,         risk: "high", matched: ["drug"],         prompt: "test-marker-david-002a" },
  { offset: 4 * DAY - 3*HOUR, risk: "high", matched: ["drug"],         prompt: "test-marker-david-002b" },
  { offset: 3 * DAY,         risk: "high", matched: ["drug", "weed"], prompt: "test-marker-david-003a" },
  { offset: 3 * DAY - 2*HOUR, risk: "high", matched: ["drug"],         prompt: "test-marker-david-003b" },
  { offset: 2 * DAY,  risk: "high",   matched: ["drug"],         prompt: "test-marker-david-004" },
  { offset: 1 * DAY,  risk: "high",   matched: ["drug"],         prompt: "test-marker-david-005" },
  { offset: 23 * HOUR, risk: "high",  matched: ["drug"],         prompt: "test-marker-david-006" },
];

// CHLOE — target HIGH. Violence proxy for radicalisation (matched=
// ["violen"]). Same shape as David. Engine has no Radicalisation
// category — recorded as a follow-up; this maps to "Violence".
const chloeEvents: SeedEvent[] = [
  { offset: 6 * DAY,         risk: "medium", matched: ["violen"], prompt: "test-marker-chloe-001" },
  { offset: 5 * DAY,         risk: "high",   matched: ["violen"], prompt: "test-marker-chloe-002" },
  { offset: 4 * DAY,         risk: "high",   matched: ["violen"], prompt: "test-marker-chloe-003a" },
  { offset: 4 * DAY - 4*HOUR, risk: "high",  matched: ["violen"], prompt: "test-marker-chloe-003b" },
  { offset: 3 * DAY,         risk: "high",   matched: ["violen"], prompt: "test-marker-chloe-004a" },
  { offset: 3 * DAY - 2*HOUR, risk: "high",  matched: ["violen"], prompt: "test-marker-chloe-004b" },
  { offset: 2 * DAY,         risk: "high",   matched: ["violen"], prompt: "test-marker-chloe-005" },
  { offset: 23 * HOUR,       risk: "high",   matched: ["violen"], prompt: "test-marker-chloe-006" },
];

// JAMES — target MEDIUM-HIGH. Bullying category (matched=["bully"]).
// Includes one blocked event with no re-attempt to differentiate from
// Tyler's pattern.
const jamesEvents: SeedEvent[] = [
  { offset: 6 * DAY,  risk: "medium", matched: ["bully"],              prompt: "test-marker-james-001" },
  { offset: 5 * DAY,  risk: "high",   matched: ["bully"],              prompt: "test-marker-james-002" },
  { offset: 4 * DAY,  risk: "medium", matched: ["bully"],              prompt: "test-marker-james-003" },
  { offset: 3 * DAY,  risk: "high",   matched: ["bully"],              prompt: "test-marker-james-004a" },
  { offset: 3 * DAY - 2*HOUR, risk: "high", matched: ["bully", "threaten"], prompt: "test-marker-james-004b" },
  { offset: 2 * DAY,  risk: "medium", matched: ["bully"],              prompt: "test-marker-james-005" },
  { offset: 1 * DAY,  risk: "high",   blocked: true, matched: ["bully"], prompt: "test-marker-james-006" },
  { offset: 12 * HOUR, risk: "medium", matched: ["bully"],             prompt: "test-marker-james-007" },
];

// SOPHIE — target MEDIUM. Wellbeing (matched=["harm"]). Sub-Layer-3.
const sophieEvents: SeedEvent[] = [
  { offset: 6 * DAY,  risk: "medium", matched: ["harm"], prompt: "test-marker-sophie-001" },
  { offset: 5 * DAY,  risk: "medium", matched: ["harm"], prompt: "test-marker-sophie-002" },
  { offset: 4 * DAY,  risk: "high",   matched: ["harm"], prompt: "test-marker-sophie-003" },
  { offset: 3 * DAY,  risk: "medium", matched: ["harm"], prompt: "test-marker-sophie-004" },
  { offset: 2 * DAY,  risk: "high",   matched: ["harm"], prompt: "test-marker-sophie-005" },
  { offset: 1 * DAY,  risk: "medium", matched: ["harm"], prompt: "test-marker-sophie-006" },
  { offset: 12 * HOUR, risk: "medium", matched: [],      prompt: "test-marker-sophie-007" },
  { offset: 4 * HOUR, risk: "low",    matched: [],      prompt: "test-marker-sophie-008" },
];

// EMMA — target LOW. Academic integrity, no escalation. Unflagged.
const emmaEvents: SeedEvent[] = Array.from({ length: 10 }, (_, i) => ({
  offset: (6 - i * 0.6) * DAY,
  risk:   "low" as const,
  matched: [],
  prompt: `test-marker-emma-academic-${String(i+1).padStart(2,"0")}`,
}));

// RYAN — target LOW. Genuine control student. Unflagged academic content.
const ryanEvents: SeedEvent[] = Array.from({ length: 10 }, (_, i) => ({
  offset: (6 - i * 0.6) * DAY,
  risk:   "low" as const,
  matched: [],
  prompt: `test-marker-ryan-control-${String(i+1).padStart(2,"0")}`,
}));

const SCENARIO_EVENTS: Record<string, SeedEvent[]> = {
  "aisha.rahman":  aishaEvents,
  "tyler.brooks":  tylerEvents,
  "david.mann":    davidEvents,
  "chloe.morrison": chloeEvents,
  "james.okafor":  jamesEvents,
  "sophie.chen":   sophieEvents,
  "emma.davies":   emmaEvents,
  "ryan.patel":    ryanEvents,
  // niktu — empty scratch account, no events.
};

// ── Past-term fixtures (Phase 4.5) ──────────────────────────────────────────
//
// Spring 2026 cohort. Unlike the current-term fixtures above (which use
// relative-to-now offsets so they don't rot as time moves on), past-term
// events are anchored to ABSOLUTE dates inside Spring 2026 (Jan 5 – Mar 27).
// A finished academic term is immutable history — the dates never change, so
// the rot-protection argument doesn't apply.
//
// Purpose: give Phase 4 UI work real previous-term snapshot data to render
// against, and stress-test the snapshot generation pipeline end-to-end.

interface AbsEvent {
  iso:      string;        // absolute ISO timestamp
  risk:     "low" | "medium" | "high";
  blocked?: boolean;
  matched?: string[];
  prompt:   string;
  platform?: string;
}

// AISHA Spring — Inappropriate Content cluster, ack'd twice. Snapshot
// expected to land at high band with dominant=Inappropriate Content,
// ack_count=2. This is the cross-term carry-over student.
const aishaSpringEvents: AbsEvent[] = [
  { iso: "2026-02-05T10:14:00Z", risk: "high",   matched: ["explicit"], prompt: "spring-marker-aisha-feb-001" },
  { iso: "2026-02-06T11:30:00Z", risk: "high",   matched: ["explicit"], prompt: "spring-marker-aisha-feb-002" },
  { iso: "2026-02-08T14:05:00Z", risk: "medium", matched: ["explicit"], prompt: "spring-marker-aisha-feb-003" },
  { iso: "2026-02-12T09:48:00Z", risk: "high",   matched: ["explicit"], prompt: "spring-marker-aisha-feb-004" },
  { iso: "2026-03-10T13:22:00Z", risk: "high",   matched: ["explicit"], prompt: "spring-marker-aisha-mar-001" },
  { iso: "2026-03-11T10:51:00Z", risk: "high",   matched: ["explicit"], prompt: "spring-marker-aisha-mar-002" },
  { iso: "2026-03-14T15:09:00Z", risk: "medium", matched: ["explicit"], prompt: "spring-marker-aisha-mar-003" },
  { iso: "2026-03-22T11:45:00Z", risk: "high",   matched: ["explicit"], prompt: "spring-marker-aisha-mar-004" },
];

// SOPHIE Spring — milder pattern, no acks. Snapshot expected at medium
// band with dominant=Self-harm, ack_count=0.
const sophieSpringEvents: AbsEvent[] = [
  { iso: "2026-02-20T10:00:00Z", risk: "medium", matched: ["harm"], prompt: "spring-marker-sophie-feb-001" },
  { iso: "2026-03-05T11:30:00Z", risk: "medium", matched: ["harm"], prompt: "spring-marker-sophie-mar-001" },
  { iso: "2026-03-12T14:15:00Z", risk: "medium", matched: ["harm"], prompt: "spring-marker-sophie-mar-002" },
  { iso: "2026-03-20T09:20:00Z", risk: "low",    matched: [],       prompt: "spring-marker-sophie-mar-003" },
];

// RYAN Spring — control student. All low-risk academic prompts. Snapshot
// expected at low band, ack_count=0.
const ryanSpringEvents: AbsEvent[] = [
  { iso: "2026-01-15T09:00:00Z", risk: "low", matched: [], prompt: "spring-marker-ryan-control-01" },
  { iso: "2026-02-01T10:30:00Z", risk: "low", matched: [], prompt: "spring-marker-ryan-control-02" },
  { iso: "2026-02-20T13:45:00Z", risk: "low", matched: [], prompt: "spring-marker-ryan-control-03" },
  { iso: "2026-03-05T11:15:00Z", risk: "low", matched: [], prompt: "spring-marker-ryan-control-04" },
  { iso: "2026-03-18T14:30:00Z", risk: "low", matched: [], prompt: "spring-marker-ryan-control-05" },
];

const SPRING_EVENTS: Record<string, AbsEvent[]> = {
  "aisha.rahman":  aishaSpringEvents,
  "sophie.chen":   sophieSpringEvents,
  "ryan.patel":    ryanSpringEvents,
};

// AISHA Spring acks — two responses to the cluster pattern. action_taken
// values matter: "referred" and "monitored" both count toward ack_count
// but only "referred"/"escalated" increment referral_count.
interface AbsAck {
  acknowledged_at:    string;
  alert_level:        "critical" | "high" | "medium" | "low";
  dominant_category:  string;
  action_taken:       "monitored" | "referred" | "escalated" | "no_action";
  notes:              string;
  acknowledged_by:    string;
}
const aishaSpringAcks: AbsAck[] = [
  {
    acknowledged_at:   "2026-02-13T15:00:00Z",
    alert_level:       "high",
    dominant_category: "Inappropriate Content",
    action_taken:      "referred",
    notes:             "Spring fixture: HoY informed, parental contact made",
    acknowledged_by:   "fixture-seed",
  },
  {
    acknowledged_at:   "2026-03-15T15:00:00Z",
    alert_level:       "high",
    dominant_category: "Inappropriate Content",
    action_taken:      "monitored",
    notes:             "Spring fixture: pattern returned post half-term, monitoring",
    acknowledged_by:   "fixture-seed",
  },
];

const SPRING_ACKS: Record<string, AbsAck[]> = {
  "aisha.rahman": aishaSpringAcks,
};

// Aisha's 4 broken-snooze fixtures (defend the snooze-history detail panel
// display state). Each was a 24h snooze taken at score=52/high, broken
// shortly after by the OLD critical-rise rule. After the FIX2 +20-threshold
// change these would no longer break, but they're preserved here as a
// historical-display fixture, not as a current-behaviour test.
interface SnoozeFixture {
  snoozed_offset: number;
  expires_offset: number;
  broken_offset:  number;
}
const aishaBrokenSnoozes: SnoozeFixture[] = [
  { snoozed_offset: 6 * HOUR, expires_offset: -18 * HOUR, broken_offset: 6  * HOUR - 15 * MIN }, // expires in 18h forward of now → negative offset
  { snoozed_offset: 4 * HOUR, expires_offset: -20 * HOUR, broken_offset: 4  * HOUR - 15 * MIN },
  { snoozed_offset: 2 * HOUR, expires_offset: -22 * HOUR, broken_offset: 2  * HOUR - 30 * MIN },
  { snoozed_offset: 1 * HOUR, expires_offset: -23 * HOUR, broken_offset: 30 * MIN },
];

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) { console.error("Missing Supabase env vars"); process.exit(1); }
  const sb = createClient(url, key);

  console.log("=== Beacon Pulse fixture rebuild ===");
  console.log(`Tenant: ${SCHOOL_ID}`);
  console.log(`Target students (${TARGET_STUDENTS.length}): ${TARGET_STUDENTS.join(", ")}`);

  // ── WIPE (only works with service key — anon RLS denies DELETE silently) ──
  console.log("\n--- Wipe (TS attempt) ---");
  const usingServiceKey = !!process.env.SUPABASE_SERVICE_KEY;
  console.log(`Auth: ${usingServiceKey ? "service key (can DELETE)" : "anon key (DELETEs will be silently denied by RLS)"}`);

  if (usingServiceKey) {
    await sb.from("student_clusters").delete().eq("school_id", SCHOOL_ID);
    console.log("✓ student_clusters cleared (tenant-wide)");

    // student_signal_suppression must come BEFORE pulse_feedback —
    // suppression.feedback_id has an FK to pulse_feedback.id.
    const perStudent = [
      "beacon_events",
      "pulse_acknowledgements",
      "pulse_snooze",
      "beacon_session_analysis",
      "beacon_triage_results",
      "student_signal_suppression",
      "pulse_feedback",
    ];
    for (const table of perStudent) {
      const { error } = await sb.from(table).delete()
        .eq("school_id", SCHOOL_ID)
        .in("student_id", TARGET_STUDENTS);
      console.log(`${error ? "✗" : "✓"} ${table}: ${error ? error.message : "wiped target students"}`);
    }
  } else {
    console.log("Skipping TS wipe. Run supabase/sql/wipe_fixtures.sql in Supabase SQL editor first.");
  }

  // ── PRE-FLIGHT: refuse to insert on top of existing data ──
  console.log("\n--- Pre-flight: check target students are empty ---");
  const { count: leftover, error: countErr } = await sb
    .from("beacon_events")
    .select("*", { count: "exact", head: true })
    .eq("school_id", SCHOOL_ID)
    .in("student_id", TARGET_STUDENTS);
  if (countErr) { console.error("Count failed:", countErr.message); process.exit(1); }
  if ((leftover ?? 0) > 0) {
    console.error(`\n✗ ${leftover} events still exist for target students. Aborting to avoid duplicates.`);
    console.error(`  Wipe them first by running supabase/sql/wipe_fixtures.sql in Supabase SQL editor,`);
    console.error(`  or set SUPABASE_SERVICE_KEY in .env.local so this script can DELETE directly.`);
    process.exit(1);
  }
  console.log("✓ target students are empty — proceeding with inserts");

  // ── SEED EVENTS ──
  console.log("\n--- Seed events ---");
  for (const [studentId, events] of Object.entries(SCENARIO_EVENTS)) {
    const rows = events.map(e => ({
      school_id:  SCHOOL_ID,
      student_id: studentId,
      platform:   e.platform || "chatgpt.com",
      prompt:     e.prompt,
      risk:       e.risk,
      blocked:    e.blocked ?? false,
      matched:    e.matched ?? [],
      created_at: iso(e.offset),
    }));
    const { error } = await sb.from("beacon_events").insert(rows);
    console.log(`${error ? "✗" : "✓"} ${studentId.padEnd(20)} ${rows.length} events ${error ? "ERR " + error.message : ""}`);
  }

  // ── SEED SPRING 2026 (past-term) ──
  console.log("\n--- Seed Spring 2026 events (past-term, absolute dates) ---");
  for (const [studentId, events] of Object.entries(SPRING_EVENTS)) {
    const rows = events.map(e => ({
      school_id:  SCHOOL_ID,
      student_id: studentId,
      platform:   e.platform || "chatgpt.com",
      prompt:     e.prompt,
      risk:       e.risk,
      blocked:    e.blocked ?? false,
      matched:    e.matched ?? [],
      created_at: e.iso,
    }));
    const { error } = await sb.from("beacon_events").insert(rows);
    console.log(`${error ? "✗" : "✓"} ${studentId.padEnd(20)} ${rows.length} Spring events ${error ? "ERR " + error.message : ""}`);
  }

  console.log("\n--- Seed Spring 2026 acks ---");
  for (const [studentId, acks] of Object.entries(SPRING_ACKS)) {
    const rows = acks.map(a => ({
      school_id:         SCHOOL_ID,
      student_id:        studentId,
      acknowledged_by:   a.acknowledged_by,
      acknowledged_at:   a.acknowledged_at,
      alert_level:       a.alert_level,
      dominant_category: a.dominant_category,
      action_taken:      a.action_taken,
      notes:             a.notes,
    }));
    const { error } = await sb.from("pulse_acknowledgements").insert(rows);
    console.log(`${error ? "✗" : "✓"} ${studentId.padEnd(20)} ${rows.length} Spring acks ${error ? "ERR " + error.message : ""}`);
  }

  // ── SEED AISHA'S BROKEN SNOOZES ──
  console.log("\n--- Seed Aisha broken-snooze fixtures ---");
  const snoozeRows = aishaBrokenSnoozes.map(s => ({
    school_id:               SCHOOL_ID,
    student_id:              "aisha.rahman",
    snoozed_by:              "niktuson@outlook.com",
    snoozed_at:              iso(s.snoozed_offset),
    expires_at:              iso(s.expires_offset),  // future timestamp (negative offset = ahead of now)
    duration_label:          "24h",
    reason:                  null,
    broken_early:            true,
    broken_at:               iso(s.broken_offset),
    broken_reason:           "Alert level rose to critical (score 70)",
    snooze_time_score:       52,
    snooze_time_alert_level: "high",
  }));
  const { error: snzErr } = await sb.from("pulse_snooze").insert(snoozeRows);
  console.log(`${snzErr ? "✗" : "✓"} aisha.rahman: 4 broken-snooze rows ${snzErr ? "ERR " + snzErr.message : ""}`);

  console.log("\nDone. Next: npx tsx --env-file=.env.local scripts/verify_fixtures.ts");
}

main().catch(e => { console.error(e); process.exit(1); });
