"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { HorizonMode } from "./types";

interface ModeCtx {
  mode:    HorizonMode;
  setMode: (m: HorizonMode) => void;
  toggle:  () => void;
}

const Ctx = createContext<ModeCtx | null>(null);
const STORAGE_KEY = "horizon_mode";
const DEFAULT_MODE: HorizonMode = "guided";

export function HorizonModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<HorizonMode>(DEFAULT_MODE);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as HorizonMode | null;
      if (stored === "guided" || stored === "full") setModeState(stored);
    } catch {}
  }, []);

  function setMode(m: HorizonMode) {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch {}
  }

  function toggle() {
    setMode(mode === "guided" ? "full" : "guided");
  }

  return <Ctx.Provider value={{ mode, setMode, toggle }}>{children}</Ctx.Provider>;
}

export function useHorizonMode(): ModeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHorizonMode must be used inside HorizonModeProvider");
  return v;
}
