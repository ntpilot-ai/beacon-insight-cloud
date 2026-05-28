/**
 * One-shot inspection of the platform distribution in beacon_events.
 * Read-only debug tool. Useful after a fixture reseed to confirm the
 * intended platform variety came through.
 *
 * Run: npx tsx --env-file=.env.local scripts/inspect_platforms.ts
 */

import { createClient } from "@supabase/supabase-js";

const SCHOOL_ID = process.env.NEXT_PUBLIC_SCHOOL_ID || "beacon-academy";
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function main() {
  const { data } = await sb
    .from("beacon_events")
    .select("student_id,platform,created_at")
    .eq("school_id", SCHOOL_ID);

  if (!data?.length) { console.log("no events"); return; }

  const overall: Record<string, number> = {};
  const byStudent: Record<string, Record<string, number>> = {};
  data.forEach((e: any) => {
    overall[e.platform] = (overall[e.platform] || 0) + 1;
    if (!byStudent[e.student_id]) byStudent[e.student_id] = {};
    byStudent[e.student_id][e.platform] = (byStudent[e.student_id][e.platform] || 0) + 1;
  });

  console.log(`\n=== Overall (${data.length} events) ===`);
  Object.entries(overall).sort((a, b) => b[1] - a[1]).forEach(([p, n]) => {
    console.log(`  ${p.padEnd(28)} ${String(n).padStart(3)}  (${Math.round(n / data.length * 100)}%)`);
  });

  console.log(`\n=== Per-student mix ===`);
  Object.keys(byStudent).sort().forEach(sid => {
    const m = byStudent[sid];
    const total = Object.values(m).reduce((a, b) => a + b, 0);
    const parts = Object.entries(m).sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `${p.split(".")[0]}=${n}`);
    console.log(`  ${sid.padEnd(16)} (${String(total).padStart(2)})  ${parts.join("  ")}`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
