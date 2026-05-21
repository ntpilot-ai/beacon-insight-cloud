"use client";

import { useState } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [mode, setMode]         = useState<"login" | "magic">("login");
  const [sent, setSent]         = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      // Hard navigate so the session cookie is picked up by proxy.ts
      window.location.href = "/";
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/` }
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSent(true);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F0F2F8] flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        <div className="flex items-center gap-3 justify-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-[#06B6D4] flex items-center justify-center overflow-hidden p-1.5">
            <Image src="/insight_icon.png" alt="Beacon Insight" width={44} height={44} className="object-contain" />
          </div>
          <div>
            <div className="text-2xl font-bold text-[#06B6D4]">Beacon Insight</div>
            <div className="text-xs text-slate-400">Safeguarding intelligence platform</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
          <h1 className="text-lg font-bold text-slate-800 mb-1">Sign in</h1>
          <p className="text-sm text-slate-400 mb-6">
            Access is restricted to authorised school staff.
          </p>

          {sent ? (
            <div className="text-center py-4">
              <div className="text-3xl mb-3">📧</div>
              <p className="font-semibold text-slate-700">Check your email</p>
              <p className="text-sm text-slate-400 mt-1">
                We sent a sign-in link to <strong>{email}</strong>
              </p>
            </div>
          ) : (
            <form onSubmit={mode === "login" ? handleLogin : handleMagicLink} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1 block">
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@school.ac.uk"
                  required
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20"
                />
              </div>

              {mode === "login" && (
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20"
                  />
                </div>
              )}

              {error && (
                <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#06B6D4] text-white font-semibold py-2.5 rounded-xl hover:bg-[#012d70] disabled:opacity-40 transition-all text-sm"
              >
                {loading ? "Signing in..." : mode === "login" ? "Sign in" : "Send magic link"}
              </button>

              <button
                type="button"
                onClick={() => { setMode(mode === "login" ? "magic" : "login"); setError(""); }}
                className="w-full text-xs text-slate-400 hover:text-[#06B6D4] transition-colors py-1"
              >
                {mode === "login" ? "Sign in with magic link instead" : "Sign in with password instead"}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          Beacon Insight · School safeguarding platform
        </p>
      </div>
    </div>
  );
}
