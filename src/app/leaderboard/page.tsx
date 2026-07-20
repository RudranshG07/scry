import { LeaderboardView } from "@/components/leaderboard-view";
import { scryApi } from "@/lib/api";

export default async function LeaderboardPage() {
  const entries = await scryApi.getLeaderboard();
  return <LeaderboardView entries={entries} />;
}
