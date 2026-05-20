"use client";

import { useEffect, useState }
from "react";

import { supabase }
from "@/lib/supabase";

export default function Home() {

  const [events, setEvents] =
    useState<any[]>([]);

  useEffect(() => {

    loadEvents();

  }, []);

  async function loadEvents() {

    const { data } =
      await supabase
        .from("beacon_events")
        .select("*")
        .order(
          "created_at",
          { ascending:false }
        );

    setEvents(data || []);

  }

  return (

    <main className="
      min-h-screen
      bg-slate-100
      p-8
    ">

      <h1 className="
        text-4xl
        font-bold
        text-blue-900
        mb-8
      ">
        Beacon Insight Cloud
      </h1>

      <div className="
        grid
        gap-4
      ">

        {events.map((event) => (

          <div
            key={event.id}
            className="
              bg-white
              rounded-2xl
              p-6
              shadow
            "
          >

            <div className="
              text-sm
              text-slate-500
              mb-2
            ">
              {new Date(
                event.created_at
              ).toLocaleString()}
            </div>

            <div className="
              font-semibold
              text-lg
            ">
              {event.prompt}
            </div>

            <div className="
              mt-2
              text-sm
            ">
              Risk:
              <span className="
                font-bold
                ml-2
              ">
                {event.risk}
              </span>
            </div>

            <div className="
              mt-2
              text-sm
              text-slate-500
            ">
              Platform:
              {event.platform}
            </div>

          </div>

        ))}

      </div>

    </main>

  );

}