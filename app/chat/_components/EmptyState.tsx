"use client";

import { useRef } from "react";
import { StarterPrompts } from "./StarterPrompts";
import { HeroComposer, type HeroComposerHandle } from "./HeroComposer";

export function EmptyState({
  displayName,
  onSend,
}: {
  displayName: string;
  onSend:      (text: string) => void;
}) {
  const firstName = displayName.split(" ")[0] || displayName;
  const composerRef = useRef<HeroComposerHandle>(null);

  return (
    <div className="flex flex-col items-center justify-center min-h-full py-10 px-4 w-full gap-8">
      <div className="text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-slate-800 mb-2">
          Hi {firstName}.
        </h1>
        <p className="text-base md:text-lg text-slate-500">
          What would you like to work on?
        </p>
      </div>

      <HeroComposer ref={composerRef} onSend={onSend} />

      <StarterPrompts
        onPickTemplate={(template) => composerRef.current?.applyTemplate(template)}
      />
    </div>
  );
}
