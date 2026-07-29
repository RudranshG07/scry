import { Closing } from "@/components/landing/closing";
import { Hero } from "@/components/landing/hero";
import { LiveMarkets } from "@/components/landing/live-markets";
import { ProofRecord } from "@/components/landing/proof-record";
import { QuoteSection } from "@/components/landing/quote-section";
import { scryApi } from "@/lib/api";
import { isLiveStatus } from "@/lib/time";

export async function LandingPage() {
  const markets = await scryApi.listMarkets();
  const liveMarkets = markets.filter((market) => isLiveStatus(market.status));
  const proofMarket =
    markets.find((market) => market.status === "Resolved") ??
    markets.find((market) => market.status === "Result proposed") ??
    markets[0];
  const proof = await scryApi.getProof(proofMarket.id);

  return (
    <div className="bg-[#0a0608]">
      <Hero liveCount={liveMarkets.length} streamCount={markets.length} />
      <QuoteSection />
      <LiveMarkets markets={markets} />
      {proof && <ProofRecord market={proofMarket} proof={proof} />}
      <Closing liveCount={liveMarkets.length} />
    </div>
  );
}
