"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const SCHOOL_CODE  = "beacon2026";
const BEACON_BLUE  = "#013B93";

export default function HorizonLoginPage() {
  const router = useRouter();
  const [name,    setName]    = useState("");
  const [code,    setCode]    = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!name.trim()) { setError("Please enter your name"); return; }
    if (code.trim().toLowerCase() !== SCHOOL_CODE) {
      setError("Invalid school access code. Please ask your teacher.");
      return;
    }

    setLoading(true);
    const studentId = name.trim().toLowerCase().replace(/\s+/g, ".");
    sessionStorage.setItem("beaconChat_studentId",   studentId);
    sessionStorage.setItem("beaconChat_displayName", name.trim());
    sessionStorage.setItem("beaconChat_schoolId",    "beacon-academy");
    router.push("/horizon");
  }

  return (
    <div className="min-h-screen bg-[#F4F7FC] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">

        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3 shadow-sm" style={{ backgroundColor: BEACON_BLUE }}>
            <Image src="/insight_icon.png" alt="Horizon" width={28} height={28} className="object-contain invert brightness-0 opacity-90" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: BEACON_BLUE }}>Horizon</h1>
          <p className="text-sm text-slate-500 mt-1">Your safe AI workspace, powered by Beacon</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
          <h2 className="text-lg font-bold text-slate-800 mb-1">Sign in</h2>
          <p className="text-sm text-slate-500 mb-6">Enter your name and your school's access code.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Your name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. James Smith"
                autoFocus
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#013B93]/20 focus:border-[#013B93]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1.5 block">School access code</label>
              <input
                type="password"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="Ask your teacher for this"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#013B93]/20 focus:border-[#013B93]"
              />
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full text-white font-semibold py-2.5 rounded-xl hover:opacity-95 disabled:opacity-40 transition-all text-sm"
              style={{ backgroundColor: BEACON_BLUE }}
            >
              {loading ? "Signing in…" : "Enter Horizon"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          All activity is monitored by Beacon Insight for safeguarding purposes.
        </p>
      </div>
    </div>
  );
}
