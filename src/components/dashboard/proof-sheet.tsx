"use client";

import Link from "next/link";
import { useProof } from "@/hooks/use-scry";
import { formatCount, formatPercent } from "@/lib/format";
import { formatWindow } from "@/lib/time";

function Row({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-6 border-b border-border py-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 break-all font-mono text-sm tabular-nums ${tone || "text-foreground"}`}>{value}</dd>
    </div>
  );
}

export function ProofSheet({ marketId, unit }: { marketId: string; unit: string }) {
  const { data: proof, status, retry } = useProof(marketId);

  return (
    <section id="proof" aria-labelledby="proof-heading">
      <div className="flex items-baseline justify-between gap-6 border-b border-border pb-3">
        <h2 id="proof-heading" className="text-sm">Proof of Observation</h2>
        {proof && (
          <Link className="focus-ring rounded-control text-xs text-muted-foreground transition-colors hover:text-foreground" href={`/proof/${marketId}`}>
            Full record →
          </Link>
        )}
      </div>

      {status === "loading" && (
        <div className="mt-4 space-y-3" aria-busy="true">
          {[0, 1, 2, 3].map((row) => <div className="h-8 animate-pulse rounded bg-surface" key={row} />)}
        </div>
      )}

      {status === "error" && (
        <div className="mt-4" role="alert">
          <p className="text-sm text-danger">The proof service did not return a record.</p>
          <button className="button-secondary mt-4" type="button" onClick={retry}>Retry</button>
        </div>
      )}

      {status === "ready" && proof && (
        <>
          <dl className="mt-2">
            <Row label="Status" value={proof.status} />
            <Row label="Rule hash" value={proof.ruleHash} />
            <Row
              label="Evidence"
              value={proof.evidenceRoot ?? "not yet committed"}
              tone={proof.evidenceRoot ? "" : "text-muted-foreground"}
            />
            <Row label="Window" value={formatWindow(proof.observationWindow.opensAt, proof.observationWindow.closesAt)} />
            <Row
              label="Observed"
              value={proof.observedValue === null ? "collecting" : `${formatCount(proof.observedValue)} ${unit}`}
              tone={proof.observedValue === null ? "text-muted-foreground" : ""}
            />
            <Row
              label="Uptime"
              value={`${formatPercent(proof.measuredUptime, 2)} / ${formatPercent(proof.minimumUptime)} min`}
              tone={proof.measuredUptime < proof.minimumUptime ? "text-danger" : ""}
            />
          </dl>

          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            {proof.observers.map((observer) => (
              <div key={observer.id}>
                <p className="text-sm">{observer.name}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{observer.modelVersion}</p>
                <p
                  className={`mt-2 text-[11px] uppercase tracking-[0.14em] ${
                    observer.state === "Disagreed"
                      ? "text-danger"
                      : observer.state === "Reconnecting"
                        ? "text-warning"
                        : "text-accent"
                  }`}
                >
                  {observer.state}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
