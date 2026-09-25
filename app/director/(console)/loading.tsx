// 화면 데이터(서버 조회)를 기다리는 동안 본문 자리에만 뼈대를 보여준다 — 사이드바는 공통 레이아웃에 있어 그대로 남는다.
export default function DirectorLoading() {
  return (
    <>
      <div className="h-14 shrink-0 border-b border-border bg-background" />
      <main className="flex-1 space-y-3 overflow-hidden bg-muted/50 px-6 py-5" aria-busy="true" aria-label="불러오는 중">
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
    </>
  );
}
