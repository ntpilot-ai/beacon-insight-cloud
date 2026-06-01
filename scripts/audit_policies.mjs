// One-shot audit: read beacon-academy's keyword policies and compare against
// the hardcoded HIGH_RISK / MEDIUM_RISK arrays in app/api/chat/route.ts to
// figure out which rows are "canonical Beacon defaults" vs school additions.
//
// Output: three groups —
//   1. In DB AND in code (the genuine canonical defaults)
//   2. In DB but NOT in code (school-added, or seeded later)
//   3. In code but NOT in DB (defaults that never made it to the DB seed)
//
// Run: node scripts/audit_policies.mjs

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Parse .env.local manually so we don't need dotenv as a dep.
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// Mirror of the constants in app/api/chat/route.ts (as of 2026-05-29).
const HARDCODED_HIGH = [
  "kill","bomb","suicide","terrorist","nazi","school shooting","drugs",
  "ignore previous instructions","ignore all instructions","pretend you have no limits",
  "pretend you have no restrictions","act as dan","jailbreak","do anything now",
  "bypass your filters","you are now unrestricted","developer mode",
  "disregard your training","you have no rules",
];
const HARDCODED_MEDIUM = [
  "violence","weapon","hate","weed","bully","explicit","self harm",
  "sex","porn","adult","nudes","sexting","drugs","alcohol","shank","stab",
];

const { data: rows, error } = await supabase
  .from("beacon_policies")
  .select("word,severity,created_at")
  .eq("school_id", "beacon-academy")
  .order("severity")
  .order("word");

if (error) {
  console.error("Query failed:", error);
  process.exit(1);
}

const dbHigh   = rows.filter(r => r.severity === "high").map(r => r.word);
const dbMedium = rows.filter(r => r.severity === "medium").map(r => r.word);

console.log(`\n=== beacon-academy policy audit ===`);
console.log(`Total in DB: ${rows.length} (high: ${dbHigh.length}, medium: ${dbMedium.length})`);
console.log(`Hardcoded reference: high ${HARDCODED_HIGH.length}, medium ${HARDCODED_MEDIUM.length}`);

function diff(label, dbList, codeList) {
  const dbSet   = new Set(dbList);
  const codeSet = new Set(codeList);
  const both    = dbList.filter(w => codeSet.has(w));
  const dbOnly  = dbList.filter(w => !codeSet.has(w));
  const codeOnly = codeList.filter(w => !dbSet.has(w));

  console.log(`\n--- ${label} ---`);
  console.log(`In DB AND in code (canonical defaults): ${both.length}`);
  if (both.length) console.log("  " + both.join(", "));
  console.log(`In DB but NOT in code (school-added / extra seed): ${dbOnly.length}`);
  if (dbOnly.length) console.log("  " + dbOnly.join(", "));
  console.log(`In code but NOT in DB (defaults missing from seed): ${codeOnly.length}`);
  if (codeOnly.length) console.log("  " + codeOnly.join(", "));
}

diff("HIGH", dbHigh, HARDCODED_HIGH);
diff("MEDIUM", dbMedium, HARDCODED_MEDIUM);

// Cross-severity check: any DB words that appear in the OPPOSITE severity in code?
const codeHighSet   = new Set(HARDCODED_HIGH);
const codeMediumSet = new Set(HARDCODED_MEDIUM);
const wrongSeverity = [];
for (const w of dbHigh) if (codeMediumSet.has(w)) wrongSeverity.push(`HIGH in DB, MEDIUM in code: ${w}`);
for (const w of dbMedium) if (codeHighSet.has(w)) wrongSeverity.push(`MEDIUM in DB, HIGH in code: ${w}`);
if (wrongSeverity.length) {
  console.log(`\n--- SEVERITY MISMATCHES ---`);
  for (const line of wrongSeverity) console.log("  " + line);
}

// created_at clusters — if seeding was one event, most rows share a timestamp.
const buckets = {};
for (const r of rows) {
  const day = r.created_at?.slice(0, 10) ?? "unknown";
  buckets[day] = (buckets[day] || 0) + 1;
}
console.log(`\n--- created_at distribution ---`);
for (const [day, count] of Object.entries(buckets).sort()) {
  console.log(`  ${day}: ${count}`);
}
