"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  LayoutDashboard,
  ShieldCheck,
  ShieldAlert,
  Activity,
  MessageSquare,
  BarChart3,
  Users,
  Bell,
  FileText,
  Settings,
  LogOut,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  icon:  LucideIcon;
  label: string;
  href:  string | null;
};

const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/"           },
  // Phase 5: Aegis = safeguarding event worklist. Order is
  // Dashboard → Aegis → Pulse → Atlas (broad → events → students →
  // policy). Atlas moved below Pulse to reflect that policy management
  // is a separate operational concern, not a daily-traffic tool.
  { icon: ShieldAlert,     label: "Aegis",     href: "/aegis-beta" },
  { icon: Activity,        label: "Pulse",     href: "/pulse"      },
  { icon: ShieldCheck,     label: "Atlas",     href: "/atlas"      },
  { icon: MessageSquare,   label: "Horizon",   href: "/horizon"    },
  { icon: BarChart3,       label: "Reports",   href: null          },
  { icon: Users,           label: "Students",  href: null          },
  { icon: Bell,            label: "Alerts",    href: null          },
  { icon: FileText,        label: "Logs",      href: null          },
  { icon: Settings,        label: "Settings",  href: null          },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <aside className="w-[68px] min-h-screen bg-white border-r border-slate-200 flex flex-col items-center py-5 shrink-0">

      {/* Logo */}
      <Link href="/" className="w-10 h-10 flex items-center justify-center mb-6 group" title="Beacon Insight">
        <Image
          src="/insight_icon.png"
          alt="Beacon Insight"
          width={32}
          height={32}
          className="object-contain transition-transform group-hover:scale-105"
        />
      </Link>

      {/* Nav items */}
      <nav className="flex flex-col items-center gap-1.5">
        {NAV_ITEMS.map((item) => {
          const Icon   = item.icon;
          const active = item.href ? pathname === item.href : false;
          const isDisabled = item.href === null;

          const base = "relative w-10 h-10 rounded-xl flex items-center justify-center transition-all";
          const state = active
            ? "bg-cyan-50 text-[#06B6D4]"
            : isDisabled
              ? "text-slate-300 cursor-not-allowed"
              : "text-slate-400 hover:text-slate-700 hover:bg-slate-50";

          const inner = (
            <>
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[#06B6D4]" />
              )}
              <Icon size={20} strokeWidth={1.75} />
            </>
          );

          if (item.href) {
            return (
              <Link key={item.label} href={item.href} title={item.label} className={`${base} ${state}`}>
                {inner}
              </Link>
            );
          }

          return (
            <button key={item.label} title={item.label} className={`${base} ${state}`} disabled>
              {inner}
            </button>
          );
        })}
      </nav>

      {/* Sign out — pinned to bottom */}
      <button
        onClick={handleSignOut}
        title="Sign out"
        className="mt-auto w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
      >
        <LogOut size={20} strokeWidth={1.75} />
      </button>

    </aside>
  );
}
