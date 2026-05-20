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
import { supabase, Database } from "@/lib/supabase";

const COLORS = [
  "#013B93",
  "#10B981",
  "#F59E0B",
  "#DC2626",
  "#8B5CF6",
];

export default function Page() {
  const [events, setEvents] = useState<Database['public']['Tables']['beacon_events']['Row'][]>([]);

  useEffect(() => {
    // Fetch initial events
    supabase
      .from<Database['public']['Tables']['beacon_events']['Row'], 'public'>("beacon_events")
      .select("*")
      .then(({ data }) => {
        if (data) setEvents(data);
      });

    // Subscribe to live events
    const subscription = supabase
      .channel('table-db-changes')
      .on<Database['public']['Tables']['beacon_events']['Row']>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'beacon_events' },
        (payload) => {
          setEvents((prev) => [...prev, payload.new]);
        }
      )
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
      <StudentProfiles events={events} />
      {/* Charts and other components using events */}
    </>
  );
}