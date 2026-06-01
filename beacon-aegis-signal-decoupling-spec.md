# Beacon — Aegis Signal Decoupling Spec (v2, ground-truthed)

> **For Claude Code.** Ordered, non-destructive change list. Goal: stop discarding the structured safeguarding signal Aegis already produces, and stop Pulse re-deriving categories from keywords — so the keyword matcher can later be swapped for the full LLM Aegis as a **back-end change nothing downstream sees**.
>
> **This is v2.** The original spec was written against assumed file locations; several were wrong. This version is corrected against the actual code (file:line references are real). Changes from v1 are marked **[CORRECTED]** / **[ADDED]**.
>
> **Do the steps in order.** Step 0 is a decision everything depends on. The schema + backfill (Step 1) must land **before** Pulse is repointed (Step 4), or historical events have a null category and Pulse breaks on existing data. The vocabulary backfill (Step 5) must land **together with** the Step 4 code change or historical re_emergence silently dies.
>
> **Do NOT** touch the `PRIVACY, DATA RETENTION & SAFEGUARDING COMPLIANCE` section of CLAUDE.md or make retention decisions. One compliance note is flagged inline in Step 1.

---

## The problem in one paragraph

`/api/classify` (Claude Haiku) already returns `{ risk, category, reason }` — the structured Aegis signal. But `beacon_events` has no column for `category` or `reason`, so that signal is **discarded at the events table** by *both* writers (the chat API and the extension). Pulse (`pulse_engine.ts`, `pulse_engine_v3.ts`) then reconstructs a cruder `category` from the `matched` keyword array via `clusterCategories`. That keyword re-derivation is the only thing coupling Pulse to the placeholder. Remove it, and the producer of the signal becomes swappable.

---

## Files this touches (verified)

- `supabase/sql/0017_beacon_events_aegis_signal.sql` — **new** additive migration: columns + events `category` backfill. Safe to land early (old code ignores the new columns). **[CORRECTED from 0013; split per point 4]**
- `supabase/sql/0018_category_vocabulary_cutover.sql` — **new** vocabulary cutover: acks + snapshots Title Case → snake_case. Must land **with the Step 4 code deploy** (old code re-pollutes Title Case otherwise). **[ADDED — split out of 0017]**
- `app/api/chat/route.ts` — keyword pipeline; writes events via `logMessage`. `category` is computed at [route.ts:168](app/api/chat/route.ts:168) but omitted from the `beacon_events` insert at [route.ts:327](app/api/chat/route.ts:327).
- `app/api/classify/route.ts` — LLM classifier. Enum at [classify/route.ts:29](app/api/classify/route.ts:29) is missing `jailbreak`.
- `extension/content.js` — **[CORRECTED from background.js]** the real `beacon_events` write is `sendToBeaconCloud` at [content.js:643](extension/content.js:643). The LLM `category` is already captured at [content.js:599](extension/content.js:599) but dropped from the POST body.
- `extension/background.js` — only proxies `/api/classify` ([background.js:27](extension/background.js:27)); **no DB write here**. No change needed beyond noting it's not the write site.
- `lib/pulse_engine.ts` — v2 engine. `clusterCategories` [pulse_engine.ts:86](lib/pulse_engine.ts:86); `signalRepeatTopics` [pulse_engine.ts:189](lib/pulse_engine.ts:189).
- `lib/pulse_engine_v3.ts` — v3 (release) engine. `clusterCategories` [pulse_engine_v3.ts:198](lib/pulse_engine_v3.ts:198) (exported); `signalRepeatTopics` [pulse_engine_v3.ts:305](lib/pulse_engine_v3.ts:305); re_emergence equality checks [:549](lib/pulse_engine_v3.ts:549) and [:580](lib/pulse_engine_v3.ts:580).
- **Page data loaders — NO CHANGE NEEDED [CORRECTED].** All Pulse/dashboard *page* loaders already `.select("*")`: [pulse/page.tsx:75](app/pulse/page.tsx:75), [pulse-beta/page.tsx:100](app/pulse-beta/page.tsx:100), [page.tsx:314](app/page.tsx:314), [dashboard-beta/page.tsx:526](app/dashboard-beta/page.tsx:526). New columns flow through automatically.
- **Server read loaders — ONE NEEDS WIDENING [ADDED].** `app/api/triage/run/route.ts` reads `beacon_events` with an **explicit column list that excludes `category`** ([triage/run/route.ts:328](app/api/triage/run/route.ts:328)): `select("id,created_at,student_id,platform,prompt,risk,blocked,matched")`. It's a read (doesn't drop the signal at ingest), but the triage classifier won't see the LLM category until this list adds `category` (and `rationale` if useful). `app/api/snapshots/generate/route.ts` uses `select("*")` ([snapshots/generate/route.ts:191](app/api/snapshots/generate/route.ts:191)) — fine.
- Ack writers — `dominant_category` sourced from `pulse.categories[0].name`: [pulse/page.tsx:605](app/pulse/page.tsx:605), [pulse-beta/page.tsx:4284](app/pulse-beta/page.tsx:4284), [pulse-beta/page.tsx:4324](app/pulse-beta/page.tsx:4324). aegis-beta writes `dominant_category: category` at [aegis-beta/page.tsx:293](app/aegis-beta/page.tsx:293).
- `lib/sessions.ts` — `SessionAnalysis` (no change required; confirm it doesn't read keywords).

---

## Step 0 — Canonical category vocabulary (linchpin — do first)

There are currently **three divergent category vocabularies**; they must converge, or the repoint produces mismatched categories and silently breaks v3 cross-term `re_emergence` (matches category strings by equality):

| Source | Current values |
|---|---|
| `/api/classify` system prompt | `academic_integrity, self_harm, violence, bullying, inappropriate_content, substance, radicalization, general` (snake_case) |
| `categoryFromMatched` (`route.ts:53`) | `self_harm, bullying, violence, jailbreak, substance, general` (snake_case, **narrower** — no `inappropriate_content`) |
| `clusterCategories` (Pulse, both engines) | `General, Jailbreak, Self-harm, Bullying, Violence, Inappropriate Content, Substance` (Title Case) |

**Adopt this canonical set (snake_case), used everywhere data is stored or compared:**

```
academic_integrity
self_harm
violence
bullying
inappropriate_content
substance
radicalization
jailbreak
general
```

Rules:
- **Storage and comparison** (DB columns, acks, snapshots, Pulse internals) use canonical snake_case only.
- **Display** is the only place human labels appear — map snake_case → label in the UI layer (`self_harm` → "Self-harm", etc.).
- `jailbreak` is retained because the code special-cases it, though it's an AI-misuse/governance signal rather than a child-safeguarding one — flag for product decision later; keep it for now.
- Add `jailbreak` to the `/api/classify` enum so the LLM path can emit it (it currently can't).

---

## Step 1 — Schema migration + events backfill (additive — `0017`)

New file `supabase/sql/0017_beacon_events_aegis_signal.sql`. **Additive only** — adds columns and backfills `beacon_events.category`. Old code ignores the new columns, so this is safe to apply any time ahead of the code deploy. The vocabulary cutover (acks/snapshots) is a **separate** migration `0018` (Step 5) that must coincide with the deploy.

```sql
-- Add the structured-signal columns Aegis already produces but had nowhere to store.
alter table beacon_events add column if not exists category    text;
alter table beacon_events add column if not exists rationale   text;
alter table beacon_events add column if not exists risk_source text default 'keyword';
-- Optional, add when the model emits it:
-- alter table beacon_events add column if not exists confidence numeric;

-- Backfill category for existing rows by faithfully reproducing the CURRENT
-- clusterCategories keyword logic, mapped to canonical snake_case. This makes
-- the Step 4 repoint a no-op on historical data (regression-safe).
-- NOTE: the substring tests below (e.g. 'dan', 'coke', 'hurt') are imprecise by
-- design — they mirror the existing engine exactly. The LLM path fixes this
-- going forward; we are not "improving" history here, only preserving behaviour.
update beacon_events
set category = case
  when array_to_string(matched, ' ') ilike any (array['%jailbreak%','%ignore%','%dan%','%bypass%'])              then 'jailbreak'
  when array_to_string(matched, ' ') ilike any (array['%harm%','%suicide%','%hurt%'])                             then 'self_harm'
  when array_to_string(matched, ' ') ilike any (array['%bully%','%threaten%'])                                    then 'bullying'
  when array_to_string(matched, ' ') ilike any (array['%weapon%','%violen%','%shank%','%stab%'])                  then 'violence'
  when array_to_string(matched, ' ') ilike any (array['%sex%','%explicit%','%adult%','%porn%','%nude%'])          then 'inappropriate_content'
  when array_to_string(matched, ' ') ilike any (array['%drug%','%alcohol%','%weed%','%coke%'])                    then 'substance'
  else 'general'
end,
risk_source = 'keyword'
where category is null;
```

- The backfill `case` here **must stay character-for-character and order-for-order identical** to `categoryFromMatched` in Step 2 — both are first-match-wins, so a prompt that hits multiple buckets must resolve the same way in history and live. See Step 2 for the matching TS and the cross-reference comment requirement.
- Leave columns **nullable** — the keyword path legitimately produces `general`, and `NOT NULL` would fight the migration.
- `risk_source` lets you see, during and after migration, which events were keyword-judged vs LLM-judged — and makes the eventual swap observable and reversible.
- **`risk_source = 'keyword'` on backfilled rows is approximate [ADDED].** Historical extension events were often risk-classified by the LLM (`/api/classify`), but because `category` was never stored you can't reconstruct which rows were LLM vs keyword. `'keyword'` is a lossy-but-reasonable default for *all* pre-migration rows — just know the provenance flag is not exact for history. It is exact from the migration forward.
- **Compliance note:** `rationale` is a one-line *derived* classification reason, not raw prompt content, so Pulse stays content-blind. But it is a special-category inference and must fall under whatever retention policy the compliance session defines — do not exempt it.

> The acks/snapshots vocabulary backfill is **NOT** in this migration — it's `0018` (Step 5), applied at code-deploy time. `0017` is purely additive so the safe part can land early and de-risk.

---

## Step 2 — Keyword chat pipeline writes the new fields (`app/api/chat/route.ts`)

1. **Widen `categoryFromMatched` to match the backfill buckets — identical substrings AND identical order [CORRECTED, sharpened per point 3].** It is currently snake_case but narrower than the Step 1 backfill (no `inappropriate_content`, thinner substring lists). Both `categoryFromMatched` and the Step 1 `case` are **first-match-wins**, so a prompt matching more than one bucket (e.g. a keyword containing both `harm` and `bully`) only categorises the same way in history and live if the **substring sets and their evaluation order are identical**. They must be character-for-character and order-for-order the same. Target body (order: jailbreak → self_harm → bullying → violence → inappropriate_content → substance, matching the SQL `case` exactly):

```ts
// IMPORTANT: kept identical (substrings + order) to the backfill `case` in
// supabase/sql/0017_beacon_events_aegis_signal.sql. Both are first-match-wins;
// divergence categorises multi-match prompts differently in history vs live.
function categoryFromMatched(matched: string[]): string {
  if (!matched.length) return "general";
  const m = matched.join(" ").toLowerCase();
  if (/jailbreak|ignore|dan|bypass/.test(m))                 return "jailbreak";
  if (/harm|suicide|hurt/.test(m))                           return "self_harm";
  if (/bully|threaten/.test(m))                              return "bullying";
  if (/weapon|violen|shank|stab/.test(m))                    return "violence";
  if (/sex|explicit|adult|porn|nude/.test(m))                return "inappropriate_content";
  if (/drug|alcohol|weed|coke/.test(m))                      return "substance";
  return "general";
}
```

> Mirror the same cross-reference comment in the SQL `case` (`-- kept identical to categoryFromMatched in app/api/chat/route.ts`) so a future edit to one prompts an edit to the other.

2. In `logMessage`, the **`beacon_events` insert** (the `if (role === "user")` mirror block at [route.ts:327](app/api/chat/route.ts:327)) currently writes only `risk`/`matched`/`prompt`/etc. `category` is already passed into `logMessage` (computed at [route.ts:168](app/api/chat/route.ts:168)) — it's simply not written to `beacon_events`. Add the new columns:

```ts
const insertResult = await supabase.from("beacon_events").insert({
  student_id: studentId,
  school_id:  schoolId || "beacon-academy",
  platform:   "beaconchat",
  prompt:     content,
  risk:       risk === "blocked" ? "high" : (risk || "low"),
  blocked:    blocked || false,
  matched:    matched || [],
  category:   category || "general",   // already computed upstream — stop dropping it
  rationale:  null,                    // keyword path has no rationale
  risk_source:"keyword",
  hostname:   "beaconchat",
});
```

---

## Step 3 — LLM classifier output flows into `beacon_events` (`app/api/classify/route.ts` + `extension/content.js`)

1. In `app/api/classify/route.ts`, add `jailbreak` to the `category` enum in `systemPrompt` ([classify/route.ts:29](app/api/classify/route.ts:29)) so the canonical set is fully emittable.

2. **[CORRECTED] The extension's `beacon_events` write is in `content.js`, NOT `background.js` — and there is NO server ingest route.** `background.js` only proxies the classify call. The write is `sendToBeaconCloud` ([content.js:643](extension/content.js:643)), which POSTs **directly to PostgREST** (`${SUPABASE_URL}/rest/v1/beacon_events`) using the **anon key**. **There is no intermediate server route that re-inserts** — the client POST body *is* the insert (PostgREST writes the columns in the body). So unlike a typical "client posts → server inserts" path, updating the body here closes the leak on its own; there's no second insert to also patch. (Confirmed: the only server-side `beacon_events` *insert* in the repo is the chat path's `logMessage` in Step 2; `triage/run` and `snapshots/generate` only *read*.)

   - **Caveat — anon column permissions:** because this is a direct PostgREST insert under the anon role, the new columns must be insertable by anon. Default table-level `INSERT` grants cover all columns, but confirm there's no column-level `GRANT` or RLS `WITH CHECK` on `beacon_events` that would reject `category`/`rationale`/`risk_source` (PostgREST will error the whole insert if so, not silently drop them).

   The LLM result is already captured by `classifyWithAI` (`{ level, matched, category, ai }` at [content.js:596](extension/content.js:596)) but `category` is dropped from the POST body. At the `sendToBeaconCloud` `body: JSON.stringify({...})`, add:
   - `category` ← the classifier `category` (already on the telemetry object via `classifyWithAI`)
   - `rationale` ← the classifier `reason` (note: `classifyWithAI` currently folds `reason` into `matched` as `[result.reason]` at [content.js:598](extension/content.js:598) — surface it as its own field so it can map to `rationale`)
   - `risk_source: telemetry.ai ? 'llm' : 'keyword'` (so a fallback-to-keyword write is correctly tagged)

   You will need to thread `category` / `rationale` / `ai` through whatever builds the `telemetry` object passed to `sendToBeaconCloud`. Trace from `classifyWithAI`'s return to the `sendToBeaconCloud` call site and carry the fields through.

3. Keep the existing `matched` write — it's now secondary signal, not the source of category. Do not remove it yet.

---

## Step 4 — Repoint Pulse to read `category` (BOTH `lib/pulse_engine.ts` and `lib/pulse_engine_v3.ts`)

> Only after Step 1's backfill is applied to the data Pulse reads. **Land together with Step 5's vocabulary backfill.**

**4a. Add `category` to the `BeaconEvent` interface in both files** ([pulse_engine.ts:8](lib/pulse_engine.ts:8), [pulse_engine_v3.ts:23](lib/pulse_engine_v3.ts:23)):

```ts
export interface BeaconEvent {
  id:         number;
  created_at: string;
  student_id: string;
  platform:   string;
  prompt:     string;
  risk:       string;
  blocked:    boolean;
  matched:    string[];
  category?:  string;   // NEW — canonical snake_case, written by Aegis
}
```

**4b. Replace `clusterCategories` (both files share the same logic) — stop substring-matching `matched`, just count `category`:**

```ts
export function clusterCategories(events: BeaconEvent[]): { name: string; count: number }[] {
  const counts: Record<string, number> = {};
  events
    .filter(e => e.risk !== "low" && e.category && e.category !== "general")
    .forEach(e => { counts[e.category!] = (counts[e.category!] || 0) + 1; });
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}
```

> **Behaviour-change note [ADDED]:** the current `clusterCategories` keeps a single `"General"` entry when it's the only category present (the `.filter(c => c.name !== "General" || Object.keys(counts).length === 1)` tail at [pulse_engine.ts:102](lib/pulse_engine.ts:102)). The replacement above drops `general` unconditionally, so a student with only general-flagged events gets an **empty** `categories[]`, which makes `pulse.categories[0]?.name` resolve to `null`. That feeds ack `dominant_category` ([pulse/page.tsx:605](app/pulse/page.tsx:605)). This is acceptable (a general-only student has no meaningful dominant category) but make it a conscious choice, and confirm the ack-write and UI tolerate a `null` dominant_category (they already type it `string | null`).

**4c. Repoint the repeat-topics signal (`signalRepeatTopics`, present in both files) from repeated keywords to repeated categories:**

```ts
function signalRepeatTopics(events: BeaconEvent[]): PulseSignal {
  const highRisk = events.filter(e => e.risk === "high" || e.risk === "critical");
  const freq: Record<string, number> = {};
  highRisk.forEach(e => {
    if (e.category && e.category !== "general") freq[e.category] = (freq[e.category] || 0) + 1;
  });
  const repeats = Object.values(freq).filter(v => v > 1).length;
  const top     = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  const score   = Math.min(100, repeats * 25);
  return {
    id: "repeat_topics", label: "Repeat Topic Patterns", score, weight: 15,
    detail: repeats > 2 ? `${repeats} categories recurring — "${top?.[0]}" appearing ${top?.[1]} times`
      : repeats > 0 ? "Some repeated risk categories detected"
      : "No repeated high-risk category patterns",
  };
}
```

Deliberate semantic upgrade: "repeated keyword" → "repeated category" is more meaningful and survives the keyword→LLM swap untouched.

**4d.** Pulse no longer reads `matched` for categorisation. Leave the field on the interface (the extension still writes it) but confirm no other Pulse code path consumes it for category derivation. (`signalRepeatTopics` was the last consumer; `signalBlockedRate` etc. use `risk`/`blocked`/timestamps only.)

**4e.** **NO CHANGE NEEDED [CORRECTED].** All Pulse/dashboard loaders already use `.select("*")` — the new columns are fetched automatically. (See Files list.)

---

## Step 5 — Vocabulary cutover: backfill acks + snapshots (migration `0018`, NOT just "confirm") [CORRECTED — was under-specified]

This is the step the v1 spec hid. Acks today store `dominant_category` from `pulse.categories[0].name`, which is **Title Case** (because `clusterCategories` emits Title Case today). The moment Step 4b makes `clusterCategories` emit snake_case, all **existing** ack rows and term-snapshot `dominant_categories` still hold Title Case — and v3 matches them by string equality ([pulse_engine_v3.ts:549](lib/pulse_engine_v3.ts:549), [:580](lib/pulse_engine_v3.ts:580)). Result: within-term and cross-term `re_emergence` **silently stop firing** for every student acknowledged before the cutover.

Put this in its **own** migration `supabase/sql/0018_category_vocabulary_cutover.sql` (idempotent — only rewrites known Title Case literals). Splitting it out of `0017` means the additive part de-risks early and this cutover's re-pollution window shrinks to just the code deploy:

```sql
-- Vocabulary cutover: existing acks/snapshots hold Title Case dominant categories
-- (the pre-decoupling clusterCategories output). Convert to canonical snake_case
-- so v3 re_emergence equality keeps matching across the Step 4 repoint.
update pulse_acknowledgements
set dominant_category = case dominant_category
  when 'General'                then 'general'
  when 'Jailbreak'              then 'jailbreak'
  when 'Self-harm'              then 'self_harm'
  when 'Bullying'               then 'bullying'
  when 'Violence'               then 'violence'
  when 'Inappropriate Content'  then 'inappropriate_content'
  when 'Substance'              then 'substance'
  else dominant_category
end
where dominant_category is not null;

-- Term snapshots store an array of dominant categories.
update pulse_term_snapshots
set dominant_categories = (
  select array_agg(case x
    when 'General'                then 'general'
    when 'Jailbreak'              then 'jailbreak'
    when 'Self-harm'              then 'self_harm'
    when 'Bullying'               then 'bullying'
    when 'Violence'               then 'violence'
    when 'Inappropriate Content'  then 'inappropriate_content'
    when 'Substance'              then 'substance'
    else x
  end)
  from unnest(dominant_categories) as x
)
where dominant_categories is not null and array_length(dominant_categories, 1) > 0;
```

**Deploy ordering:** `0017` (additive) should already be applied. `0018` (this) and the Step 4 code repoint go out **together**. Any ack written by *old* code after `0018` runs but before the new code deploys would re-introduce Title Case — so apply `0018` at cutover, deploy immediately, and (cheap insurance) the conversion is idempotent if you need to re-run it.

After cutover, acks naturally store snake_case because `pulse.categories[0].name` is now snake_case (from 4b). Add/centralise a single display map (snake_case → human label) in the UI layer and remove any Title Case category literals from non-display code.

---

## Step 6 — (Later, the actual swap) Demote keywords, promote the LLM

Not required to land the decoupling, but this is what the seam buys you. When ready:

- Route the chat pipeline's risk/category through `/api/classify` (the LLM) instead of `assessRisk`, writing `risk_source: 'llm'`, `category`, and `rationale`.
- Keep `assessRisk(BEACON_HARDFLOOR_HIGH)` as a fast synchronous **pre-check** that can hard-block before the LLM call — the 18-term hard floor ([route.ts:21](app/api/chat/route.ts:21)) is the can't-be-disabled instant safety net; it stays.
- **Nothing in Pulse changes at this step.** If Pulse needs no edits when the producer flips, the decoupling worked.

---

## Verification

1. **Backfill complete:** `select count(*) from beacon_events where risk <> 'low' and category is null;` returns 0.
2. **Regression — pin to the cases that SHOULD be stable, not blanket equality [CORRECTED per point 2].** Two of the Step 4 changes are **deliberate deltas, not regressions** — a strict before/after equality check will "fail" on them and waste someone's time chasing phantom bugs:
   - `clusterCategories` is behaviour-preserving on backfilled keyword data **except for general-only students**, whose `categories[]` goes from `[{name:"General"}]` to `[]` (the 4b note). Expected.
   - The repeat-topics signal is **expected to change** — it now counts repeated *categories* instead of repeated *keywords* (the 4c semantic upgrade).

   So the regression assertion is: for students with at least one non-general flagged event, `categories[]` (names + counts, modulo the snake_case relabelling) and `pulse_score` are unchanged before vs after Step 4 on the same backfilled data. Do **not** assert equality on general-only students or on the repeat-topics signal detail/score.
3. **LLM path:** an event written via the classifier shows `risk_source = 'llm'` with a populated `rationale`, and appears correctly in Pulse `categories[]`.
4. **Cross-term carry-over:** a known escalation scenario (e.g. the `aisha` grooming arc) still fires `re_emergence` — confirms category strings match across events, acks, and snapshots **after the `0018` backfill**.
5. **Vocabulary cutover — DB and code [CORRECTED per point 5]:**
   - DB: `select distinct dominant_category from pulse_acknowledgements;` returns only snake_case canonical values (no Title Case survivors). Same check on `pulse_term_snapshots.dominant_categories`.
   - Code: `grep -rn "Self-harm\|Inappropriate Content\|Jailbreak\|Bullying\|Substance\|Violence" lib app` returns hits **only** inside the single snake_case→label display map — any Title Case literal in a filter/comparison/equality path is a latent mismatch bug.
6. **No content leak:** grep Pulse for `.prompt` and `.matched` — neither should be read for categorisation after Step 4.
```
