import type { Metadata } from "next";
import { Dancing_Script, Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { WalletProvider } from "@/components/wallet-provider";
import { ExperienceProvider } from "@/components/experience-provider";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const dancingScript = Dancing_Script({
  variable: "--font-script",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Scry — Watch live. Predict next.",
  description: "Live prediction markets for measurable physical-world events.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${geistMono.variable} ${instrumentSerif.variable} ${dancingScript.variable} antialiased`}>
        <ToastProvider>
          <ExperienceProvider><WalletProvider>{children}</WalletProvider></ExperienceProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
