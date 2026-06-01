"use client";

import Link from "next/link";
import { BEACON_BLUE } from "../_lib/flags";

interface BaseStarter {
  icon:  string;
  title: string;
  hint:  string;
}

interface TemplateStarter extends BaseStarter {
  kind:     "template";
  template: string;             // contains a [placeholder] that gets selected
}

interface RouteStarter extends BaseStarter {
  kind: "route";
  href: string;
}

type Starter = TemplateStarter | RouteStarter;

const STARTERS: Starter[] = [
  {
    kind:     "template",
    icon:     "📖",
    title:    "Explain a topic",
    hint:     "Get a clear walk-through",
    template: "Explain [the topic you want] to me, starting with the basics.",
  },
  {
    kind:     "template",
    icon:     "✏️",
    title:    "Help me write",
    hint:     "Plan, draft or improve a piece of writing",
    template: "Help me write [what you want to write — e.g. an essay about World War One].",
  },
  {
    kind:     "template",
    icon:     "🧠",
    title:    "Walk me through a problem",
    hint:     "Step-by-step working, not just the answer",
    template: "Help me walk through [the problem you're stuck on] step by step instead of giving me the answer.",
  },
  {
    kind:  "route",
    icon:  "✅",
    title: "Quiz me",
    hint:  "Pick a topic — Horizon will test you on it",
    href:  "/horizon/chat/quiz",
  },
];

export function StarterPrompts({ onPickTemplate }: { onPickTemplate: (template: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full max-w-3xl mx-auto">
      {STARTERS.map((s) => {
        const inner = (
          <div className="flex items-start gap-2.5">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-base"
              style={{ backgroundColor: "#E6EDF8", color: BEACON_BLUE }}
            >
              <span>{s.icon}</span>
            </div>
            <div className="min-w-0 text-left">
              <div className="font-semibold text-sm text-slate-800 group-hover:text-[#013B93] transition-colors leading-tight">
                {s.title}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 leading-snug">{s.hint}</div>
            </div>
          </div>
        );

        const className =
          "group text-left bg-white border border-slate-200 hover:border-[#013B93] hover:shadow-sm transition-all rounded-2xl px-3.5 py-3 block";

        if (s.kind === "template") {
          return (
            <button key={s.title} onClick={() => onPickTemplate(s.template)} className={className}>
              {inner}
            </button>
          );
        }

        return (
          <Link key={s.title} href={s.href} className={className}>
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
