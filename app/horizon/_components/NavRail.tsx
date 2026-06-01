"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const ITEMS: { href: string; label: string; icon: string; available: boolean }[] = [
  { href: "/horizon",       label: "Home",  icon: "home",  available: true  },
  { href: "/horizon/chat",  label: "Chat",  icon: "chat",  available: true  },
  { href: "/horizon/notes", label: "Notes", icon: "notes", available: true  },
  { href: "#tasks",         label: "Tasks", icon: "tasks", available: false },
  { href: "#planner",       label: "Study planner", icon: "planner", available: false },
  { href: "#projects",      label: "Projects", icon: "projects", available: false },
];

function Icon({ name }: { name: string }) {
  const stroke = "currentColor";
  const props = { stroke, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  switch (name) {
    case "home":
      return <svg width="20" height="20" viewBox="0 0 24 24" {...props}><path d="M3 11L12 3L21 11M5 10V20H9V14H15V20H19V10" /></svg>;
    case "chat":
      return <svg width="20" height="20" viewBox="0 0 24 24" {...props}><path d="M21 12C21 16.5 16.97 20 12 20C10.5 20 9.07 19.7 7.83 19.16L3 20L4.16 16.07C3.42 14.85 3 13.46 3 12C3 7.5 7.03 4 12 4C16.97 4 21 7.5 21 12Z" /></svg>;
    case "notes":
      return <svg width="20" height="20" viewBox="0 0 24 24" {...props}><path d="M6 4H16L20 8V20C20 20.5 19.5 21 19 21H6C5.5 21 5 20.5 5 20V5C5 4.5 5.5 4 6 4Z M15 4V8H20 M8 12H16 M8 16H14" /></svg>;
    case "tasks":
      return <svg width="20" height="20" viewBox="0 0 24 24" {...props}><path d="M9 5H19 M9 12H19 M9 19H19 M5 5L5.01 5 M5 12L5.01 12 M5 19L5.01 19" /></svg>;
    case "planner":
      return <svg width="20" height="20" viewBox="0 0 24 24" {...props}><path d="M5 5H19V19H5Z M5 9H19 M9 5V3 M15 5V3 M9 13H10 M14 13H15 M9 17H10 M14 17H15" /></svg>;
    case "projects":
      return <svg width="20" height="20" viewBox="0 0 24 24" {...props}><path d="M4 7L4 19C4 19.5 4.5 20 5 20L19 20C19.5 20 20 19.5 20 19V9C20 8.5 19.5 8 19 8H12L10 6H5C4.5 6 4 6.5 4 7Z" /></svg>;
    default: return null;
  }
}

export function NavRail({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/horizon" ? pathname === "/horizon" : pathname.startsWith(href);

  const body = (
    <div className="h-full w-60 bg-[#013B93] text-white flex flex-col">
      <div className="px-4 py-4 flex items-center justify-between gap-2 border-b border-white/10">
        <Link href="/horizon" onClick={onClose} className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <Image src="/insight_icon.png" alt="Horizon" width={20} height={20} className="object-contain invert brightness-0" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-base truncate">Horizon</div>
            <div className="text-[10px] text-white/70 truncate">Powered by Beacon</div>
          </div>
        </Link>
        <button
          onClick={onClose}
          className="md:hidden w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/70 shrink-0"
          aria-label="Close menu"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {ITEMS.map(item => {
          const active = item.available && isActive(item.href);
          const cls = `flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm transition-colors ${
            active
              ? "bg-white/20 text-white font-semibold"
              : item.available
                ? "text-white/85 hover:bg-white/10 hover:text-white"
                : "text-white/40 cursor-not-allowed"
          }`;

          if (!item.available) {
            return (
              <div key={item.label} className={cls} title="Coming soon">
                <Icon name={item.icon} />
                <span className="flex-1">{item.label}</span>
                <span className="text-[9px] uppercase tracking-wide bg-white/10 px-1.5 py-0.5 rounded">Soon</span>
              </div>
            );
          }

          return (
            <Link key={item.label} href={item.href} onClick={onClose} className={cls}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-white/10 text-[10px] text-white/55">
        All activity is monitored by Beacon Insight for safeguarding purposes.
      </div>
    </div>
  );

  return (
    <>
      <div
        className={`md:hidden fixed inset-0 bg-slate-900/40 z-30 transition-opacity ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`md:hidden fixed top-0 left-0 bottom-0 z-40 transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {body}
      </aside>
      <aside className="hidden md:block shrink-0 h-full">
        {body}
      </aside>
    </>
  );
}
