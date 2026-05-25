/**
 * Brief 6 — Multi-Student Cluster Detection
 *
 * Rules-based engine that looks across all students for co-occurring patterns.
 * No LLM call here — that happens in the triage run after detection.
 *
 * Four cluster types:
 *   category_spike         — 3+ students, same category, within 48h
 *   coordinated_jailbreak  — 3+ students, Jailbreak, within 6h (rolling window)
 *   keyword_co-occurrence  — same matched keyword across 3+ students, within 24h
 *   sentiment_wave         — 4+ students with rising/rapid-escalation trend, within 48h
 */

import type { BeaconEvent, StudentPulseV3 } from "./pulse_engine_v3";

export interface StudentCluster {
  cluster_id:        string;
  cluster_key:       string;
  detected_at:       string;
  cluster_type:      "category_spike" | "coordinated_jailbreak" | "keyword_co-occurrence" | "sentiment_wave";
  student_ids:       string[];
  student_count:     number;
  category:          string;
  time_window_hours: number;
  group_context?:    string;
  severity:          "notable" | "significant" | "critical";
  summary:           string;
  individual_pulses: string[];
  requires_review:   boolean;
}

export interface ClusterTriageResult {
  cluster:           StudentCluster;
  triage:            "notable" | "significant" | "critical";
  concern_summary:   string;
  suggested_action:  string;
  notify_immediately: boolean;
  reasoning?:        string;
}

// ── Category inference (mirrors clusterCategories in pulse_engine_v3) ─────────

export function inferCategory(matched: string[]): string {
  const m = (matched || []).join(" ").toLowerCase();
  if (m.includes("jailbreak") || m.includes("ignore") || m.includes("dan") || m.includes("bypass")) return "Jailbreak";
  if (m.includes("harm") || m.includes("suicide") || m.includes("hurt")) return "Self-harm";
  if (m.includes("bully") || m.includes("threaten")) return "Bullying";
  if (m.includes("weapon") || m.includes("violen") || m.includes("shank") || m.includes("stab")) return "Violence";
  if (m.includes("sex") || m.includes("explicit") || m.includes("adult") || m.includes("porn") || m.includes("nude")) return "Inappropriate Content";
  if (m.includes("drug") || m.includes("alcohol") || m.includes("weed") || m.includes("coke")) return "Substance";
  return "General";
}

// ── Severity helpers ───────────────────────────────────────────────────────────

function categorySeverity(count: number): "notable" | "significant" | "critical" {
  if (count >= 7) return "critical";
  if (count >= 5) return "significant";
  return "notable";
}

function sentimentWaveSeverity(count: number): "notable" | "significant" | "critical" {
  if (count >= 8) return "critical";
  if (count >= 6) return "significant";
  return "notable";
}

// ── Group context — dominant platform among the cluster events ─────────────────

function dominantPlatform(events: BeaconEvent[]): string | undefined {
  const counts: Record<string, number> = {};
  events.forEach(e => { counts[e.platform] = (counts[e.platform] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : undefined;
}

// ── Time window helpers ────────────────────────────────────────────────────────

function windowHours(events: BeaconEvent[]): number {
  if (events.length < 2) return 0;
  const times = events.map(e => new Date(e.created_at).getTime());
  return Math.round((Math.max(...times) - Math.min(...times)) / 3_600_000 * 10) / 10;
}

// ── Individual pulse levels for cluster members ────────────────────────────────

function pulseLevels(studentIds: string[], pulseMap: Map<string, StudentPulseV3>): string[] {
  return studentIds.map(id => pulseMap.get(id)?.alert_level ?? "unknown");
}

// ── Detection rules ────────────────────────────────────────────────────────────

function detectCategorySpike(
  events:    BeaconEvent[],
  pulseMap:  Map<string, StudentPulseV3>,
  windowMs:  number,
  minCount:  number,
  now:       number,
): StudentCluster[] {
  const cutoff = now - windowMs;
  const recent = events.filter(e =>
    new Date(e.created_at).getTime() >= cutoff &&
    e.risk !== "low"
  );

  // Group by category → students (with their events)
  const byCategory = new Map<string, Map<string, BeaconEvent[]>>();
  for (const e of recent) {
    const cat = inferCategory(e.matched || []);
    if (cat === "General") continue;
    if (!byCategory.has(cat)) byCategory.set(cat, new Map());
    const byCat = byCategory.get(cat)!;
    if (!byCat.has(e.student_id)) byCat.set(e.student_id, []);
    byCat.get(e.student_id)!.push(e);
  }

  const clusters: StudentCluster[] = [];
  for (const [cat, studentMap] of byCategory) {
    if (studentMap.size < minCount) continue;
    const studentIds  = [...studentMap.keys()];
    const allEvents   = studentIds.flatMap(id => studentMap.get(id)!);
    const hours       = windowHours(allEvents);
    const severity    = categorySeverity(studentIds.length);
    const platform    = dominantPlatform(allEvents);
    const clusterKey  = `category_spike:${cat}`;

    clusters.push({
      cluster_id:        "",    // filled by caller from DB after upsert
      cluster_key:       clusterKey,
      detected_at:       new Date(now).toISOString(),
      cluster_type:      "category_spike",
      student_ids:       studentIds,
      student_count:     studentIds.length,
      category:          cat,
      time_window_hours: hours,
      group_context:     platform,
      severity,
      summary: `${studentIds.length} students showed ${cat} patterns within ${Math.round(hours)}h${platform ? ` on ${platform}` : ""}.`,
      individual_pulses: pulseLevels(studentIds, pulseMap),
      requires_review:   severity === "critical",
    });
  }
  return clusters;
}

function detectCoordinatedJailbreak(
  events:   BeaconEvent[],
  pulseMap: Map<string, StudentPulseV3>,
  now:      number,
): StudentCluster[] {
  const WINDOW_MS   = 48 * 3_600_000;
  const TIGHT_MS    = 6  * 3_600_000;
  const cutoff      = now - WINDOW_MS;

  const jailbreakEvents = events.filter(e =>
    new Date(e.created_at).getTime() >= cutoff &&
    inferCategory(e.matched || []) === "Jailbreak"
  ).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (jailbreakEvents.length < 3) return [];

  // Sliding window: find any 6h span with 3+ distinct students
  const results: StudentCluster[] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < jailbreakEvents.length; i++) {
    const anchor   = new Date(jailbreakEvents[i].created_at).getTime();
    const windowEvs = jailbreakEvents.filter(e => {
      const t = new Date(e.created_at).getTime();
      return t >= anchor && t <= anchor + TIGHT_MS;
    });
    const studentSet = new Set(windowEvs.map(e => e.student_id));
    if (studentSet.size < 3) continue;

    const studentIds = [...studentSet];
    const key        = studentIds.sort().join("|");
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const hours      = windowHours(windowEvs);
    const platform   = dominantPlatform(windowEvs);
    const clusterKey = `coordinated_jailbreak:Jailbreak`;

    results.push({
      cluster_id:        "",
      cluster_key:       clusterKey,
      detected_at:       new Date(now).toISOString(),
      cluster_type:      "coordinated_jailbreak",
      student_ids:       studentIds,
      student_count:     studentIds.length,
      category:          "Jailbreak",
      time_window_hours: hours,
      group_context:     platform,
      severity:          studentIds.length >= 5 ? "critical" : "significant",
      summary: `${studentIds.length} students attempted AI jailbreaks within ${Math.round(hours)}h — possible shared bypass method${platform ? ` on ${platform}` : ""}.`,
      individual_pulses: pulseLevels(studentIds, pulseMap),
      requires_review:   true,
    });

    // Only report the tightest cluster (first window that fires)
    break;
  }
  return results;
}

function detectKeywordCoOccurrence(
  events:   BeaconEvent[],
  pulseMap: Map<string, StudentPulseV3>,
  now:      number,
): StudentCluster[] {
  const WINDOW_MS = 24 * 3_600_000;
  const cutoff    = now - WINDOW_MS;
  const recent    = events.filter(e =>
    new Date(e.created_at).getTime() >= cutoff &&
    e.matched && e.matched.length > 0
  );

  // Explode to keyword → students
  const byKeyword = new Map<string, Map<string, BeaconEvent[]>>();
  for (const e of recent) {
    for (const kw of (e.matched || [])) {
      const k = kw.toLowerCase().trim();
      if (!k || k.length < 3) continue;
      if (!byKeyword.has(k)) byKeyword.set(k, new Map());
      const m = byKeyword.get(k)!;
      if (!m.has(e.student_id)) m.set(e.student_id, []);
      m.get(e.student_id)!.push(e);
    }
  }

  const clusters: StudentCluster[] = [];
  for (const [keyword, studentMap] of byKeyword) {
    if (studentMap.size < 3) continue;
    const studentIds  = [...studentMap.keys()];
    const allEvents   = studentIds.flatMap(id => studentMap.get(id)!);
    const hours       = windowHours(allEvents);
    const platform    = dominantPlatform(allEvents);
    const clusterKey  = `keyword_co-occurrence:${keyword}`;

    // Severity: bump up for high-risk keywords
    const highRiskKw = /jailbreak|suicide|harm|weapon|violen|sex|explicit|threat|drug/i.test(keyword);
    let severity     = categorySeverity(studentIds.length) as "notable" | "significant" | "critical";
    if (highRiskKw && severity === "notable") severity = "significant";

    clusters.push({
      cluster_id:        "",
      cluster_key:       clusterKey,
      detected_at:       new Date(now).toISOString(),
      cluster_type:      "keyword_co-occurrence",
      student_ids:       studentIds,
      student_count:     studentIds.length,
      category:          keyword,
      time_window_hours: hours,
      group_context:     platform,
      severity,
      summary: `${studentIds.length} students matched keyword "${keyword}" within ${Math.round(hours)}h${platform ? ` on ${platform}` : ""}.`,
      individual_pulses: pulseLevels(studentIds, pulseMap),
      requires_review:   highRiskKw || severity === "critical",
    });
  }
  return clusters;
}

function detectSentimentWave(
  events:   BeaconEvent[],
  pulses:   StudentPulseV3[],
  pulseMap: Map<string, StudentPulseV3>,
  now:      number,
): StudentCluster[] {
  const WINDOW_MS = 48 * 3_600_000;
  const cutoff    = now - WINDOW_MS;

  // Students with deteriorating sentiment in the window
  const deteriorating = pulses.filter(p =>
    (p.trend_direction === "rising" || p.rapid_escalation) &&
    p.alert_level !== "low"
  );
  if (deteriorating.length < 4) return [];

  // Confirm at least 4 have events in the window
  const activeInWindow = deteriorating.filter(p =>
    events.some(e =>
      e.student_id === p.student_id &&
      new Date(e.created_at).getTime() >= cutoff
    )
  );
  if (activeInWindow.length < 4) return [];

  const studentIds    = activeInWindow.map(p => p.student_id);
  const windowEvents  = events.filter(e =>
    studentIds.includes(e.student_id) &&
    new Date(e.created_at).getTime() >= cutoff
  );
  const hours         = windowHours(windowEvents);
  const platform      = dominantPlatform(windowEvents);
  const severity      = sentimentWaveSeverity(studentIds.length);
  const clusterKey    = `sentiment_wave:distress`;

  return [{
    cluster_id:        "",
    cluster_key:       clusterKey,
    detected_at:       new Date(now).toISOString(),
    cluster_type:      "sentiment_wave",
    student_ids:       studentIds,
    student_count:     studentIds.length,
    category:          "Distress",
    time_window_hours: hours,
    group_context:     platform,
    severity,
    summary: `${studentIds.length} students showed deteriorating or rapidly escalating patterns within ${Math.round(hours)}h — possible shared stressor.`,
    individual_pulses: pulseLevels(studentIds, pulseMap),
    requires_review:   severity !== "notable",
  }];
}

// ── Main export ────────────────────────────────────────────────────────────────

export function detectClusters(
  events:  BeaconEvent[],
  pulses:  StudentPulseV3[],
  now:     number = Date.now(),
): StudentCluster[] {
  const pulseMap = new Map(pulses.map(p => [p.student_id, p]));

  const raw: StudentCluster[] = [
    // Category spike: 3+ students, same category, within 48h
    ...detectCategorySpike(events, pulseMap, 48 * 3_600_000, 3, now),

    // Coordinated jailbreak: 3+ students, Jailbreak, within 6h rolling window
    ...detectCoordinatedJailbreak(events, pulseMap, now),

    // Keyword co-occurrence: same keyword across 3+ students within 24h
    ...detectKeywordCoOccurrence(events, pulseMap, now),

    // Sentiment wave: 4+ students deteriorating within 48h
    ...detectSentimentWave(events, pulses, pulseMap, now),
  ];

  // Deduplicate by cluster_key — higher severity wins if same key appears
  // from multiple rules (e.g. jailbreak fires both category_spike and
  // coordinated_jailbreak; keep coordinated_jailbreak since it's more specific)
  const severityOrder: Record<string, number> = { notable: 0, significant: 1, critical: 2 };
  const typeOrder: Record<string, number> = {
    coordinated_jailbreak:  3,
    category_spike:         2,
    sentiment_wave:         1,
    "keyword_co-occurrence": 0,
  };
  const byKey = new Map<string, StudentCluster>();
  for (const c of raw) {
    const existing = byKey.get(c.cluster_key);
    if (!existing) { byKey.set(c.cluster_key, c); continue; }
    // Keep whichever is more specific (type order), then higher severity
    const typeWin = typeOrder[c.cluster_type] > typeOrder[existing.cluster_type];
    const sevWin  = severityOrder[c.severity] > severityOrder[existing.severity];
    if (typeWin || (!typeWin && sevWin)) byKey.set(c.cluster_key, c);
  }

  return [...byKey.values()];
}
