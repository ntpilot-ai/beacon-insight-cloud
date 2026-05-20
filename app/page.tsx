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

const COLORS = [
  "#013B93",
  "#10B981",
  "#F59E0B",
  "#DC2626",
  "#8B5CF6",
];

type BeaconEvent = {
  id?: number;
  created_at: string;
  student_id?: string;
  school_id?: string;
  platform: string;
  prompt: string;
  risk: string;
  blocked: boolean;
  matched: string[];
  hostname: string;
};

export default function Page() {
  const [events, setEvents] = useState<BeaconEvent[]>([]);

  useEffect(() => {
    // Fetch initial events
    supabase
      .from<BeaconEvent>("beacon_events")
      .select("*")
      .then(({ data, error }) => {
        if (data) setEvents(data);
        if (error) console.error(error);
      });

    // Subscribe to new inserts
    const subscription = supabase
      .channel("public:beacon_events")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "beacon_events" }, (payload) => {
        setEvents((prev) => [...prev, payload.new]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  return (
    <div>
      <Header />
      <MonitoringBanner />
      <KPIGrid events={events} />
      <StudentProfiles events={events} />
      {/* Charts and other UI can remain as before */}
    </div>
  );
}