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

  useEffect(() => {
    // Fetch initial events with correct two-parameter signature for Supabase v2
    supabase.from<BeaconEvent, BeaconEvent>('beacon_events')
      .select('*')
      .then(({ data, error }) => {
        if (data) setEvents(data);
      });

    // Real-time subscription
    const subscription = supabase.from<BeaconEvent, BeaconEvent>('beacon_events')
      .on('INSERT', payload => {
        setEvents(prev => [...prev, payload.new]);
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
    </div>
  );
}