"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const NAV_ITEMS = [
  { icon: "⌂",  label: "Dashboard", href: "/"      },
  { icon: "🛡",  label: "Atlas",     href: "/atlas" },
  { icon: "📊",  label: "Reports",   href: null     },
  { icon: "👤",  label: "Students",  href: null     },
  { icon: "🔔",  label: "Alerts",    href: null     },
  { icon: "📋",  label: "Logs",      href: null     },
  { icon: "⚙",  label: "Settings",  href: null     },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <aside className="w-16 min-h-screen bg-[#013B93] flex flex-col items-center py-4 gap-1 shrink-0">

      {/* Logo */}
      <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center mb-4">
        <span className="text-white text-lg font-bold">B</span>
      </div>

      {/* Nav items */}
      {NAV_ITEMS.map((item) => {
        const active = item.href ? pathname === item.href : false;
        const cls = `
          w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all
          ${active
            ? "bg-white/20 text-white"
            : "text-white/40 hover:text-white/80 hover:bg-white/10"}
        `;

        if (item.href) {
          return (
            <Link key={item.label} href={item.href} title={item.label} className={cls}>
              {item.icon}
            </Link>
          );
        }

        return (
          <button key={item.label} title={item.label} className={cls} disabled>
            {item.icon}
          </button>
        );
      })}

      {/* Sign out — pinned to bottom */}
      <div className="mt-auto">
        <button
          onClick={handleSignOut}
          title="Sign out"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-lg text-white/40 hover:text-white/80 hover:bg-white/10 transition-all"
        >
          ⏻
        </button>
      </div>

    </aside>
  );
}
