"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

interface Session {
  id:         string;
  title:      string;
  updated_at: string;
}

function relative(iso: string): string {
  const d   = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60)        return "just now";
  if (diff < 3600)      return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)     return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function RecentChats({ studentId }: { studentId: string }) {
  const [items, setItems]     = useState<Session[]>([]);
  const [loaded, setLoaded]   = useState(false);

  useEffect(() => {
    if (!studentId) return;
    let alive = true;
    supabase
      .from("chat_sessions")
      .select("id, title, updated_at")
      .eq("student_id", studentId)
      .order("updated_at", { ascending: false })
      .limit(3)
      .then(({ data }) => {
        if (!alive) return;
        setItems((data as Session[]) || []);
        setLoaded(true);
      });
    return () => { alive = false; };
  }, [studentId]);

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700">Pick up where you left off</h2>
        <Link href="/horizon/chat" className="text-xs text-[#013B93] hover:underline font-medium">
          Open Chat →
        </Link>
      </div>

      {!loaded && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0,1,2].map(i => <div key={i} className="bg-white border border-slate-100 rounded-2xl h-24 animate-pulse" />)}
        </div>
      )}

      {loaded && items.length === 0 && (
        <div className="bg-white border border-slate-100 rounded-2xl px-5 py-6 text-center text-sm text-slate-500">
          No chats yet — start one with <span className="font-semibold text-[#013B93]">Ask Horizon</span> above.
        </div>
      )}

      {loaded && items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {items.map(s => (
            <Link
              key={s.id}
              href={`/horizon/chat?session=${s.id}`}
              className="bg-white border border-slate-100 hover:border-[#013B93] hover:shadow-sm rounded-2xl px-4 py-3.5 transition-all"
            >
              <div className="text-sm font-semibold text-slate-800 line-clamp-2 mb-2 leading-snug">
                {s.title || "Untitled chat"}
              </div>
              <div className="text-[11px] text-slate-400">{relative(s.updated_at)}</div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
