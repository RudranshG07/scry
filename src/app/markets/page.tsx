import { Suspense } from "react";
import { MarketsView } from "@/components/markets-view";

export default function MarketsPage() {
  return <Suspense fallback={<main className="grid min-h-screen place-items-center"><div className="h-10 w-36 animate-pulse rounded-control bg-surface" /></main>}><MarketsView /></Suspense>;
}
