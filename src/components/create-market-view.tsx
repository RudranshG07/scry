"use client";

import { ArrowRight, CircleAlert, LoaderCircle, Mic, RefreshCw, ScanEye, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";

import { SiteHeader } from "@/components/site-header";
import { useWallet } from "@/components/wallet-provider";
import { useStream } from "@/hooks/use-scry";
import { scryApi } from "@/lib/api";
import type { ClaimKind } from "@/lib/domain";

type Kind = Extract<ClaimKind, "phrase" | "objects">;

const kinds: Array<{ value: Kind; title: string; body: string; icon: typeof Mic }> = [
  {
    value: "phrase",
    title: "Something they say",
    body: "A word or catchphrase. Two separate transcriptions of the audio have to agree on the count.",
    icon: Mic,
  },
  {
    value: "objects",
    title: "Something in view",
    body: "People or vehicles on a camera that stays still. Two detectors have to agree on the count.",
    icon: ScanEye,
  },
];

const subjects = [
  { value: "person", label: "People" },
  { value: "car", label: "Cars" },
  { value: "bus", label: "Buses" },
  { value: "truck", label: "Lorries" },
  { value: "bicycle", label: "Bicycles" },
  { value: "motorcycle", label: "Motorcycles" },
];

const inputClass = "focus-ring mt-2 min-h-12 w-full rounded-control border border-border bg-background px-3 text-sm";

export function CreateMarketView() {
  const wallet = useWallet();
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("phrase");
  const [phrase, setPhrase] = useState("");
  const [subject, setSubject] = useState("person");
  const [stage, setStage] = useState<"idle" | "signing" | "submitting">("idle");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const stream = useStream(submitted);
  const busy = stage !== "idle";
  const status = stream.data;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const target = kind === "phrase" ? phrase.trim() : subject;
    if (!link.trim() || !name.trim() || !target) {
      setError("Add the stream link, a name, and what to count.");
      return;
    }
    if (!wallet.isConnected || !wallet.address) {
      setError("Connect a wallet first. A stream belongs to the wallet that submits it.");
      return;
    }

    try {
      const session = await scryApi.currentSession();
      if (session?.address.toLowerCase() !== wallet.address.toLowerCase()) {
        setStage("signing");
        await wallet.signIn();
      }
      setStage("submitting");
      const created = await scryApi.submitStream({
        sourceUrl: link.trim(),
        name: name.trim(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        category: kind === "phrase" ? "Creators" : undefined,
        claim: { kind, target },
      });
      setSubmitted(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The stream could not be submitted. Try again.");
    } finally {
      setStage("idle");
    }
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-8 md:px-6 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ring">Create</p>
        <h1 className="mt-2 display text-4xl">Open markets on any live stream</h1>
        <p className="mt-3 max-w-prose text-sm leading-6 text-muted-foreground">
          Paste a live stream and say what to count. Scry checks it can hear or see that clearly, then opens a market on
          each four-minute window: does the count go over the bar or not. Nothing pays out unless two independent observers
          agree, and every stake is refunded when they cannot.
        </p>

        {!submitted ? (
          <form className="mt-8 space-y-6 rounded-card border border-border bg-surface p-5 sm:p-6" onSubmit={submit} noValidate>
            <div>
              <label className="text-sm font-semibold" htmlFor="stream-link">Live stream link</label>
              <input
                id="stream-link"
                className={inputClass}
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://www.youtube.com/watch?v=…"
                value={link}
                onChange={(event) => setLink(event.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-semibold" htmlFor="stream-name">Name</label>
              <input
                id="stream-name"
                className={inputClass}
                type="text"
                autoComplete="off"
                maxLength={80}
                placeholder="Who or what is on this stream"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <fieldset>
              <legend className="text-sm font-semibold">What to count</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {kinds.map(({ value, title, body, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={kind === value}
                    onClick={() => setKind(value)}
                    className={`focus-ring flex items-start gap-3 rounded-control border p-4 text-left transition-colors ${
                      kind === value ? "border-foreground bg-surface-raised" : "border-border hover:border-muted-foreground"
                    }`}
                  >
                    <Icon className="mt-0.5 size-5 shrink-0 text-ring" aria-hidden="true" />
                    <span>
                      <span className="block text-sm font-semibold">{title}</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">{body}</span>
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>

            {kind === "phrase" ? (
              <div>
                <label className="text-sm font-semibold" htmlFor="phrase">Word or phrase</label>
                <input
                  id="phrase"
                  className={inputClass}
                  type="text"
                  autoComplete="off"
                  maxLength={40}
                  placeholder="guys"
                  value={phrase}
                  onChange={(event) => setPhrase(event.target.value)}
                  aria-describedby="phrase-help"
                />
                <p id="phrase-help" className="mt-2 text-xs leading-5 text-muted-foreground">
                  Matched as whole words, whatever the case or punctuation.
                </p>
              </div>
            ) : (
              <div>
                <label className="text-sm font-semibold" htmlFor="subject">Count</label>
                <select id="subject" className={inputClass} value={subject} onChange={(event) => setSubject(event.target.value)} aria-describedby="subject-help">
                  {subjects.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
                <p id="subject-help" className="mt-2 text-xs leading-5 text-muted-foreground">
                  A camera that pans or cuts between views is refused.
                </p>
              </div>
            )}

            {error && <p className="text-sm text-danger" role="alert">{error}</p>}

            <button className="button-primary w-full" type="submit" disabled={busy} aria-busy={busy}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="size-4" aria-hidden="true" />}
              {stage === "signing" ? "Sign in with your wallet" : stage === "submitting" ? "Submitting" : "Submit stream"}
            </button>
          </form>
        ) : (
          <section className="mt-8 rounded-card border border-border bg-surface p-5 sm:p-6" aria-live="polite">
            {!status && stream.status === "loading" && <div className="h-24 animate-pulse rounded-card bg-surface-raised" />}
            {!status && stream.status === "error" && (
              <div role="alert">
                <CircleAlert className="size-5 text-danger" aria-hidden="true" />
                <p className="mt-3 font-semibold">The stream&apos;s status did not load</p>
                <button className="button-secondary mt-4" type="button" onClick={stream.retry}>
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Retry
                </button>
              </div>
            )}
            {status && (
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ring">{status.name}</p>
                {status.status === "Candidate" && (
                  <>
                    <h2 className="mt-3 flex items-center gap-2 text-xl font-semibold">
                      <LoaderCircle className="size-5 animate-spin text-ring" aria-hidden="true" />
                      Checking the stream
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Scry is watching and listening to a sample. It takes a minute or two, and this page updates on its own.
                    </p>
                  </>
                )}
                {status.status === "Qualified" && (
                  <>
                    <h2 className="mt-3 text-xl font-semibold">Accepted</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {status.reason ? `${status.reason}. ` : ""}Markets open on it as soon as observers are free to watch it
                      {status.threshold ? `, starting with a bar of ${status.threshold}` : ""}.
                    </p>
                    <Link className="button-primary mt-5" href="/live">
                      Go to live markets
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  </>
                )}
                {(status.status === "Suspended" || status.status === "Retired") && (
                  <>
                    <h2 className="mt-3 text-xl font-semibold">Not usable right now</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{status.reason || "The stream could not be counted."}</p>
                    <button className="button-secondary mt-5" type="button" onClick={() => setSubmitted(null)}>
                      Try another stream
                    </button>
                  </>
                )}
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
