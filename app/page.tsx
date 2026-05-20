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
    // Fetch initial events
    supabase.from('beacon_events')
      .select('*')
      .then(({ data, error }) => {
        if (data) setEvents(data as BeaconEvent[]);
      });

    // Real-time subscription (Supabase v2 API)
    const subscription = supabase
      .channel('beacon_events_insert')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'beacon_events' },
        (payload) => {
          setEvents(prev => [...prev, payload.new as BeaconEvent]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  // Derive KPI values from events
  const totalPrompts = events.length;
  const alerts = events.filter(e => e.risk === 'high').length;
  const blocked = events.filter(e => e.blocked).length;

  // Derive students of concern from events
  const studentMap = events.reduce((acc, e) => {
    if (!acc[e.student_id]) {
      acc[e.student_id] = { name: e.student_id, prompts: 0, score: 0, status: 'Monitored' };
    }
    acc[e.student_id].prompts += 1;
    acc[e.student_id].score = Math.min(acc[e.student_id].score + (e.risk === 'high' ? 20 : e.risk === 'medium' ? 10 : 2), 100);
    if (acc[e.student_id].score >= 75) acc[e.student_id].status = 'Escalated';
    else if (acc[e.student_id].score >= 40) acc[e.student_id].status = 'Review';
    return acc;
  }, {} as Record<string, { name: string; prompts: number; score: number; status: string }>);

  const students = Object.values(studentMap).sort((a, b) => b.score - a.score);

  return (
    <div>
      <Header />
      <MonitoringBanner />
      <KPIGrid
        totalPrompts={totalPrompts}
        alerts={alerts}
        blocked={blocked}
        wellbeing={Math.max(0, 100 - alerts)}
      />
      <StudentProfiles students={students} />
    </div>
  );
}