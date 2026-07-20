import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Database,
  Fingerprint,
  Radio,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import type { Market, ProofOfObservation } from "@/lib/domain";

function shortHash(hash: `0x${string}` | null) {
  if (!hash) return "Pending";
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function ProofView({ market, proof }: { market: Market; proof: ProofOfObservation }) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <Link className="button-ghost -ml-3" href={`/markets/${market.id}`}><ArrowLeft className="size-4" aria-hidden="true" />Back to live room</Link>
        <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-ring">
              <Fingerprint className="size-4" aria-hidden="true" />
              Proof of Observation
            </div>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-[-0.04em] md:text-4xl">{market.question}</h1>
            <p className="mt-3 text-sm text-muted-foreground">{market.city} · {market.location} · {proof.streamId}</p>
          </div>
          <div className="rounded-card border border-accent/30 bg-accent/8 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-accent"><ShieldCheck className="size-5" aria-hidden="true" />{proof.status}</p>
            <p className="mt-4 font-mono text-3xl font-semibold">{proof.observedValue ?? "—"}</p>
            <p className="mt-1 text-xs text-muted-foreground">Observed value</p>
          </div>
        </section>

        <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Evidence summary">
          <div className="rounded-card border border-border bg-surface p-4"><Clock3 className="size-5 text-ring" aria-hidden="true" /><p className="mt-3 text-xs text-muted-foreground">Observation window</p><p className="mt-1 font-mono text-sm font-semibold">{formatTime(proof.observationWindow.opensAt)}–{formatTime(proof.observationWindow.closesAt)}</p></div>
          <div className="rounded-card border border-border bg-surface p-4"><Activity className="size-5 text-ring" aria-hidden="true" /><p className="mt-3 text-xs text-muted-foreground">Measured uptime</p><p className="mt-1 font-mono text-sm font-semibold">{proof.measuredUptime.toFixed(2)}%</p></div>
          <div className="rounded-card border border-border bg-surface p-4"><Fingerprint className="size-5 text-ring" aria-hidden="true" /><p className="mt-3 text-xs text-muted-foreground">Rule hash</p><p className="mt-1 font-mono text-sm font-semibold">{shortHash(proof.ruleHash)}</p></div>
          <div className="rounded-card border border-border bg-surface p-4"><Database className="size-5 text-ring" aria-hidden="true" /><p className="mt-3 text-xs text-muted-foreground">Evidence root</p><p className="mt-1 font-mono text-sm font-semibold">{shortHash(proof.evidenceRoot)}</p></div>
        </section>

        <section className="mt-8 rounded-card border border-border bg-surface p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Observer quorum</p>
              <h2 className="mt-1 text-xl font-semibold">Independent observation paths</h2>
            </div>
            <span className="inline-flex min-h-10 items-center gap-2 self-start rounded-control bg-accent/10 px-3 text-xs font-semibold text-accent"><CheckCircle2 className="size-4" aria-hidden="true" />2 signatures required</span>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {proof.observers.map((observer, index) => (
              <article className="rounded-card bg-surface-raised p-4" key={observer.id}>
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-8 place-items-center rounded-full bg-primary/12 font-mono text-xs font-semibold text-ring">{index + 1}</span>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${observer.state === "Reconnecting" ? "bg-warning/12 text-warning" : "bg-accent/12 text-accent"}`}>{observer.state}</span>
                </div>
                <h3 className="mt-4 font-semibold">{observer.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{observer.role}</p>
                <p className="mt-4 font-mono text-xs text-muted-foreground">{observer.modelVersion}</p>
                <p className="mt-2 truncate font-mono text-xs">{shortHash(observer.signature ?? null)}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-4 rounded-card border border-border bg-surface p-5">
          <div className="flex items-start gap-3">
            <Radio className="mt-0.5 size-5 shrink-0 text-ring" aria-hidden="true" />
            <div>
              <h2 className="font-semibold">Evidence access policy</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Public verification exposes the rule, observer identities, signatures, uptime, and evidence commitment. Anonymized replay evidence remains encrypted and is released only through the dispute process.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
