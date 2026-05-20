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

  useEffect(() => {
    // Fetch initial events
    supabase.from<EventData>('beacon_events').select('*').then(({ data }) => {
      if (data) setEvents(data);
    });

    // Subscribe to new events
    const subscription = supabase
      .from<EventData, EventData>('beacon_events')
      .on('INSERT', (payload) => {
        setEvents((prev) => [...prev, payload.new]);
      })
      .subscribe();

    return () => {
      supabase.removeSubscription(subscription);
    };
  }, []);

  return (
    <div>
      <Header />
      <MonitoringBanner />
      <KPIGrid events={events} />
      <StudentProfiles events={events} />
      {/* Charts, tables, and other UI components using events */}
    </div>
  );
}
