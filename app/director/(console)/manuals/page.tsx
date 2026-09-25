import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { todayKST, formatDateLabel } from "@/lib/date";
import { listManuals } from "@/lib/notion";
import DirectorTopbar from "@/components/director/DirectorTopbar";

export default async function ManualsListPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/director/manuals");
  if (!session.role || !["원장", "행정", "강사", "조교"].includes(session.role)) redirect("/dashboard");

  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";
  const isManager = session.role === "원장" || session.role === "행정" || session.role === "강사";

  let manuals: Awaited<ReturnType<typeof listManuals>> = [];
  let dbNotReady = false;
  try {
    manuals = isManager ? await listManuals({}) : await listManuals({ status: "PUBLISHED", role: session.role });
  } catch {
    dbNotReady = true;
  }

  const published = manuals.filter((m) => m.status === "PUBLISHED");
  const drafts = manuals.filter((m) => m.status !== "PUBLISHED");

  return (
    <>
        <DirectorTopbar
          staffName={session.name}
          role={session.role ?? ""}
          branchName={branchName}
          dateLabel={formatDateLabel(todayKST())}
          greetingTitle="매뉴얼"
          greetingText="업무 화면 사용법을 확인하거나, 화면녹화로 새 매뉴얼을 만드세요."
        />
        <main className="flex-1 overflow-y-auto bg-muted/50 px-6 py-5">
          {dbNotReady ? (
            <div className="card">
              <h2>매뉴얼 기능이 아직 설정되지 않았습니다</h2>
              <p className="muted">원장 계정으로 POST /api/admin/setup을 먼저 실행해 매뉴얼 저장소를 만들어주세요.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {isManager && (
                <div className="card">
                  <Link href="/director/manuals/upload">
                    <button type="button">화면녹화로 만들기</button>
                  </Link>
                </div>
              )}

              <div className="card">
                <h2>게시된 매뉴얼 {published.length}</h2>
                {published.length === 0 ? (
                  <p className="muted">아직 게시된 매뉴얼이 없습니다.</p>
                ) : (
                  <ul className="schedule-list">
                    {published.map((m) => (
                      <li key={m.id} className="schedule-item-row">
                        <Link href={`/director/manuals/${m.id}/review`}>
                          <span className="badge">{m.category || "기타"}</span> {m.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {isManager && (
                <div className="card">
                  <h2>초안 {drafts.length}</h2>
                  {drafts.length === 0 ? (
                    <p className="muted">검토 대기 중인 초안이 없습니다.</p>
                  ) : (
                    <ul className="schedule-list">
                      {drafts.map((m) => (
                        <li key={m.id} className="schedule-item-row">
                          <Link href={`/director/manuals/${m.id}/review`}>
                            <span className="badge">{m.status}</span> {m.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
    </>
  );
}
