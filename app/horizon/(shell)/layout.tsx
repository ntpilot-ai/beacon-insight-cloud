"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { HorizonModeProvider } from "../_lib/HorizonModeContext";
import { NavRail } from "../_components/NavRail";
import { TopBar } from "../_components/TopBar";

function surfaceTitle(pathname: string): string {
  if (pathname.startsWith("/horizon/chat"))   return "Chat";
  if (pathname.startsWith("/horizon/notes"))  return "Notes";
  if (pathname === "/horizon")                return "Home";
  return "Horizon";
}

export default function ShellLayout({ children }: { children: ReactNode }) {
  const router      = useRouter();
  const pathname    = usePathname();
  const [ready,       setReady]       = useState(false);
  const [navOpen,     setNavOpen]     = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [schoolName,  setSchoolName]  = useState("Beacon Academy");

  useEffect(() => {
    const sid  = sessionStorage.getItem("beaconChat_studentId");
    const name = sessionStorage.getItem("beaconChat_displayName");

    if (!sid) {
      router.replace("/horizon/login");
      return;
    }

    setDisplayName(name || sid);
    setSchoolName(process.env.NEXT_PUBLIC_SCHOOL_NAME || "Beacon Academy");
    setReady(true);
  }, [router]);

  function signOut() {
    sessionStorage.clear();
    router.replace("/horizon/login");
  }

  if (!ready) {
    return <div className="h-screen w-screen bg-[#F4F7FC]" />;
  }

  return (
    <HorizonModeProvider>
      <div className="flex h-screen bg-[#F4F7FC]">
        <NavRail open={navOpen} onClose={() => setNavOpen(false)} />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            surfaceTitle={surfaceTitle(pathname)}
            displayName={displayName}
            schoolName={schoolName}
            onToggleNav={() => setNavOpen(true)}
            onSignOut={signOut}
          />
          <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {children}
          </main>
        </div>
      </div>
    </HorizonModeProvider>
  );
}
