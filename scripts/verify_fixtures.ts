/**
 * Beacon Pulse fixture verifier.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify_fixtures.ts
 *
 * Loads the seeded scenario students and runs calculateAllPulsesV3 on them.
 * For each, asserts the resulting alert_level matches the band declared in
 * the manifest below. Exits non-zero on any mismatch — turns silent engine
 * drift into a named test failure.
 *
 * If a band genuinely needs to change (e.g. engine got more accurate),
 * update both the manifest here AND the rationale in CLAUDE.md.
 */

import { createClient } from "@supabase/supabase-js";
import { calculateAllPulsesV3, type StudentPulseV3 } from "../lib/pulse_engine_v3";
import { fetchAllEvents } from "../lib/fetchEvents";

const SCHOOL_ID = "beacon-academy";

// Declared intent — what each student SHOULD land on after seeding.
// Each entry also names what engine path the student defends, so a
// failure is interpretable rather than just "band wrong".
interface IntendedBand {
  band:    "critical" | "high" | "medium" | "low";
  defends: string;
  expectLayer3?: boolean;
  expectRapid?:  boolean;
}

const MANIFEST: Record<string, IntendedBand> = {
  "aisha.rahman": {
    band: "critical",
    defends: "Layer-3 floor + escalating arc + broken-snooze display fixture",
    expectLayer3: true,
  },
  "tyler.brooks": {
    // High OR critical acceptable — depends on weighted signal output.
    // Declared as critical because Layer-3 floor + Block & Re-attempt 100
    // weighted should land here.
    band: "critical",
    defends: "Block & Re-attempt signal at 100, paired blocked→high re-attempts",
    expectLayer3: true,
  },
  "david.mann": {
    band: "high",
    defends: "Substance category, moderate signals WITHOUT Layer 3 firing",
    expectLayer3: false,
  },
  "chloe.morrison": {
    band: "high",
    defends: "Violence category (radicalisation proxy), moderate-escalation path",
    expectLayer3: false,
  },
  "james.okafor": {
    // medium or high either acceptable — wide window for the bullying path.
    band: "medium",
    defends: "Bullying category, mixed med/high pattern",
    expectLayer3: false,
  },
  "sophie.chen": {
    band: "medium",
    defends: "Wellbeing pattern, sub-Layer-3 medium-band path",
    expectLayer3: false,
  },
  "emma.davies": {
    band: "low",
    defends: "Academic integrity, no escalation, all-unflagged events",
    expectLayer3: false,
  },
  "ryan.patel": {
    band: "low",
    defends: "Genuine control student — matches CLAUDE.md description",
    expectLayer3: false,
  },
};

// "high" intent can land on "critical" too (closer to spec), and "medium"
// can land on "high". Tighter bands flag tighter problems. This relaxation
// only allows "drift in the more-concerning direction" — drift toward low
// is always a failure.
const BAND_ORDER = { low: 0, medium: 1, high: 2, critical: 3 };
function bandAcceptable(intended: keyof typeof BAND_ORDER, actual: keyof typeof BAND_ORDER): boolean {
  if (intended === actual) return true;
  // Allow one-step upward drift only for the "soft" intents.
  if ((intended === "medium" || intended === "high") &&
      BAND_ORDER[actual] === BAND_ORDER[intended] + 1) return true;
  return false;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) { console.error("Missing Supabase env vars"); process.exit(1); }
  const sb = createClient(url, key);

  const events = await fetchAllEvents<any>({ schoolId: SCHOOL_ID, ascending: true });

  const { data: acks } = await sb
    .from("pulse_acknowledgements")
    .select("*")
    .eq("school_id", SCHOOL_ID);

  const { data: analyses } = await sb
    .from("beacon_session_analysis")
    .select("*")
    .eq("school_id", SCHOOL_ID);

  const pulses = calculateAllPulsesV3(events as any, (acks as any) || [], (analyses as any) || []);
  const byStudent = new Map<string, StudentPulseV3>(pulses.map(p => [p.student_id, p]));

  console.log("=== Pulse fixture verification ===\n");
  let pass = 0, fail = 0;
  const failures: string[] = [];

  for (const [studentId, intent] of Object.entries(MANIFEST)) {
    const p = byStudent.get(studentId);
    if (!p) {
      console.log(`✗ ${studentId.padEnd(20)} NOT FOUND in engine output`);
      failures.push(`${studentId}: not found`);
      fail++;
      continue;
    }

    const ok =
      bandAcceptable(intent.band, p.alert_level) &&
      (intent.expectLayer3 === undefined || intent.expectLayer3 === p.layer3_active);

    const status = ok ? "✓" : "✗";
    const layer3str = p.layer3_active ? "L3" : "  ";
    const flagstr = [
      p.rapid_escalation ? "rapid" : "",
      p.re_emergence ? "re-em" : "",
    ].filter(Boolean).join(",");

    console.log(`${status} ${studentId.padEnd(20)} score=${String(p.pulse_score).padStart(3)} band=${p.alert_level.padEnd(8)} ${layer3str} ${flagstr.padEnd(12)} (intended ${intent.band})`);
    console.log(`     defends: ${intent.defends}`);

    if (ok) pass++;
    else {
      fail++;
      failures.push(`${studentId}: expected ${intent.band}${intent.expectLayer3 !== undefined ? " + L3=" + intent.expectLayer3 : ""}, got ${p.alert_level} + L3=${p.layer3_active}`);
    }
  }

  // Also verify Aisha's broken-snooze fixture is intact.
  const { data: snoozes } = await sb
    .from("pulse_snooze")
    .select("*")
    .eq("school_id", SCHOOL_ID)
    .eq("student_id", "aisha.rahman")
    .eq("broken_early", true);
  const brokenCount = snoozes?.length ?? 0;
  if (brokenCount === 4) {
    console.log(`\n✓ aisha.rahman          ${brokenCount} broken-snooze fixtures present`);
    pass++;
  } else {
    console.log(`\n✗ aisha.rahman          expected 4 broken-snooze fixtures, found ${brokenCount}`);
    failures.push(`aisha broken-snoozes: expected 4, got ${brokenCount}`);
    fail++;
  }

  console.log(`\n=== ${pass} pass · ${fail} fail ===`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
