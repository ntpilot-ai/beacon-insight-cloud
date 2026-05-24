// Sentiment pre-filter for the session analysis pipeline.
//
// Runs a lightweight rule-based score across the post-trigger window of a
// session and decides whether the session is concerning enough to escalate
// to the full LLM semantic pass. Sessions that read neutral or improving
// after a trigger are logged but never LLM-analysed, keeping API spend down
// while ensuring genuine distress always reaches deeper review.

import Sentiment from "sentiment";
import type { SessionSentiment, SentimentTrend } from "./sessions";

const analyser = new Sentiment();

export function scoreSessionSentiment(events: { prompt: string }[]): SessionSentiment {
  if (!events.length) {
    return { score: 0, arc: [], trend: "stable", escalate_to_llm: false };
  }

  const scores = events.map(e => analyser.analyze(e.prompt ?? ""));
  const arc    = scores.map(s => s.comparative);
  const score  = arc.reduce((sum, v) => sum + v, 0) / arc.length;

  const mid        = Math.floor(arc.length / 2);
  const firstHalf  = mid > 0 ? arc.slice(0, mid).reduce((s, v) => s + v, 0) / mid : 0;
  const secondHalf = (arc.length - mid) > 0
    ? arc.slice(mid).reduce((s, v) => s + v, 0) / (arc.length - mid)
    : 0;
  const delta = secondHalf - firstHalf;

  let trend: SentimentTrend;
  if (delta < -0.5)                                 trend = "deteriorating";
  else if (delta > 0.5)                             trend = "improving";
  else if (Math.max(...arc) - Math.min(...arc) > 2) trend = "volatile";
  else                                              trend = "stable";

  return {
    score,
    arc,
    trend,
    escalate_to_llm: score < -0.5 || trend === "deteriorating" || trend === "volatile",
  };
}
