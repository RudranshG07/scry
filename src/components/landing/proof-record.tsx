import Link from "next/link";
import type { Market, ProofOfObservation } from "@/lib/domain";
import { formatCount, formatPercent } from "@/lib/format";
import { marketUnit } from "@/lib/markets";
import { formatWindow } from "@/lib/time";

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-6 border-b border-white/10 py-4 md:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="text-xs uppercase tracking-[0.14em] text-white/35">{label}</dt>
      <dd className={`min-w-0 break-all text-sm text-white/85 ${mono ? "font-mono tabular-nums" : ""}`}>{value}</dd>
    </div>
  );
}

export function ProofRecord({ market, proof }: { market: Market; proof: ProofOfObservation }) {
  const signed = proof.observers.filter((observer) => observer.signature).length;

  return (
    <section className="relative border-t border-white/10 bg-[#0a0608] px-6 py-24 md:px-12 md:py-32" id="verification">
      <div className="mx-auto grid max-w-7xl gap-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-24">
        <div>
          <h2 className="font-instrument text-4xl leading-[1.05] tracking-tight text-white md:text-6xl">
            Trust the outcome because you can inspect the path.
          </h2>
          <p className="mt-8 max-w-md text-base leading-7 text-white/50">
            Two independent observers have to sign the same result before a market settles. The rule
            is committed before anyone forecasts, the evidence bundle is hashed, and if uptime or
            agreement falls below the published threshold the market is invalidated and every
            principal is refunded.
          </p>
          <Link
            className="focus-ring mt-10 inline-flex items-center gap-3 border-b border-white/25 pb-1 text-sm text-white transition-colors hover:border-white"
            href={`/proof/${market.id}`}
          >
            Open this record
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-4 border-b border-white/20 pb-4">
            <p className="text-sm text-white/50">
              {market.city} · {market.location}
            </p>
            <p className="text-xs uppercase tracking-[0.14em] text-white/60">{proof.status}</p>
          </div>

          <dl className="mt-2">
            <Row label="Market" value={market.id} />
            <Row label="Rule hash" value={proof.ruleHash} />
            <Row label="Evidence root" value={proof.evidenceRoot ?? "not yet committed"} />
            <Row label="Window" value={formatWindow(proof.observationWindow.opensAt, proof.observationWindow.closesAt)} />
            <Row
              label="Observed"
              value={proof.observedValue === null ? "collecting" : `${formatCount(proof.observedValue)} ${marketUnit(market.id)}`}
            />
            <Row
              label="Uptime"
              value={`${formatPercent(proof.measuredUptime, 2)} against ${formatPercent(proof.minimumUptime)} minimum`}
            />
            <Row label="Signatures" value={`${signed} of ${proof.observers.length}`} />
          </dl>

          <div className="mt-8 grid gap-px border border-white/10 sm:grid-cols-3">
            {proof.observers.map((observer) => (
              <div className="bg-white/[0.02] p-4" key={observer.id}>
                <p className="text-sm text-white/85">{observer.name}</p>
                <p className="mt-1 font-mono text-xs text-white/35">{observer.modelVersion}</p>
                <p className="mt-3 text-xs uppercase tracking-[0.12em] text-white/60">{observer.state}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
