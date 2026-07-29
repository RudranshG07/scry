import Link from "next/link";

const footerLinks = [
  { label: "Live", href: "/live" },
  { label: "Markets", href: "/markets" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "Portfolio", href: "/portfolio" },
];

export function Closing({ liveCount }: { liveCount: number }) {
  return (
    <>
      <section className="relative border-t border-white/10 bg-[#0a0608] px-6 py-32 md:px-12 md:py-44">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="font-instrument text-5xl leading-[0.95] tracking-tight text-white md:text-8xl">
            The next window
            <br />
            is already open.
          </h2>
          <p className="mx-auto mt-8 max-w-md text-base leading-7 text-white/50">
            {liveCount === 0
              ? "Markets open on a rolling schedule. Check the calendar for the next window."
              : `${liveCount} ${liveCount === 1 ? "market is" : "markets are"} live right now. Watch the count, then make your call before it locks.`}
          </p>
          <Link
            className="button-glow focus-ring mt-12 inline-flex items-center justify-center rounded-full bg-white px-10 py-4 text-sm font-medium tracking-wide text-black transition-colors duration-300 hover:bg-white/90"
            href="/live"
          >
            Enter a live market
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-[#0a0608] px-6 py-12 md:px-12">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
          <Link className="focus-ring font-script rounded-control text-2xl text-white" href="/">
            Scry
          </Link>
          <p className="max-w-sm text-xs leading-5 text-white/35">
            A product preview. Markets are simulated, no funds are submitted, and monetary
            participation is disabled.
          </p>
          <nav className="flex flex-wrap gap-6" aria-label="Footer navigation">
            {footerLinks.map((link) => (
              <Link
                className="focus-ring text-xs tracking-wide text-white/50 transition-colors hover:text-white"
                href={link.href}
                key={link.label}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </>
  );
}
