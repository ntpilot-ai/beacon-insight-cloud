/**
 * Inspect pulse_term_snapshots for the beacon-academy tenant.
 * Run: npx tsx --env-file=.env.local scripts/inspect_snapshots.ts
 *
 * Read-only debug tool. Walks all snapshot rows for a school, prints one
 * line per student-term with the headline fields. Useful after running
 * snapshot generation to eyeball the term-on-term arc per student.
 */

import { createClient } from "@supabase/supabase-js";

const SCHOOL_ID = process.env.NEXT_PUBLIC_SCHOOL_ID || "beacon-academy";
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function main() {
  const { data: terms } = await sb
    .from("school_terms")
    .select("term_id,name,start_date,end_date")
    .eq("school_id", SCHOOL_ID)
    .order("start_date");

  for (const t of terms ?? []) {
    console.log(`\n=== ${(t as any).name}  (${(t as any).term_id}) ===`);
    const { data } = await sb
      .from("pulse_term_snapshots")
      .select("*")
      .eq("school_id", SCHOOL_ID)
      .eq("term_id", (t as any).term_id)
      .order("final_score", { ascending: false });

    if (!data?.length) { console.log("  (no snapshots)"); continue; }

    data.forEach((s: any) => {
      console.log(
        "  " + s.student_id.padEnd(16),
        "open=" + s.opening_alert_level.padEnd(6),
        "peak=" + s.peak_alert_level.padEnd(8),
        "final=" + s.final_alert_level.padEnd(8),
        "traj=" + s.trajectory.padEnd(20),
        "acks=" + String(s.ack_count).padEnd(2),
        "refs=" + String(s.referral_count).padEnd(2),
        "flag=" + s.flagged_events + "/" + s.total_events,
        "cats=[" + (s.dominant_categories || []).join(",") + "]",
      );
    });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
