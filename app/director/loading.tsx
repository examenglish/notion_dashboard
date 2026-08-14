// Next.js auto-wraps each /director route segment in Suspense using this as
// the fallback while the page's server-side Notion fetches resolve — without
// it, clicking a sidebar link left the screen frozen/blank until the fetch
// finished, which read as "slow to respond".
export default function DirectorLoading() {
  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <div className="hidden w-60 shrink-0 border-r border-border bg-sidebar md:block" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-14 shrink-0 border-b border-border bg-background" />
        <main className="flex-1 space-y-3 overflow-hidden bg-muted/50 px-6 py-5">
          <div className="h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
