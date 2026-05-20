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

export default function Page() {
  const [events, setEvents] = useState<BeaconEvent[]>([]);

  useEffect(() => {
    // Fetch initial events
    const fetchEvents = async () => {
      const { data, error } = await supabase.from<BeaconEvent>('beacon_events').select('*');
      if (data) setEvents(data);
    };

    fetchEvents();

    // Real-time subscription
    const subscription = supabase
      .channel('public:beacon_events')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'beacon_events' }, (payload) => {
        setEvents((prev) => [payload.new as BeaconEvent, ...prev]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  return (
    <>
      <Header />
      <MonitoringBanner />
      <KPIGrid events={events} />
      <StudentProfiles students={events} />
      {/* Charts can also be passed events */}
    </>
  );
}
