"use client";

import { Bell, CalendarDays, Eye, LoaderCircle, Radio, Settings, Trophy, WalletCards } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/components/wallet-provider";

function walletLabel(status: ReturnType<typeof useWallet>["status"], address: `0x${string}` | null) {
  if (status === "connecting" || status === "checking") return "Connecting";
  if (status === "wrong-network") return "Switch to Base";
  if (status === "unavailable") return "No wallet";
  if (status === "error") return "Retry wallet";
  if (status === "connected" && address) return `${address.slice(0, 5)}…${address.slice(-4)}`;
  return "Connect wallet";
}

export function SiteHeader() {
  const wallet = useWallet();
  const pathname = usePathname();
  const loading = wallet.status === "checking" || wallet.status === "connecting";

  const desktopLinks = [
    { href: "/", label: "Live", active: pathname === "/" || pathname.startsWith("/markets/") },
    { href: "/markets", label: "Markets", active: pathname === "/markets" },
    { href: "/leaderboard", label: "Leaderboard", active: pathname === "/leaderboard" },
    { href: "/portfolio", label: "Portfolio", active: pathname === "/portfolio" },
    { href: "/profile", label: "Profile", active: pathname === "/profile" },
    { href: "/settings", label: "Controls", active: pathname === "/settings" },
  ];

  const mobileLinks = [
    { href: "/", label: "Live", icon: Radio, active: pathname === "/" || pathname.startsWith("/markets/") },
    { href: "/markets", label: "Markets", icon: CalendarDays, active: pathname === "/markets" },
    { href: "/leaderboard", label: "Ranks", icon: Trophy, active: pathname === "/leaderboard" },
    { href: "/portfolio", label: "Portfolio", icon: WalletCards, active: pathname === "/portfolio" },
    { href: "/settings", label: "Controls", icon: Settings, active: pathname === "/settings" },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 w-full min-w-0 max-w-screen-2xl items-center justify-between gap-4 px-4 md:px-6 lg:px-8">
          <Link className="focus-ring flex min-h-10 items-center gap-3 rounded-control" href="/" aria-label="Scry home">
            <span className="grid size-9 place-items-center rounded-full border border-primary/50 bg-primary/12">
              <Eye className="size-5 text-ring" aria-hidden="true" />
            </span>
            <span className="text-lg font-semibold tracking-[-0.04em]">SCRY</span>
          </Link>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
            {desktopLinks.map(({ href, label, active }) => (
              <Link
                className={`focus-ring inline-flex min-h-10 items-center rounded-control px-3 text-sm font-semibold transition-colors ${active ? "bg-surface-soft text-foreground" : "text-muted-foreground hover:bg-surface hover:text-foreground"}`}
                href={href}
                key={href}
                aria-current={active ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <span className="hidden min-h-10 items-center gap-2 rounded-control border border-border bg-surface px-3 text-xs font-medium text-muted-foreground xl:flex">
              <span className="size-1.5 rounded-full bg-accent" />
              Base · Forecast only
            </span>
            <Link className="focus-ring grid size-10 shrink-0 place-items-center rounded-control border border-border bg-surface text-muted-foreground hover:text-foreground" href="/notifications" aria-label="Open notifications"><Bell className="size-4" aria-hidden="true" /></Link>
            <button
              className={wallet.isConnected ? "button-secondary" : "button-primary"}
              type="button"
              onClick={() => void wallet.connect()}
              disabled={loading || wallet.isConnected}
              aria-busy={loading}
              title={wallet.error ?? undefined}
            >
              {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <WalletCards className="size-4" aria-hidden="true" />}
              <span className="hidden sm:inline">{walletLabel(wallet.status, wallet.address)}</span>
              <span className="sm:hidden">{wallet.isConnected ? "Connected" : "Connect"}</span>
            </button>
          </div>
        </div>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Mobile navigation">
        {mobileLinks.map(({ href, label, icon: Icon, active }) => (
          <Link className={`focus-ring flex min-h-16 flex-col items-center justify-center gap-1 rounded-control text-xs font-semibold ${active ? "text-ring" : "text-muted-foreground"}`} href={href} key={href} aria-current={active ? "page" : undefined}>
            <Icon className="size-5" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}
