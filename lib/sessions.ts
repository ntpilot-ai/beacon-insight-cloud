// Conversation-session grouping for Pulse.
//
// Pulse needs to reason about the behavioural arc of a session, not just the
// individual events inside it. This file derives sessions from beacon_events
// on read — no schema changes, no writers in the extension/API. Persisted
// LLM analysis (step 4 of the spec) will be keyed by the deterministic
// session_id produced here.
//
// A session is: same student + same platform, events within 30 min of each
// other, never crossing a local-midnight (school-day) boundary.

export interface SessionEvent {
  created_at: string;
  student_id: string;
  platform:   string;
  prompt:     string;
  risk:       string;
  blocked:    boolean;
  matched?:   string[];
}

export type SentimentArc   = "escalating" | "de-escalating" | "stable" | "unresolved";
export type ContextRisk    = "high" | "medium" | "low";

// Pre-filter sentiment trend — produced by the `sentiment` npm package via
// lib/sentiment.ts. Decoupled from SentimentArc (which is the LLM verdict)
// so the two can co-exist on a session.
export type SentimentTrend = "deteriorating" | "improving" | "stable" | "volatile";

export interface SessionSentiment {
  score:           number;
  arc:             number[];   // per-message comparative scores in order
  trend:           SentimentTrend;
  escalate_to_llm: boolean;
}

export interface ConversationSession<E extends SessionEvent = SessionEvent> {
  session_id:            string;
  student_id:            string;
  platform:              string;
  started_at:            string;
  ended_at:              string;
  events:                E[];
  trigger_event?:        E;
  has_trigger:           boolean;
  // Events flagged as part of the post-trigger conversational window. These
  // should be scored by the engine regardless of their individual risk level.
  context_window_events: E[];
  // Filled by the LLM analysis pass (step 4). Defaults applied here so
  // downstream code can treat every session uniformly until analysis lands.
  sentiment_arc:         SentimentArc;
  context_risk:          ContextRisk;
  requires_review:       boolean;
  semantic_summary?:     string;
  // Pre-filter sentiment, populated by mergeAnalyses when a row exists in
  // beacon_session_analysis (sentiment runs on every triggered session, so
  // any row has sentiment fields whether or not it escalated to the LLM).
  sentiment?:            SessionSentiment;
  // Audit trail for the LLM analysis pass. Populated only after a staff
  // member explicitly clicks "Run AI context analysis" on this session.
  llm_requested_by?:     string;
  llm_requested_at?:     string;
}

const SESSION_GAP_MS       = 30 * 60 * 1000;
const POST_TRIGGER_WINDOW  = 10;

function isTrigger(e: SessionEvent): boolean {
  if (e.blocked) return true;
  return e.risk === "medium" || e.risk === "high" || e.risk === "critical";
}

function sameLocalDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

export function groupSessions<E extends SessionEvent>(events: E[]): ConversationSession<E>[] {
  if (!events.length) return [];

  // One linear pass per (student, platform) once the events are time-ordered.
  const sorted = [...events].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const groups = new Map<string, E[]>();
  for (const e of sorted) {
    const key  = `${e.student_id}::${e.platform}`;
    const list = groups.get(key);
    if (list) list.push(e); else groups.set(key, [e]);
  }

  const sessions: ConversationSession<E>[] = [];

  for (const list of groups.values()) {
    let bucket: E[] = [];
    let lastMs = 0;

    const flush = () => {
      if (!bucket.length) return;
      const startMs    = new Date(bucket[0].created_at).getTime();
      const endMs      = new Date(bucket[bucket.length - 1].created_at).getTime();
      const triggerIdx = bucket.findIndex(isTrigger);
      const trigger    = triggerIdx >= 0 ? bucket[triggerIdx] : undefined;
      const contextWindow = trigger
        ? bucket.slice(triggerIdx + 1, triggerIdx + 1 + POST_TRIGGER_WINDOW)
        : [];

      sessions.push({
        session_id:            `${bucket[0].student_id}|${bucket[0].platform}|${startMs}`,
        student_id:            bucket[0].student_id,
        platform:              bucket[0].platform,
        started_at:            new Date(startMs).toISOString(),
        ended_at:              new Date(endMs).toISOString(),
        events:                bucket,
        trigger_event:         trigger,
        has_trigger:           !!trigger,
        context_window_events: contextWindow,
        sentiment_arc:         "stable",
        context_risk:          "low",
        requires_review:       false,
      });
      bucket = [];
    };

    for (const e of list) {
      const t   = new Date(e.created_at).getTime();
      const gap = lastMs ? t - lastMs : 0;
      const startsNew = !bucket.length
        || gap > SESSION_GAP_MS
        || !sameLocalDay(lastMs, t);

      if (startsNew) flush();
      bucket.push(e);
      lastMs = t;
    }
    flush();
  }

  // Newest first for UI/timeline use.
  return sessions.sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );
}

// Convenience: flat list of every event flagged as inside a post-trigger
// context window across all supplied sessions. The Pulse engine uses this so
// that follow-up messages after a trigger contribute to the score even when
// their individual Aegis risk is "low".
export function collectContextWindowEvents<E extends SessionEvent>(
  sessions: ConversationSession<E>[],
): E[] {
  return sessions.flatMap(s => s.context_window_events);
}

// True when a session's trigger fired but the conversation that followed is
// considered "settled" — used by the analysis pass to decide whether the
// session is stable enough to run an LLM summary on.
export function isSettled(
  session: ConversationSession,
  now: Date = new Date(),
  idleMinutes = 15,
): boolean {
  if (!session.has_trigger) return false;
  const endMs    = new Date(session.ended_at).getTime();
  const idleMs   = idleMinutes * 60 * 1000;
  return now.getTime() - endMs >= idleMs;
}

// ── LLM analysis overlay ──────────────────────────────────────────────────────

// Shape of a row in the beacon_session_analysis table — kept here so engine
// and UI code can import it without reaching into Supabase typings.
//
// Sentiment fields are populated on every row. LLM verdict fields
// (context_risk, sentiment_arc, concern_summary, reasoning,
// behavioural_indicators) are only populated when escalated_to_llm is true.
export interface SessionAnalysis {
  session_id:             string;
  // Sentiment pre-filter — populated on every row, runs automatically.
  escalated_to_llm:       boolean;
  sentiment_score:        number | null;
  sentiment_messages:     number[] | null;
  sentiment_trend:        SentimentTrend | null;
  // LLM verdict — only populated after a teacher clicks "Run AI context
  // analysis" on a flagged session. llm_requested_at is the truth source for
  // "has the LLM actually run?" — verdict columns can be null even when
  // escalated_to_llm is true.
  llm_requested_by:       string | null;
  llm_requested_at:       string | null;
  context_risk:           ContextRisk | null;
  sentiment_arc:          SentimentArc | null;
  concern_summary:        string | null;
  requires_review:        boolean;
  reasoning:              string | null;
  behavioural_indicators: string[];
  analyzed_at:            string;
}

// Overlay analysis verdicts onto sessions. Sessions without a matching row
// keep their default sentiment_arc/context_risk/requires_review so downstream
// code can treat the list uniformly.
export function mergeAnalyses<E extends SessionEvent>(
  sessions: ConversationSession<E>[],
  analyses: SessionAnalysis[],
): ConversationSession<E>[] {
  if (!analyses.length) return sessions;
  const byId = new Map(analyses.map(a => [a.session_id, a]));
  return sessions.map(s => {
    const a = byId.get(s.session_id);
    if (!a) return s;

    const sentiment: SessionSentiment | undefined =
      a.sentiment_trend !== null && a.sentiment_score !== null
        ? {
            score:           a.sentiment_score,
            arc:             a.sentiment_messages ?? [],
            trend:           a.sentiment_trend,
            escalate_to_llm: a.escalated_to_llm,
          }
        : undefined;

    return {
      ...s,
      // LLM-derived fields only overlay when the analysis actually ran.
      sentiment_arc:    a.sentiment_arc    ?? s.sentiment_arc,
      context_risk:     a.context_risk     ?? s.context_risk,
      requires_review:  a.requires_review,
      semantic_summary: a.concern_summary ?? undefined,
      sentiment,
      llm_requested_by: a.llm_requested_by ?? undefined,
      llm_requested_at: a.llm_requested_at ?? undefined,
    };
  });
}
