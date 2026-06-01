"use client";

import { useEffect, useRef } from "react";
import type { Message } from "../_lib/types";
import { MessageBubble, TypingIndicator } from "./MessageBubble";
import { EmptyState } from "./EmptyState";

export function Conversation({
  messages,
  initial,
  displayName,
  loading,
  loadingSession,
  onSend,
  onSaveToNotes,
  headerSlot,
  afterMessagesSlot,
  emptyState,
}: {
  messages:           Message[];
  initial:            string;
  displayName:        string;
  loading:            boolean;
  loadingSession:     boolean;
  onSend:             (text: string) => void;
  onSaveToNotes?:     (msg: Message) => void;
  headerSlot?:        React.ReactNode;
  afterMessagesSlot?: React.ReactNode;
  emptyState?:        React.ReactNode;     // override the default empty state
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  if (loadingSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Loading conversation…
      </div>
    );
  }

  const isEmpty = messages.length === 0;

  // Pending stub = an empty streaming assistant slot waiting for the first token.
  // We show a typing indicator in its place; once content arrives we render it
  // as a normal streaming bubble.
  const visible = messages.filter(
    m => !(m.role === "assistant" && m.streaming && !m.content),
  );
  const showTyping =
    loading ||
    messages.some(m => m.role === "assistant" && m.streaming && !m.content);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-6 max-w-3xl mx-auto w-full min-h-full flex flex-col">
        {headerSlot}
        {isEmpty ? (
          <div className="flex-1 flex items-center justify-center">
            {emptyState ?? <EmptyState displayName={displayName} onSend={onSend} />}
          </div>
        ) : (
          <>
            {visible.map(msg => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                initial={initial}
                onSaveToNotes={onSaveToNotes ? () => onSaveToNotes(msg) : undefined}
              />
            ))}
            {showTyping && <TypingIndicator />}
            {!showTyping && afterMessagesSlot}
          </>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
