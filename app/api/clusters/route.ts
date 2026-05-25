import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/clusters?school_id=...&date=YYYY-MM-DD
 *
 * Returns today's (or the given date's) detected clusters with their triage results.
 */
export async function GET(req: NextRequest) {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supaUrl || !supaKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const school_id = searchParams.get("school_id") || process.env.NEXT_PUBLIC_SCHOOL_ID || "beacon-academy";
  const dateStr   = searchParams.get("date") || new Date().toISOString().slice(0, 10);

  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data: clusters, error } = await supabase
    .from("student_clusters")
    .select(`
      id,
      school_id,
      cluster_key,
      detected_at,
      cluster_type,
      student_ids,
      student_count,
      category,
      time_window_hours,
      group_context,
      severity,
      summary,
      individual_pulses,
      requires_review,
      dismissed_at,
      dismissed_by,
      acknowledged_at,
      acknowledged_by,
      acknowledged_note,
      cluster_triage_results (
        id,
        triage,
        concern_summary,
        suggested_action,
        notify_immediately,
        reasoning,
        triaged_at
      )
    `)
    .eq("school_id", school_id)
    .gte("detected_at", `${dateStr}T00:00:00Z`)
    .lte("detected_at", `${dateStr}T23:59:59.999Z`)
    .order("detected_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ clusters: clusters ?? [] });
}
