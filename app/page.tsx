"use client";

import Header from "@/components/Header";
import MonitoringBanner from "@/components/MonitoringBanner";
import KPIGrid from "@/components/KPIGrid";
import StudentProfiles from "@/components/StudentProfiles";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const COLORS = ["#013B93", "#10B981", "#F59E0B", "#DC2626", "#8B5CF6"];

interface EventData {
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

export default function Page() {
  const [events, setEvents] = useState<EventData[]>([]);
  const [barData, setBarData] = useState([
    { name: "Low", count: 0 },
    { name: "Medium", count: 0 },
    { name: "High", count: 0 },
  ]);
  const [pieData, setPieData] = useState<{ name: string; value: number }[]>([]);

  useEffect(() => {
    const fetchEvents = async () => {
      const { data } = await supabase.from("beacon_events").select("*");
      if (data) setEvents(data as EventData[]);
    };
    fetchEvents();

    const subscription = supabase
      .from<EventData>("beacon_events")
      .on("INSERT", (payload) => {
        setEvents((prev) => [...prev, payload.new]);
      })
      .subscribe();

    return () => {
      supabase.removeSubscription(subscription);
    };
  }, []);

  useEffect(() => {
    const low = events.filter((e) => e.risk === "low").length;
    const medium = events.filter((e) => e.risk === "medium").length;
    const high = events.filter((e) => e.risk === "high").length;
    setBarData([
      { name: "Low", count: low },
      { name: "Medium", count: medium },
      { name: "High", count: high },
    ]);

    const platformCounts: Record<string, number> = {};
    events.forEach((e) => {
      platformCounts[e.platform] = (platformCounts[e.platform] || 0) + 1;
    });
    const pie = Object.keys(platformCounts).map((key) => ({
      name: key,
      value: platformCounts[key],
    }));
    setPieData(pie);
  }, [events]);

  return (
    <div>
      <Header />
      <MonitoringBanner />
      <KPIGrid
        totalPrompts={events.length}
        alerts={barData[2].count}
        blocked={events.filter((e) => e.blocked).length}
        wellbeing={6.3}
      />

      <div className="charts-container">
        <div className="bar-chart-wrapper">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={barData}>
              <Bar dataKey="count">
                {barData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index]} />
                ))}
              </Bar>
              <Tooltip />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="pie-chart-wrapper">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                outerRadius={100}
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <StudentProfiles events={events} />
    </div>
  );
}
