import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/clusters/[id]/dismiss
 * Body: { dismissed_by: string }
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

  const { id }   = await params;
  const body     = await req.json().catch(() => ({}));
  const dismissed_by = String(body?.dismissed_by || "staff").slice(0, 200);

  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { error } = await supabase
    .from("student_clusters")
    .update({ dismissed_at: new Date().toISOString(), dismissed_by })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
