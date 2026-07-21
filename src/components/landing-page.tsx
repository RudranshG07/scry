import {
  Activity,
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Eye,
  LockKeyhole,
  Play,
  Radio,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from "lucide-react";
import Link from "next/link";
import { formatUsd, historicalMarkets, markets } from "@/lib/markets";

const featuredMarket = markets[0];
const proofMarket = historicalMarkets[0];

const principles = [
  {
    icon: Radio,
    title: "Live inputs, not stale feeds",
    copy: "Every market begins with a qualified physical-world stream and a measurable observation window.",
  },
  {
    icon: LockKeyhole,
    title: "Rules that cannot move",
    copy: "Outcome bands, lock times, and observation rules freeze before forecasts enter the market.",
  },
  {
    icon: ShieldCheck,
    title: "Evidence at settlement",
    copy: "Observer consensus and timestamped proof make the final result inspectable instead of mysterious.",
  },
];

const steps = [
  { number: "01", title: "Qualify", copy: "Screen the stream for continuity, clarity, and a measurable event." },
  { number: "02", title: "Forecast", copy: "Humans and models price the next observable outcome in real time." },
  { number: "03", title: "Observe", copy: "Independent observers capture the result inside the locked window." },
  { number: "04", title: "Verify", copy: "Publish the outcome with its rule hash, evidence, and consensus trail." },
];

function BrandMark() {
  return (
    <Link className="focus-ring flex min-h-11 items-center gap-3 rounded-control" href="/" aria-label="Scry home">
      <span className="grid size-10 place-items-center rounded-full border border-primary/50 bg-primary/12">
        <Eye className="size-5 text-ring" aria-hidden="true" />
      </span>
      <span className="text-lg font-semibold tracking-[-0.04em]">SCRY</span>
    </Link>
  );
}

function ProductPreview() {
  const yesOutcome = featuredMarket.outcomes[0];

  return (
    <div className="landing-preview relative mx-auto w-full max-w-2xl rounded-card border border-border bg-surface p-2 sm:p-3">
      <div className="flex items-center justify-between gap-4 border-b border-border px-2 pb-3 pt-1 sm:px-3">
        <div className="flex items-center gap-2" aria-hidden="true">
          <span className="size-2 rounded-full bg-danger/70" />
          <span className="size-2 rounded-full bg-warning/70" />
          <span className="size-2 rounded-full bg-accent/70" />
        </div>
        <div className="flex min-w-0 items-center gap-2 rounded-full bg-background px-3 py-1.5 font-mono text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
          <span className="truncate">Qualified stream · observer quorum 3/3</span>
        </div>
      </div>

      <div className="grid gap-2 pt-2 lg:grid-cols-[minmax(0,1fr)_210px]">
        <div className="relative aspect-[16/11] overflow-hidden rounded-control border border-border bg-background">
          <div className="signal-grid absolute inset-0 opacity-70" />
          <div className="stream-noise absolute inset-0 opacity-70" />
          <div className="absolute inset-x-[10%] top-[46%] h-px rotate-[-8deg] bg-muted" />
          <div className="absolute inset-x-[8%] top-[62%] h-px rotate-[-8deg] bg-muted" />
          <div className="absolute inset-y-[8%] left-[45%] w-px rotate-[15deg] bg-muted" />
          <span className="vehicle-a absolute left-0 top-[48%] h-3 w-8 rounded-sm bg-primary shadow-sm" />
          <span className="vehicle-b absolute right-0 top-[58%] h-3 w-10 rounded-sm bg-accent shadow-sm" />
          <span className="vehicle-c absolute left-[48%] top-0 h-9 w-3 rounded-sm bg-warning shadow-sm" />

          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 text-xs font-semibold backdrop-blur-md">
            <span className="signal-pulse size-2 rounded-full bg-danger" />
            LIVE
          </div>
          <div className="absolute right-3 top-3 rounded-full bg-background/90 px-3 py-1.5 font-mono text-xs text-muted-foreground backdrop-blur-md">
            19:25:42 IST
          </div>
          <div className="absolute inset-x-3 bottom-3 rounded-control border border-border/80 bg-background/90 p-3 backdrop-blur-md">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">{featuredMarket.city} · {featuredMarket.location}</p>
                <p className="mt-1 text-sm font-semibold">Vehicle count observation</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-xl font-semibold">142</p>
                <p className="text-xs text-accent">+18 in 5m</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          <div className="rounded-control bg-surface-raised p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground">MARKET FORECAST</span>
              <BarChart3 className="size-4 text-ring" aria-hidden="true" />
            </div>
            <div className="mt-5 flex items-end justify-between gap-3">
              <div>
                <p className="font-mono text-4xl font-semibold tracking-[-0.05em]">{yesOutcome.probability}%</p>
                <p className="mt-1 text-xs text-muted-foreground">Yes, above 180</p>
              </div>
              <span className="rounded-full bg-accent/12 px-2 py-1 font-mono text-xs text-accent">+6.2%</span>
            </div>
            <div className="mt-5 flex h-14 items-end gap-1" aria-hidden="true">
              {[22, 34, 28, 41, 37, 52, 48, 62, 57, 71, 82].map((height, index) => (
                <span className="flex-1 rounded-sm bg-primary/70" key={`${height}-${index}`} style={{ height: `${height}%` }} />
              ))}
            </div>
          </div>

          <div className="rounded-control border border-border bg-background p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Sparkles className="size-4 text-accent" aria-hidden="true" />
              MODEL CONSENSUS
            </div>
            <p className="mt-4 text-sm font-semibold leading-6">Traffic velocity is tracking 10% above the historical baseline.</p>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">Confidence</span>
              <span className="font-mono text-sm font-semibold text-accent">0.87</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const liveMarkets = markets.filter((market) => market.status !== "Scheduled");

  return (
    <div className="landing-page min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex min-h-18 max-w-7xl items-center justify-between gap-5 px-4 md:px-6 lg:px-8">
          <BrandMark />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Landing page navigation">
            <a className="focus-ring inline-flex min-h-10 items-center rounded-control px-3 text-sm font-semibold text-muted-foreground hover:bg-surface hover:text-foreground" href="#platform">Platform</a>
            <a className="focus-ring inline-flex min-h-10 items-center rounded-control px-3 text-sm font-semibold text-muted-foreground hover:bg-surface hover:text-foreground" href="#how-it-works">How it works</a>
            <a className="focus-ring inline-flex min-h-10 items-center rounded-control px-3 text-sm font-semibold text-muted-foreground hover:bg-surface hover:text-foreground" href="#verification">Verification</a>
          </nav>
          <Link className="button-primary" href="/live">
            Open app
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden px-4 pb-20 pt-16 md:px-6 md:pb-28 md:pt-24 lg:px-8">
          <div className="landing-beam absolute inset-x-0 top-0 mx-auto h-px max-w-5xl" aria-hidden="true" />
          <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[0.86fr_1.14fr] lg:gap-12">
            <div className="max-w-2xl">
              <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-ring">
                <CircleDot className="size-3.5" aria-hidden="true" />
                Live physical-world intelligence
              </div>
              <h1 className="mt-6 text-4xl font-semibold leading-[1.02] tracking-[-0.06em] sm:text-5xl lg:text-6xl">
                See the world. <span className="text-ring">Price what happens next.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                Scry turns qualified live streams into transparent prediction markets, connecting every forecast to measurable rules and verifiable evidence.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link className="button-primary min-h-12 px-5" href="/live">
                  <Play className="size-4 fill-current" aria-hidden="true" />
                  Watch a live market
                </Link>
                <Link className="button-secondary min-h-12 px-5" href="/markets">
                  Browse all markets
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-5 gap-y-3 text-xs font-medium text-muted-foreground">
                <span className="flex items-center gap-2"><Check className="size-4 text-accent" aria-hidden="true" />Rules locked before entry</span>
                <span className="flex items-center gap-2"><Check className="size-4 text-accent" aria-hidden="true" />Evidence-first settlement</span>
                <span className="flex items-center gap-2"><Check className="size-4 text-accent" aria-hidden="true" />Forecast-only preview</span>
              </div>
            </div>

            <ProductPreview />
          </div>
        </section>

        <section className="border-y border-border/80 bg-surface/55" aria-label="Platform activity">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px px-4 md:grid-cols-4 md:px-6 lg:px-8">
            {[
              { value: String(liveMarkets.length), label: "Live rooms" },
              { value: "8", label: "Qualified streams" },
              { value: formatUsd(liveMarkets.reduce((sum, market) => sum + market.pool, 0)), label: "Live forecast volume" },
              { value: "3 / 3", label: "Observer quorum" },
            ].map((stat) => (
              <div className="px-3 py-7 text-center md:px-6" key={stat.label}>
                <p className="font-mono text-2xl font-semibold tracking-[-0.04em]">{stat.value}</p>
                <p className="mt-1 text-xs font-medium text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="px-4 py-20 md:px-6 md:py-28 lg:px-8" id="platform">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ring">Reality is the data layer</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">A market surface built around what can actually be observed.</h2>
              <p className="mt-4 text-base leading-7 text-muted-foreground">From traffic flow to venue queues, Scry makes physical-world signals forecastable without hiding how the result was produced.</p>
            </div>

            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              {principles.map(({ icon: Icon, title, copy }, index) => (
                <article className={`group rounded-card border border-border bg-surface p-6 ${index === 0 ? "lg:row-span-2" : ""}`} key={title}>
                  <span className="grid size-11 place-items-center rounded-control bg-primary/12 text-ring">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-8 text-xl font-semibold tracking-[-0.025em]">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy}</p>
                  {index === 0 && (
                    <div className="mt-8 overflow-hidden rounded-control border border-border bg-background p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-xs font-semibold"><Activity className="size-4 text-accent" aria-hidden="true" />Signal health</span>
                        <span className="font-mono text-xs text-accent">98.7%</span>
                      </div>
                      <div className="mt-5 flex h-20 items-end gap-1" aria-hidden="true">
                        {[38, 52, 45, 66, 62, 77, 68, 84, 80, 92, 87, 96].map((height, barIndex) => (
                          <span className="flex-1 rounded-sm bg-accent/50" key={`${height}-${barIndex}`} style={{ height: `${height}%` }} />
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              ))}

              <article className="rounded-card border border-primary/25 bg-primary/10 p-6 lg:col-span-2">
                <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ring">Human + machine</p>
                    <h3 className="mt-3 text-xl font-semibold tracking-[-0.025em]">Compare collective belief with model consensus.</h3>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">See where people, forecasting models, and live measurements agree before you make a call.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-control bg-background/70 p-4 text-center"><p className="font-mono text-2xl font-semibold">64%</p><p className="mt-1 text-xs text-muted-foreground">Market</p></div>
                    <div className="rounded-control bg-background/70 p-4 text-center"><p className="font-mono text-2xl font-semibold text-accent">68%</p><p className="mt-1 text-xs text-muted-foreground">Models</p></div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="border-y border-border/80 bg-surface/45 px-4 py-20 md:px-6 md:py-28 lg:px-8" id="how-it-works">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ring">One transparent loop</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">From live signal to final truth.</h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-muted-foreground">Every phase is visible, time-bounded, and connected to the same immutable market rule.</p>
            </div>
            <div className="mt-10 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, index) => (
                <article className="relative rounded-card border border-border bg-background p-5" key={step.number}>
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-xs font-semibold text-ring">{step.number}</span>
                    {index < steps.length - 1 && <ArrowRight className="hidden size-4 text-muted-foreground lg:block" aria-hidden="true" />}
                  </div>
                  <h3 className="mt-8 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-20 md:px-6 md:py-28 lg:px-8" id="verification">
          <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2">
            <div className="max-w-xl">
              <div className="inline-flex size-12 items-center justify-center rounded-control bg-accent/10 text-accent">
                <ScanLine className="size-6" aria-hidden="true" />
              </div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-ring">Evidence, not vibes</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Trust the outcome because you can inspect the path.</h2>
              <p className="mt-5 text-base leading-7 text-muted-foreground">Scry links each resolution to the original rule, the observation window, observer submissions, and the finalized evidence record.</p>
              <Link className="button-secondary mt-7" href={`/proof/${proofMarket.id}`}>
                Explore a proof record
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>

            <div className="rounded-card border border-border bg-surface p-5 sm:p-7">
              <div className="flex items-center justify-between gap-4 border-b border-border pb-5">
                <div>
                  <p className="text-xs text-muted-foreground">Observation record</p>
                  <p className="mt-1 font-mono text-sm font-semibold">SCRY-OBS-4F2A</p>
                </div>
                <span className="rounded-full bg-accent/12 px-3 py-1.5 text-xs font-semibold text-accent">Verified</span>
              </div>
              <div className="mt-2">
                {[
                  { icon: LockKeyhole, label: "Rule committed", value: "Block 24,981,201" },
                  { icon: Clock3, label: "Window observed", value: "19:00–19:30 IST" },
                  { icon: Waypoints, label: "Observer consensus", value: "3 matching reports" },
                  { icon: ShieldCheck, label: "Evidence finalized", value: "Hash 8b7e…31ac" },
                ].map(({ icon: Icon, label, value }) => (
                  <div className="flex items-center gap-4 border-b border-border py-4 last:border-0" key={label}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-raised text-ring"><Icon className="size-4" aria-hidden="true" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{label}</p>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{value}</p>
                    </div>
                    <Check className="size-4 shrink-0 text-accent" aria-hidden="true" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 pb-20 md:px-6 md:pb-28 lg:px-8">
          <div className="relative mx-auto max-w-7xl overflow-hidden rounded-card border border-primary/30 bg-primary/10 px-6 py-12 text-center sm:px-10 sm:py-16">
            <div className="signal-grid absolute inset-0 opacity-30" aria-hidden="true" />
            <div className="relative mx-auto max-w-2xl">
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary text-primary-foreground"><Eye className="size-6" aria-hidden="true" /></span>
              <h2 className="mt-6 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">The next signal is already live.</h2>
              <p className="mt-4 text-base leading-7 text-muted-foreground">Step inside the market, watch reality unfold, and make your forecast before the window locks.</p>
              <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                <Link className="button-primary min-h-12 px-5" href="/live">Enter Scry <ArrowRight className="size-4" aria-hidden="true" /></Link>
                <Link className="button-secondary min-h-12 px-5" href="/markets">View the schedule</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/80 px-4 py-8 md:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <BrandMark />
          <p className="text-xs leading-5 text-muted-foreground">Live forecasts for measurable physical-world events.</p>
          <div className="flex gap-1">
            <Link className="focus-ring inline-flex min-h-10 items-center rounded-control px-3 text-xs font-semibold text-muted-foreground hover:text-foreground" href="/markets">Markets</Link>
            <Link className="focus-ring inline-flex min-h-10 items-center rounded-control px-3 text-xs font-semibold text-muted-foreground hover:text-foreground" href="/leaderboard">Leaderboard</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
