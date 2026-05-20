// Updated page.tsx with correct Supabase usage and real-time subscription

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

export default function Page() {
  const [events, setEvents] = useState<BeaconEvent[]>([]);

  useEffect(() => {
    // Fetch initial events with correct two-parameter signature
    supabase.from<BeaconEvent>('beacon_events').select('*').then(({ data, error }) => {
      if (data) setEvents(data);
    });

    // Subscribe to new events in real-time
    const subscription = supabase.from<BeaconEvent>('beacon_events')
      .on('INSERT', payload => {
        setEvents(prev => [...prev, payload.new]);
      })
      .subscribe();

    return () => {
      supabase.removeSubscription(subscription);
    };
  }, []);

  return (
    <>
      <Header />
      <MonitoringBanner />
      <KPIGrid events={events} />
      <StudentProfiles events={events} />
      {/* Charts and other UI can go here */}
    </>
  );
}