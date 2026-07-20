"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <section className="w-full max-w-md rounded-xl border border-danger/30 bg-surface p-6">
        <AlertTriangle className="mb-4 size-6 text-danger" aria-hidden="true" />
        <h1 className="text-xl font-semibold">The live room did not load</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Your position data is safe. Try loading the room again.
        </p>
        <button className="button-primary mt-6" type="button" onClick={reset}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Try again
        </button>
      </section>
    </main>
  );
}
