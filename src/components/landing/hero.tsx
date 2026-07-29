"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const heroVideoSrc = process.env.NEXT_PUBLIC_SCRY_HERO_VIDEO ?? "/landing/hero.mp4";
const heroPosterSrc = "/landing/hero-poster.webp";

const navLinks = [
  { label: "Live", href: "/live" },
  { label: "Markets", href: "/markets" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "Proof", href: "/markets?view=history" },
];

function PillButton({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      className={`button-glow focus-ring inline-flex items-center justify-center rounded-full bg-white px-8 py-3.5 text-sm font-medium tracking-wide text-black transition-colors duration-300 hover:bg-white/90 ${className}`}
      href={href}
    >
      {children}
    </Link>
  );
}

export function Hero({ liveCount, streamCount }: { liveCount: number; streamCount: number }) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <section className="relative h-screen overflow-hidden">
      {heroVideoSrc ? (
        <video
          className="absolute inset-0 size-full object-cover"
          src={heroVideoSrc}
          poster={heroPosterSrc}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
        />
      ) : (
        <div className="absolute inset-0 bg-[#0a0608]" aria-hidden="true">
          <div className="signal-grid absolute inset-0 opacity-25" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(107,173,196,0.28),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_-10%,rgba(255,255,255,0.10),transparent_45%)]" />
        </div>
      )}

      <div className="absolute inset-0 bg-black/20" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[45vh] bg-gradient-to-b from-transparent via-[#010a17]/55 to-[#010a17]"
        aria-hidden="true"
      />

      <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-6 py-5 md:px-12">
        <Link className="focus-ring font-script rounded-control text-2xl text-white md:text-3xl" href="/">
          Scry
        </Link>

        <nav className="hidden items-center gap-12 md:flex" aria-label="Landing page navigation">
          {navLinks.map((link) => (
            <Link
              className="focus-ring text-sm tracking-wide text-white/80 transition-colors hover:text-white"
              href={link.href}
              key={link.label}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <PillButton href="/live" className="hidden md:inline-flex">Open app</PillButton>

        <button
          className="focus-ring relative z-50 grid size-11 place-items-center rounded-full md:hidden"
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="landing-mobile-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
        >
          <span className="relative block h-4 w-6">
            <span
              className="absolute left-0 top-0 block h-px w-6 bg-white transition-transform duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]"
              style={{ transform: menuOpen ? "translateY(9px) rotate(45deg)" : "none" }}
            />
            <span
              className="absolute left-0 top-2 block h-px w-6 bg-white transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]"
              style={{ opacity: menuOpen ? 0 : 1, transform: menuOpen ? "scaleX(0)" : "none" }}
            />
            <span
              className="absolute left-0 top-4 block h-px w-6 bg-white transition-transform duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]"
              style={{ transform: menuOpen ? "translateY(-9px) rotate(-45deg)" : "none" }}
            />
          </span>
        </button>
      </header>

      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-500 md:hidden ${menuOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />

      <div
        id="landing-mobile-menu"
        className={`fixed inset-y-0 right-0 z-40 flex w-[85%] max-w-[340px] flex-col justify-center border-l border-white/10 bg-[#0a0608]/95 px-8 backdrop-blur-xl transition-transform duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] md:hidden ${menuOpen ? "translate-x-0" : "translate-x-full"}`}
        hidden={!menuOpen}
      >
        <nav className="flex flex-col gap-7" aria-label="Mobile navigation">
          {navLinks.map((link, index) => (
            <Link
              className="focus-ring font-instrument text-3xl text-white transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]"
              href={link.href}
              key={link.label}
              onClick={() => setMenuOpen(false)}
              style={{
                opacity: menuOpen ? 1 : 0,
                transform: menuOpen ? "translateX(0)" : "translateX(24px)",
                transitionDelay: `${150 + index * 75}ms`,
              }}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <PillButton
          href="/live"
          className="mt-12 w-full transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]"
        >
          Open app
        </PillButton>
      </div>

      <div className="absolute inset-0 -mt-[120px] flex flex-col items-center justify-center px-6">
        <h1 className="font-instrument text-glow max-w-5xl text-center text-[36px] leading-[0.9] tracking-tight text-white md:text-7xl lg:text-[110px]">
          Watch the world live.<br />Predict what happens next.
        </h1>
        <p className="mt-5 max-w-xl text-center text-sm text-white/70 md:mt-7 md:text-base">
          Qualified live streams become transparent prediction markets, with every result tied to a rule that cannot move and evidence anyone can inspect.
        </p>
        <PillButton href="/live" className="mt-6 md:mt-9">Enter a live market</PillButton>
      </div>

      <div className="absolute bottom-8 left-8 hidden items-center gap-3 md:flex">
        <span className="grid size-10 place-items-center rounded-full border border-white/20">
          <span className="signal-pulse size-1.5 rounded-full bg-white" />
        </span>
        <span className="text-xs leading-4 text-white/60">
          {liveCount} live now
          <br />
          {streamCount} qualified streams
        </span>
      </div>
    </section>
  );
}
