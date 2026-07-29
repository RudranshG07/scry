"use client";

import { LoaderCircle } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useExperience } from "@/components/experience-provider";
import { scryApi } from "@/lib/api";
import { useNow } from "@/lib/clock";
import type { Market, RoomMessage } from "@/lib/domain";
import { formatRelative } from "@/lib/time";

type MessageResult = {
  marketId: string;
  attempt: number;
  data: RoomMessage[] | null;
  error: boolean;
};

const reactionOptions = [
  { id: "signal" as const, label: "Strong signal", count: 184 },
  { id: "watching" as const, label: "Watching", count: 326 },
  { id: "uncertain" as const, label: "Still uncertain", count: 91 },
];

const authorTone: Record<RoomMessage["kind"], string> = {
  System: "text-accent",
  Agent: "text-ring",
  Human: "text-foreground",
};

export function RoomActivity({ market }: { market: Market }) {
  const now = useNow();
  const { settings, updateSettings } = useExperience();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<MessageResult | null>(null);
  const [body, setBody] = useState("");
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const currentReaction = settings.reactions[market.id];

  useEffect(() => {
    const controller = new AbortController();
    void scryApi.getRoomMessages(market.id, controller.signal)
      .then((data) => setResult({ marketId: market.id, attempt, data, error: false }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResult({ marketId: market.id, attempt, data: null, error: true });
      });
    return () => controller.abort();
  }, [market.id, attempt]);

  const currentResult = result?.marketId === market.id && result.attempt === attempt ? result : null;

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = body.trim();
    if (message.length < 2) {
      setSubmitState("error");
      return;
    }
    setSubmitState("submitting");
    try {
      const created = await scryApi.postRoomMessage(market.id, {
        author: settings.profile.displayName,
        body: message,
      });
      setResult((current) => ({
        marketId: market.id,
        attempt,
        data: [...(current?.data ?? []), created],
        error: false,
      }));
      setBody("");
      setSubmitState("success");
    } catch {
      setSubmitState("error");
    }
  }

  function react(reaction: "signal" | "watching" | "uncertain") {
    const reactions = { ...settings.reactions };
    if (reactions[market.id] === reaction) delete reactions[market.id];
    else reactions[market.id] = reaction;
    updateSettings({ reactions });
  }

  return (
    <section aria-labelledby="room-heading">
      <div>
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3 border-b border-border pb-3">
            <h2 id="room-heading" className="text-sm">Room</h2>
            <div className="flex flex-wrap gap-5">
              {reactionOptions.map(({ id, label, count }) => {
                const selected = currentReaction === id;
                return (
                  <button
                    className={`focus-ring rounded-control text-xs transition-colors ${selected ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => react(id)}
                    key={id}
                  >
                    {label} <span className="font-mono tabular-nums">{count + (selected ? 1 : 0)}</span>
                    {selected && <span className="mt-1 block h-px bg-foreground" />}
                  </button>
                );
              })}
            </div>
          </div>

          {!currentResult && (
            <div className="space-y-4 pt-6" aria-live="polite">
              {[0, 1].map((item) => <div className="h-12 animate-pulse rounded bg-surface" key={item} />)}
            </div>
          )}

          {currentResult?.error && (
            <div className="pt-8" role="alert">
              <p className="text-sm text-danger">Room activity did not load.</p>
              <button className="button-secondary mt-4" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
            </div>
          )}

          {currentResult?.data?.length === 0 && (
            <p className="py-12 text-sm text-muted-foreground">The room is quiet. Share the first observation.</p>
          )}

          {currentResult?.data && currentResult.data.length > 0 && (
            <div aria-live="polite">
              {currentResult.data.map((message) => (
                <article className="grid grid-cols-[7rem_minmax(0,1fr)] gap-6 border-b border-border py-4" key={message.id}>
                  <div>
                    <p className={`truncate text-xs ${authorTone[message.kind]}`}>{message.author}</p>
                    <time className="mt-1 block font-mono text-[11px] text-muted-foreground" dateTime={message.createdAt}>
                      {formatRelative(message.createdAt, now)}
                    </time>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{message.body}</p>
                </article>
              ))}
            </div>
          )}
        </div>

        <form className="mt-8" onSubmit={submitMessage}>
          <label className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground" htmlFor={`room-message-${market.id}`}>
            Add an observation
          </label>
          <textarea
            id={`room-message-${market.id}`}
            className="focus-ring mt-4 min-h-28 w-full resize-none border-b border-border bg-transparent pb-3 text-sm leading-6 focus:border-foreground"
            maxLength={160}
            autoComplete="off"
            placeholder="Traffic is accelerating near the count line."
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              setSubmitState("idle");
            }}
            aria-invalid={submitState === "error"}
            aria-describedby={`room-help-${market.id}`}
          />
          <div id={`room-help-${market.id}`} className="mt-3 flex items-baseline justify-between gap-4 text-xs">
            <span className={submitState === "error" ? "text-danger" : "text-muted-foreground"}>
              {submitState === "error" ? "Enter at least two characters." : "Do not identify people in the stream."}
            </span>
            <span className="font-mono tabular-nums text-muted-foreground">{body.length}/160</span>
          </div>
          <button className="button-secondary mt-5" type="submit" disabled={submitState === "submitting"} aria-busy={submitState === "submitting"}>
            {submitState === "submitting" ? <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Posting</> : "Post observation"}
          </button>
          {submitState === "success" && <p className="mt-4 text-xs text-accent" role="status">Added to this room.</p>}
        </form>
      </div>
    </section>
  );
}
