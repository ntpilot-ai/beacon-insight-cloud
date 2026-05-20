"use client";

import Header from "@/components/Header";
import MonitoringBanner from "@/components/MonitoringBanner";
import KPIGrid from "@/components/KPIGrid";
import StudentProfiles from "@/components/StudentProfiles";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  Tooltip
} from "recharts";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface BeaconEvent {
  id: number;
  created_at: string;
  student_id: string;
  school_id: string;
  platform: string;
  prompt: string;
  risk: string;
  blocked: boolean;
  matched: string[];
  hostname: string;
}

const COLORS = [
  "#013B93",
  "#10B981",
  "#F59E0B",
  "#DC2626",
  "#8B5CF6"
];

export default function Dashboard() {
  const [events, setEvents] = useState<BeaconEvent[]>([]);

  async function loadEvents() {
    const { data } = await supabase
      .from("beacon_events")
      .select("*")
      .order("created_at", { ascending: false });
    setEvents(data as BeaconEvent[] || []);
  }

  useEffect(() => {
    loadEvents();

    const channel = supabase
      .channel("beacon-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "beacon_events" },
        () => { loadEvents(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // KPI values
  const totalPrompts = events.length;
  const alerts = events.filter(e => e.risk !== "low").length;
  const blocked = events.filter(e => e.blocked).length;
  const wellbeing = Math.max(
    1,
    (10 - ((alerts / Math.max(totalPrompts, 1)) * 10))
  ).toFixed(1);

  // Chart data
  const riskData = [
    { name: "LOW",  value: events.filter(e => e.risk === "low").length },
    { name: "MED",  value: events.filter(e => e.risk === "medium").length },
    { name: "HIGH", value: events.filter(e => e.risk === "high").length },
  ];

  const platformMap: Record<string, number> = {};
  events.forEach(e => {
    const key = e.platform || "unknown";
    platformMap[key] = (platformMap[key] || 0) + 1;
  });
  const platformData = Object.entries(platformMap).map(([name, value]) => ({ name, value }));

  // Students of concern
  const studentMap = events.reduce((acc, e) => {
    if (!acc[e.student_id]) {
      acc[e.student_id] = { name: e.student_id, prompts: 0, score: 0, status: "Monitored" };
    }
    acc[e.student_id].prompts += 1;
    acc[e.student_id].score = Math.min(
      acc[e.student_id].score + (e.risk === "high" ? 20 : e.risk === "medium" ? 10 : 2),
      100
    );
    if (acc[e.student_id].score >= 75) acc[e.student_id].status = "Escalated";
    else if (acc[e.student_id].score >= 40) acc[e.student_id].status = "Review";
    return acc;
  }, {} as Record<string, { name: string; prompts: number; score: number; status: string }>);

  const students = Object.values(studentMap).sort((a, b) => b.score - a.score);

  return (
    <main className="min-h-screen bg-[#F3F4F6]">

      <Header loadEvents={loadEvents} />
      <MonitoringBanner />

      <KPIGrid
        totalPrompts={totalPrompts}
        alerts={alerts}
        blocked={blocked}
        wellbeing={wellbeing}
      />

      {/* Charts */}
      <div className="px-4 grid grid-cols-2 gap-5">

        <section className="bg-white rounded-3xl p-6 shadow-sm h-[340px]">
          <h2 className="text-3xl font-bold mb-6">Risk Trend</h2>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={riskData}>
              <Tooltip />
              <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                <Cell fill="#10B981" />
                <Cell fill="#F59E0B" />
                <Cell fill="#DC2626" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className="bg-white rounded-3xl p-6 shadow-sm h-[340px]">
          <h2 className="text-3xl font-bold mb-6">Platform Usage</h2>
          <div className="flex items-center justify-between h-[240px]">
            <div className="w-[55%] h-full">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={platformData} dataKey="value" outerRadius={90} label>
                    {platformData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3 text-lg">
              {platformData.map((p) => (
                <div key={p.name}>{p.name}: {p.value}</div>
              ))}
            </div>
          </div>
        </section>

      </div>

      {/* Events feed + Students */}
      <div className="p-4 grid grid-cols-[2fr_1fr] gap-5">

        <section className="bg-white rounded-3xl p-6 shadow-sm">
          <h2 className="text-3xl font-bold mb-6">Recent Safeguarding Events</h2>
          <div className="space-y-4 max-h-[700px] overflow-auto">
            {events.slice(0, 10).map((event) => (
              <div
                key={event.id}
                className={`
                  border-l-[6px] rounded-2xl p-5 bg-slate-50
                  ${event.risk === "high" ? "border-red-500"
                    : event.risk === "medium" ? "border-amber-500"
                    : "border-emerald-500"}
                `}
              >
                <div className="font-bold uppercase mb-2">{event.risk}</div>
                <div className="text-lg mb-4">{event.prompt}</div>
                <div className="text-sm text-slate-500">
                  Matched: {event.matched?.join(", ")}
                </div>
                <div className="text-sm text-slate-400 mt-2">
                  {new Date(event.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </section>

        <StudentProfiles students={students} />

      </div>

    </main>
  );
}
