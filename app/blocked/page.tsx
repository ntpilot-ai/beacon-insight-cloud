"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Image from "next/image";

function BlockedContent() {
  const params  = useSearchParams();
  const title   = params.get("title")   || "AI Access Restricted";
  const message = params.get("message") || "Access to AI tools is currently restricted by your school.";
  const school  = params.get("school")  || "Your School";
  const until   = params.get("until");

  return (
    <div className="min-h-screen bg-[#F0F2F8] flex flex-col items-center justify-center p-8">
      <div className="max-w-md w-full text-center">

        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <Image src="/insight_icon.png" alt="Beacon" width={40} height={40} className="object-contain" />
          <span className="text-xl font-bold text-[#06B6D4]">Beacon Insight</span>
        </div>

        {/* Block card */}
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-10">

          {/* Icon */}
          <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-6">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#DC2626" strokeWidth="2"/>
              <path d="M4.93 4.93l14.14 14.14" stroke="#DC2626" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-slate-800 mb-3">{title}</h1>

          <p className="text-slate-500 leading-relaxed mb-6">{message}</p>

          {until && (
            <div className="bg-slate-50 rounded-xl px-4 py-3 mb-6">
              <p className="text-sm text-slate-400">
                Access will be restored at{" "}
                <span className="font-semibold text-slate-600">
                  {new Date(until).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </p>
            </div>
          )}

          <div className="text-xs text-slate-300 mt-4">
            {school} · Managed by Beacon Insight
          </div>
        </div>

        <p className="text-xs text-slate-400 mt-6">
          If you believe this is an error, please speak to your teacher.
        </p>
      </div>
    </div>
  );
}

export default function BlockedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F0F2F8]" />}>
      <BlockedContent />
    </Suspense>
  );
}
