import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Scry — Live reality, priced",
  description: "Turn qualified live streams into transparent prediction markets with measurable rules and verifiable evidence.",
};

export default function Home() {
  return <LandingPage />;
}
