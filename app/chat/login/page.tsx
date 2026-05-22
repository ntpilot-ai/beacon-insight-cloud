"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function ChatLoginPage() {
  const router = useRouter();
  const [name, setName]       = useState("");
  const [code, setCode]       = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  // For MVP: simple school code validates entry
  // In production this would be SSO/OAuth
  const SCHOOL_CODE = "beacon2026";

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!name.trim()) { setError("Please enter your name"); return; }
    if (code.trim().toLowerCase() !== SCHOOL_CODE) {
      setError("Invalid school access code. Please ask your teacher.");
      return;
    }

    setLoading(true);
    // Store student identity in sessionStorage for the chat session
    const studentId = name.trim().toLowerCase().replace(/\s+/g, ".");
    sessionStorage.setItem("beaconChat_studentId", studentId);
    sessionStorage.setItem("beaconChat_displayName", name.trim());
    sessionStorage.setItem("beaconChat_schoolId", "beacon-academy");
    router.push("/chat");
  }

  return (
    <div className="min-h-screen bg-[#F0F2F8] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <Image src="/insight_icon.png" alt="Beacon" width={48} height={48} className="object-contain mb-3" />
          <h1 className="text-2xl font-bold text-[#06B6D4]">BeaconChat</h1>
          <p className="text-sm text-slate-400 mt-1">Safe AI for schools</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
          <h2 className="text-lg font-bold text-slate-800 mb-1">Sign in to BeaconChat</h2>
          <p className="text-sm text-slate-400 mb-6">Enter your name and your school's access code.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Your name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. James Smith"
                autoFocus
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1.5 block">School access code</label>
              <input
                type="password"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="Ask your teacher for this"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20"
              />
            </div>

            {error && (
              <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#06B6D4] text-white font-semibold py-2.5 rounded-xl hover:bg-[#0891b2] disabled:opacity-40 transition-all text-sm"
            >
              {loading ? "Signing in..." : "Start chatting"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          All conversations are monitored for safeguarding purposes.
        </p>
      </div>
    </div>
  );
}
