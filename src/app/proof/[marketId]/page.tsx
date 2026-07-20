import { notFound } from "next/navigation";
import { ProofView } from "@/components/proof-view";
import { scryApi } from "@/lib/api";

export default async function ProofPage({ params }: { params: Promise<{ marketId: string }> }) {
  const { marketId } = await params;
  const [market, proof] = await Promise.all([
    scryApi.getMarket(marketId),
    scryApi.getProof(marketId),
  ]);
  if (!market || !proof) notFound();
  return <ProofView market={market} proof={proof} />;
}
