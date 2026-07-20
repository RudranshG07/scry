export default function Loading() {
  return (
    <main className="mx-auto min-h-screen max-w-[1440px] animate-pulse px-4 py-6 md:px-6 lg:px-8">
      <div className="mb-8 h-12 rounded-lg bg-surface" />
      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
        <div className="h-[620px] rounded-xl bg-surface" />
        <div className="h-[620px] rounded-xl bg-surface" />
        <div className="h-[620px] rounded-xl bg-surface" />
      </div>
    </main>
  );
}
