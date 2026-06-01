import type { Session } from "./types";

export interface SessionGroup {
  label:    string;
  sessions: Session[];
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function groupSessionsByDate(sessions: Session[], now = new Date()): SessionGroup[] {
  const today     = startOfDay(now);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const sevenAgo  = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const buckets: Record<string, Session[]> = {
    Today:        [],
    Yesterday:    [],
    "This week":  [],
    Earlier:      [],
  };

  for (const s of sessions) {
    const t = new Date(s.updated_at).getTime();
    if      (t >= today.getTime())     buckets.Today.push(s);
    else if (t >= yesterday.getTime()) buckets.Yesterday.push(s);
    else if (t >= sevenAgo.getTime())  buckets["This week"].push(s);
    else                               buckets.Earlier.push(s);
  }

  return Object.entries(buckets)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, sessions: list }));
}
