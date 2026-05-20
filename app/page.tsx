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

// Define the row type and insert type for Supabase v2
export interface BeaconEventRow {
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

export type BeaconEventInsert = Omit<BeaconEventRow, 'id' | 'created_at'>;

export default function InsightPage() {
  const [events, setEvents] = useState<BeaconEventRow[]>([]);

  useEffect(() => {
    // Fetch initial events
    const fetchEvents = async () => {
      const { data, error } = await supabase
        .from<BeaconEventRow, BeaconEventInsert>('beacon_events')
        .select('*');
      if (data) setEvents(data);
    };
    fetchEvents();

    // Subscribe to new events
    const subscription = supabase
      .from<BeaconEventRow, BeaconEventInsert>('beacon_events')
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
      <StudentProfiles students={events} />
      {/* Charts and other components go here */}
    </div>
  );
}
