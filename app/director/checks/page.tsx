import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { todayKST, formatDateLabel } from "@/lib/date";
import { listCheckQueues, type CheckQueues } from "@/lib/directorViews";
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";

// 확인 필요 학생 — 최근 2주 학생 기록에서 재시험 필요·숙제 미완료·암기 미완료를 학생별 작업 목록으로(읽기 전용).
// 같은 학생·같은 시험의 더 최근 기록이 통과/완료면 목록에서 빠진다. 처리 결과는 입력창·Slack으로 다시 기록한다.
const TABS: { key: keyof Omit<CheckQueues, "since">; label: string; empty: string; hint: string }[] = [
  { key: "retest", label: "재시험", empty: "최근 2주 동안 재시험이 필요한 학생이 없습니다.", hint: "재시험 후 “임서영 단어 재시험 통과”처럼 입력하면 목록에서 빠집니다." },
  { key: "homework", label: "숙제 미완료", empty: "최근 2주 동안 숙제 미완료로 기록된 학생이 없습니다.", hint: "확인 후 “임서영 워크북 숙제 완료”처럼 입력하면 목록에서 빠집니다." },
  { key: "memorization", label: "암기 미완료", empty: "최근 2주 동안 암기 미완료로 기록된 학생이 없습니다.", hint: "확인 후 “임서영 본문 암기 완료”처럼 입력하면 목록에서 빠집니다." },
];

export default async function DirectorChecksPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login?next=/director/checks");
  if (!session.role || !["원장", "행정", "강사", "조교"].includes(session.role)) redirect("/dashboard");

  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";
  const today = todayKST();
  const sp = await searchParams;
  let queues: CheckQueues | null = null;
  try {
    queues = await listCheckQueues(today);
  } catch (err) {
    console.error("director/checks load failed", err instanceof Error ? err.message : String(err));
  }
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const items = queues ? queues[tab.key] : [];

  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName={branchName} role={session.role ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DirectorTopbar
          staffName={session.name}
          role={session.role ?? ""}
          branchName={branchName}
          dateLabel={formatDateLabel(today)}
          greetingTitle="확인 필요 학생"
          greetingText="최근 2주 학생 기록에서 재시험·숙제·암기 미완료를 모았습니다."
        />
        <main className="flex-1 overflow-y-auto bg-muted/50 px-4 py-5 md:px-6">
          <div className="mx-auto max-w-3xl">
            {!queues ? (
              <div className="card">
                <p className="muted">학생 기록을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p>
              </div>
            ) : (
              <>
                <div className="mb-4 grid grid-cols-3 gap-2">
                  {TABS.map((t) => (
                    <Link
                      key={t.key}
                      href={`/director/checks?tab=${t.key}`}
                      aria-current={t.key === tab.key ? "page" : undefined}
                      className={`rounded-lg px-3 py-2.5 no-underline ${t.key === tab.key ? "bg-background shadow-sm ring-1 ring-border" : "hover:bg-background/60"}`}
                    >
                      <div className="text-xs text-muted-foreground">{t.label}</div>
                      <div className="text-xl font-bold text-foreground">{queues![t.key].length}</div>
                    </Link>
                  ))}
                </div>
                <div className="rounded-lg bg-background">
                  {items.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">{tab.empty}</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {items.map((it) => (
                        <li key={it.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-foreground">{it.studentName}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {it.detail} · {it.date.slice(5).replace("-", "/")}
                              {it.enteredBy ? ` · 입력 ${it.enteredBy}` : ""}
                            </div>
                          </div>
                          {it.studentId && (
                            <Link
                              href={`/director/students?id=${encodeURIComponent(it.studentId)}&q=${encodeURIComponent(it.studentName)}`}
                              className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground no-underline hover:bg-muted"
                            >
                              학생 보기
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{tab.hint}</p>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
