import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { todayKST, formatDateLabel } from "@/lib/date";
import { fileDateRange, searchFileArchives, type FileHit } from "@/lib/fileArchive";
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import FileResults from "@/components/FileResults";

// 보관 파일 목록(읽기 전용) — 자연어 입력창의 파일 검색과 같은 searchFileArchives를 쓴다.
// 지점은 서버(이 배포의 지점)로만 정한다: 현재 지점 + 공용 자료만, 요청 값으로 지점을 바꿀 수 없다.
const PERIODS: { value: string; label: string }[] = [
  { value: "", label: "전체 기간" },
  { value: "오늘", label: "오늘" },
  { value: "이번주", label: "이번 주" },
  { value: "지난주", label: "지난주" },
  { value: "이번달", label: "이번 달" },
  { value: "지난달", label: "지난달" },
];

export default async function DirectorFilesPage({ searchParams }: { searchParams: Promise<{ q?: string; period?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login?next=/director/files");
  if (!session.role || !["원장", "행정", "강사", "조교"].includes(session.role)) redirect("/dashboard");

  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";
  const { q = "", period = "" } = await searchParams;
  const today = todayKST();
  const range = PERIODS.some((p) => p.value === period) && period ? fileDateRange(period, today) : null;

  let files: FileHit[] = [];
  let unavailable = false;
  try {
    files = await searchFileArchives({ keywords: q.split(/\s+/).filter(Boolean).slice(0, 10), from: range?.from, to: range?.to }, 200);
  } catch (err) {
    console.error("director/files search failed", err instanceof Error ? err.message : String(err));
    unavailable = true;
  }

  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName={branchName} role={session.role ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DirectorTopbar
          staffName={session.name}
          role={session.role ?? ""}
          branchName={branchName}
          dateLabel={formatDateLabel(today)}
          greetingTitle="파일"
          greetingText="Slack에 올라온 파일을 찾고 Google Drive 원본을 엽니다. 입력창에 “거성중2 파일 찾아줘”처럼 말로 찾아도 됩니다."
        />
        <main className="flex-1 overflow-y-auto bg-muted/50 px-6 py-5">
          <div className="card">
            <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input name="q" defaultValue={q} placeholder="파일명·메시지·업로더 검색" style={{ flex: "1 1 220px" }} />
              <select name="period" defaultValue={period}>
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <button type="submit">검색</button>
            </form>
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <h2>{q || range ? "검색 결과" : "최근 파일"} {files.length}</h2>
            {unavailable ? (
              <p className="muted">파일 보관함을 아직 사용할 수 없습니다(관리자 설정이 필요합니다).</p>
            ) : files.length === 0 ? (
              q || range ? (
                <div>
                  <p className="muted">조건에 맞는 파일이 없습니다. 파일명의 일부 단어만 넣어 보세요(예: “이사벨 추가”).</p>
                  <p style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {q.includes(" ") && <a href={`/director/files?q=${encodeURIComponent(q.split(/\s+/)[0])}`}>“{q.split(/\s+/)[0]}”만으로 검색</a>}
                    <a href="/director/files">최근 파일 보기</a>
                  </p>
                </div>
              ) : (
                <p className="muted">아직 보관된 파일이 없습니다. Slack 채널에 파일을 올리면 자동으로 보관되어 여기에 나타납니다.</p>
              )
            ) : (
              <FileResults files={files} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
