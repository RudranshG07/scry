import { notFound } from "next/navigation";
import { ScryDashboard } from "@/components/scry-dashboard";
import { scryApi } from "@/lib/api";

export default async function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const market = await scryApi.getMarket(id);
  if (!market) notFound();
  return <ScryDashboard initialMarketId={market.id} />;
}
