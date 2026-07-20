"use client";

import { Bot, CircleAlert, Eye, LoaderCircle, MessageSquareText, Radio, RefreshCw, Send, Sparkles, UserRound } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useExperience } from "@/components/experience-provider";
import { scryApi } from "@/lib/api";
import type { Market, RoomMessage } from "@/lib/domain";

type MessageResult = {
  marketId: string;
  attempt: number;
  data: RoomMessage[] | null;
  error: boolean;
};

const reactionOptions = [
  { id: "signal" as const, label: "Strong signal", icon: Radio, count: 184 },
  { id: "watching" as const, label: "Watching", icon: Eye, count: 326 },
  { id: "uncertain" as const, label: "Still uncertain", icon: Sparkles, count: 91 },
];

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function RoomActivity({ market }: { market: Market }) {
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
    <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]" aria-labelledby="room-activity-heading">
      <div className="rounded-card border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Room pulse</p>
            <h2 id="room-activity-heading" className="mt-1 text-lg font-semibold">What forecasters are seeing</h2>
          </div>
          <p className="text-xs text-muted-foreground">Reactions are stored on this device</p>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          {reactionOptions.map(({ id, label, icon: Icon, count }) => {
            const selected = currentReaction === id;
            return (
              <button
                className={`focus-ring flex min-h-12 items-center justify-between gap-3 rounded-control border px-3 text-left text-xs font-semibold ${selected ? "border-primary bg-primary/12 text-ring" : "border-border bg-surface-raised text-muted-foreground hover:text-foreground"}`}
                type="button"
                aria-pressed={selected}
                onClick={() => react(id)}
                key={id}
              >
                <span className="flex items-center gap-2"><Icon className="size-4" aria-hidden="true" />{label}</span>
                <span className="font-mono">{count + (selected ? 1 : 0)}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-5 border-t border-border pt-5">
          {!currentResult && <div className="space-y-3" aria-live="polite">{[0, 1].map((item) => <div className="h-20 animate-pulse rounded-control bg-surface-raised" key={item} />)}</div>}
          {currentResult?.error && <div className="rounded-control border border-danger/30 bg-danger/8 p-4" role="alert"><CircleAlert className="size-5 text-danger" aria-hidden="true" /><p className="mt-2 text-sm font-semibold">Room activity did not load</p><button className="button-secondary mt-3" type="button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw className="size-4" aria-hidden="true" />Retry</button></div>}
          {currentResult?.data?.length === 0 && <div className="py-8 text-center"><MessageSquareText className="mx-auto size-7 text-muted-foreground" aria-hidden="true" /><p className="mt-3 font-semibold">The room is quiet</p><p className="mt-1 text-sm text-muted-foreground">Share the first observation.</p></div>}
          {currentResult?.data && currentResult.data.length > 0 && (
            <div className="space-y-3" aria-live="polite">
              {currentResult.data.map((message) => (
                <article className="flex items-start gap-3 rounded-control bg-surface-raised p-3" key={message.id}>
                  <span className={`grid size-9 shrink-0 place-items-center rounded-full ${message.kind === "Agent" ? "bg-primary/12 text-ring" : message.kind === "System" ? "bg-accent/10 text-accent" : "bg-muted text-foreground"}`}>
                    {message.kind === "Agent" ? <Bot className="size-4" aria-hidden="true" /> : message.kind === "System" ? <Radio className="size-4" aria-hidden="true" /> : <UserRound className="size-4" aria-hidden="true" />}
                  </span>
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-sm font-semibold">{message.author}</p><time className="font-mono text-xs text-muted-foreground" dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time></div><p className="mt-1 text-sm leading-6 text-muted-foreground">{message.body}</p></div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      <aside className="rounded-card border border-border bg-surface p-4 sm:p-5">
        <div className="flex items-center gap-2"><MessageSquareText className="size-5 text-ring" aria-hidden="true" /><h2 className="font-semibold">Join the room</h2></div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Share observable context. Do not post personal information or identify people in the stream.</p>
        <form className="mt-5" onSubmit={submitMessage}>
          <label className="text-xs font-semibold text-muted-foreground" htmlFor={`room-message-${market.id}`}>Your observation</label>
          <textarea
            id={`room-message-${market.id}`}
            className="focus-ring mt-2 min-h-28 w-full resize-none rounded-control border border-border bg-background p-3 text-sm leading-6"
            maxLength={160}
            autoComplete="off"
            placeholder="Traffic is accelerating near the count line."
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              setSubmitState("idle");
            }}
            aria-invalid={submitState === "error"}
            aria-describedby={`room-message-help-${market.id}`}
          />
          <div id={`room-message-help-${market.id}`} className="mt-2 flex items-center justify-between gap-3 text-xs"><span className={submitState === "error" ? "text-danger" : "text-muted-foreground"}>{submitState === "error" ? "Enter at least two characters." : "Public room preview"}</span><span className="font-mono text-muted-foreground">{body.length}/160</span></div>
          <button className="button-primary mt-4 w-full" type="submit" disabled={submitState === "submitting"} aria-busy={submitState === "submitting"}>{submitState === "submitting" ? <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Posting</> : <>Post observation<Send className="size-4" aria-hidden="true" /></>}</button>
          {submitState === "success" && <p className="mt-3 text-xs text-accent" role="status">Observation added to this room.</p>}
        </form>
      </aside>
    </section>
  );
}
