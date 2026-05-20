"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Tooltip
} from "recharts";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const COLORS = [
  "#013B93",
  "#10B981",
  "#F59E0B",
  "#DC2626",
  "#8B5CF6"
];

export default function Home() {

  const [events, setEvents] =
    useState<any[]>([]);

  useEffect(() => {

    loadEvents();

  }, []);

  async function loadEvents() {

    const { data } =
      await supabase
        .from("beacon_events")
        .select("*")
        .order(
          "created_at",
          { ascending:false }
        );

    setEvents(data || []);

  }

  const totalPrompts =
    events.length;

  const alerts =
    events.filter(
      e => e.risk !== "low"
    ).length;

  const blocked =
    events.filter(
      e => e.blocked
    ).length;

  const wellbeing =
    Math.max(
      1,
      (
        10 -
        ((alerts / Math.max(totalPrompts,1)) * 10)
      )
    ).toFixed(1);

  const riskData = [

    {
      name:"LOW",
      value:events.filter(
        e => e.risk === "low"
      ).length
    },

    {
      name:"MED",
      value:events.filter(
        e => e.risk === "medium"
      ).length
    },

    {
      name:"HIGH",
      value:events.filter(
        e => e.risk === "high"
      ).length
    }

  ];

  const platformMap:any = {};

  events.forEach(event => {

    const key =
      event.platform || "unknown";

    platformMap[key] =
      (platformMap[key] || 0) + 1;

  });

  const platformData =
    Object.entries(platformMap)
      .map(([name,value]) => ({
        name,
        value
      }));

  const students = [
    {
      name:"Student-858",
      score:45
    },
    {
      name:"Student-481",
      score:45
    },
    {
      name:"Student-450",
      score:40
    }
  ];

  return (

    <main className="min-h-screen bg-[#F3F4F6]">

      <header className="bg-[#013B93] text-white px-8 py-6 flex items-center justify-between">

        <div>

          <h1 className="text-5xl font-bold">
            Beacon Insight
          </h1>

          <p className="mt-2 text-sm opacity-90">
            Operational safeguarding intelligence dashboard
          </p>

        </div>

        <button
          onClick={loadEvents}
          className="font-semibold"
        >
          Refresh
        </button>

      </header>

      <div className="p-4 grid grid-cols-4 gap-5">

        <Card
          title="Prompts Detected"
          value={totalPrompts}
          colour="#013B93"
        />

        <Card
          title="Alerts"
          value={alerts}
          colour="#F59E0B"
        />

        <Card
          title="Blocked"
          value={blocked}
          colour="#DC2626"
        />

        <Card
          title="Wellbeing"
          value={wellbeing}
          colour="#10B981"
        />

      </div>

      <div className="px-4 grid grid-cols-2 gap-5">

        <section className="bg-white rounded-3xl p-6 shadow-sm h-[340px]">

          <h2 className="text-3xl font-bold mb-6">
            Risk Trend
          </h2>

          <ResponsiveContainer
            width="100%"
            height="85%"
          >

            <BarChart data={riskData}>

              <Tooltip />

              <Bar
                dataKey="value"
                radius={[10,10,0,0]}
              >

                <Cell fill="#10B981" />
                <Cell fill="#F59E0B" />
                <Cell fill="#DC2626" />

              </Bar>

            </BarChart>

          </ResponsiveContainer>

        </section>

        <section className="bg-white rounded-3xl p-6 shadow-sm h-[340px]">

          <h2 className="text-3xl font-bold mb-6">
            Platform Usage
          </h2>

          <div className="flex items-center justify-between h-[240px]">

            <div className="w-[55%] h-full">

              <ResponsiveContainer>

                <PieChart>

                  <Pie
                    data={platformData}
                    dataKey="value"
                    outerRadius={90}
                    label
                  >

                    {platformData.map((_, index) => (

                      <Cell
                        key={index}
                        fill={
                          COLORS[
                            index % COLORS.length
                          ]
                        }
                      />

                    ))}

                  </Pie>

                  <Tooltip />

                </PieChart>

              </ResponsiveContainer>

            </div>

            <div className="space-y-3 text-lg">

              {platformData.map((p:any) => (

                <div key={p.name}>
                  {p.name}: {p.value}
                </div>

              ))}

            </div>

          </div>

        </section>

      </div>

      <div className="p-4 grid grid-cols-[2fr_1fr] gap-5">

        <section className="bg-white rounded-3xl p-6 shadow-sm">

          <h2 className="text-3xl font-bold mb-6">
            Recent Safeguarding Events
          </h2>

          <div className="space-y-4 max-h-[700px] overflow-auto">

            {events.slice(0,10).map((event) => (

              <div
                key={event.id}
                className={`
                  border-l-[6px]
                  rounded-2xl
                  p-5
                  bg-slate-50
                  ${
                    event.risk === "high"
                    ? "border-red-500"
                    : event.risk === "medium"
                    ? "border-amber-500"
                    : "border-emerald-500"
                  }
                `}
              >

                <div className="font-bold uppercase mb-2">
                  {event.risk}
                </div>

                <div className="text-lg mb-4">
                  {event.prompt}
                </div>

                <div className="text-sm text-slate-500">
                  Matched:
                  {
                    event.matched?.join(", ")
                  }
                </div>

                <div className="text-sm text-slate-400 mt-2">
                  {
                    new Date(
                      event.created_at
                    ).toLocaleString()
                  }
                </div>

              </div>

            ))}

          </div>

        </section>

        <section className="bg-white rounded-3xl p-6 shadow-sm">

          <h2 className="text-3xl font-bold mb-6">
            Students of Concern
          </h2>

          <div className="space-y-4">

            {students.map(student => (

              <div
                key={student.name}
                className="bg-slate-50 rounded-2xl p-5"
              >

                <div className="font-semibold text-lg">
                  {student.name}
                </div>

                <div className="mt-2 text-[#013B93] font-semibold">
                  Behaviour Score: {student.score}
                </div>

              </div>

            ))}

          </div>

        </section>

      </div>

    </main>

  );

}

function Card({
  title,
  value,
  colour
}:any) {

  return (

    <div className="bg-white rounded-3xl p-6 shadow-sm h-[140px] flex flex-col justify-center">

      <div className="text-slate-500 text-lg mb-2">
        {title}
      </div>

      <div
        className="text-6xl font-bold"
        style={{ color:colour }}
      >
        {value}
      </div>

    </div>

  );

}
