import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/clusters/[id]/acknowledge
 * Body: { acknowledged_by: string, note?: string }
 *
 * Writes a single group-level acknowledgement that links all student records
 * in the cluster — marks the cluster as reviewed by the team.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supaUrl || !supaKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { id }           = await params;
  const body             = await req.json().catch(() => ({}));
  const acknowledged_by  = String(body?.acknowledged_by || "staff").slice(0, 200);
  const acknowledged_note = String(body?.note || "").slice(0, 500);
  const now              = new Date().toISOString();

  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { error } = await supabase
    .from("student_clusters")
    .update({ acknowledged_at: now, acknowledged_by, acknowledged_note })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
