import type { MarketStatus } from "@/lib/domain";

export const statusTone: Record<MarketStatus, string> = {
  Scheduled: "bg-primary/12 text-ring",
  Open: "bg-accent/12 text-accent",
  Locked: "bg-muted text-muted-foreground",
  Observing: "bg-warning/12 text-warning",
  "Result proposed": "bg-primary/12 text-ring",
  Challenged: "bg-danger/12 text-danger",
  Resolved: "bg-accent/12 text-accent",
  Invalid: "bg-danger/12 text-danger",
};

const pulsingStatuses = new Set<MarketStatus>(["Open", "Observing"]);

export function StatusPill({ status }: { status: MarketStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold ${statusTone[status]}`}>
      <span className={`size-1.5 rounded-full bg-current ${pulsingStatuses.has(status) ? "signal-pulse" : ""}`} />
      {status}
    </span>
  );
}
