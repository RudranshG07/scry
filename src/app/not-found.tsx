import { ArrowLeft, Radio } from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto grid min-h-[70vh] max-w-7xl place-items-center px-4 py-12 md:px-6 lg:px-8">
        <section className="max-w-md text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary/12 text-ring">
            <Radio className="size-6" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold">This market is not on the board</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">It may have been removed, renamed, or has not opened yet.</p>
          <Link className="button-primary mt-6" href="/live"><ArrowLeft className="size-4" aria-hidden="true" />Back to live markets</Link>
        </section>
      </main>
    </div>
  );
}
