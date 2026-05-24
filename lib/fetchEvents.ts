import { supabase } from "@/lib/supabase";

// PostgREST caps a single response at 1000 rows regardless of the client-side
// `.range()` request, so any naive `select("*").order(...)` silently drops
// older data once the table grows beyond a thousand rows. This helper pages
// through the table 1000 at a time until everything is loaded.

const PAGE_SIZE = 1000;

export interface FetchEventsOpts {
  schoolId?: string;
  ascending?: boolean;
  studentId?: string;
}

export async function fetchAllEvents<T = any>(opts: FetchEventsOpts = {}): Promise<T[]> {
  const ascending = opts.ascending ?? false;
  const all: T[] = [];
  let offset = 0;

  while (true) {
    let q = supabase
      .from("beacon_events")
      .select("*")
      .order("created_at", { ascending })
      .range(offset, offset + PAGE_SIZE - 1);

    if (opts.schoolId)  q = q.eq("school_id",  opts.schoolId);
    if (opts.studentId) q = q.eq("student_id", opts.studentId);

    const { data, error } = await q;
    if (error || !data) break;

    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;

    offset += PAGE_SIZE;
  }

  return all;
}
