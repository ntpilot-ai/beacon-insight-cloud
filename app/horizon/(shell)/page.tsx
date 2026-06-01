"use client";

import { useEffect, useState } from "react";
import { useHorizonMode } from "../_lib/HorizonModeContext";
import { HORIZON_MODE_COPY } from "../_lib/types";
import { AskHorizonCTA } from "../_components/AskHorizonCTA";
import { RecentChats } from "../_components/RecentChats";
import { RecentNotes } from "../_components/RecentNotes";

const BEACON_BLUE = "#013B93";

function timeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

export default function HorizonHome() {
  const { mode } = useHorizonMode();
  const [firstName, setFirstName] = useState("");
  const [studentId, setStudentId] = useState("");

  useEffect(() => {
    const name = sessionStorage.getItem("beaconChat_displayName") || "";
    const sid  = sessionStorage.getItem("beaconChat_studentId")   || "";
    setFirstName(name.split(" ")[0] || name || "");
    setStudentId(sid);
  }, []);

  const modeCopy = HORIZON_MODE_COPY[mode];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-7">

        {/* Greeting + mode badge */}
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 md:px-6 py-5 md:py-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-slate-800">
                Good {timeOfDay()}{firstName ? `, ${firstName}` : ""}.
              </h1>
              <p className="text-sm text-slate-500 mt-1.5 max-w-xl">
                Welcome to Horizon — your safe AI workspace for school.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs bg-[#E6EDF8] text-[#013B93] border border-[#C6D4ED] px-3 py-1.5 rounded-full font-semibold">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: BEACON_BLUE }} />
              Currently in {modeCopy.label} mode
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3 leading-snug">{modeCopy.explainer}</p>
        </section>

        <AskHorizonCTA />

        <RecentChats studentId={studentId} />

        <RecentNotes />

        {/* Roadmap teases */}
        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Coming soon</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: "Tasks",          desc: "Your own homework and revision to-dos, in one place." },
              { label: "Study planner",  desc: "Break revision down into sessions that fit your week." },
              { label: "Projects",       desc: "Long-form work organised into chapters and sources." },
            ].map(c => (
              <div key={c.label} className="bg-white border border-dashed border-slate-200 rounded-2xl px-4 py-4 opacity-75">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-slate-700">{c.label}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">Soon</span>
                </div>
                <p className="text-xs text-slate-500 leading-snug">{c.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
