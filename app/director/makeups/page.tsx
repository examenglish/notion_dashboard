import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { todayKST, formatDateLabel } from "@/lib/date";
import { listScheduleTasks, type ScheduleBuckets, type ScheduleTaskRow } from "@/lib/directorViews";
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import ScheduleRowActions from "@/components/director/ScheduleRowActions";

// 보강·재시 일정 — Slack·자연어 입력창·일정 등록 폼으로 만든 보강/재시 업무를 한곳에서 본다.
// 새 저장 구조 없이 기존 업무 데이터를 읽고, 시간 변경·완료는 기존 /api/schedule-entry(대시보드 카드와 같은 API)로.
const VIEWS: { key: keyof ScheduleBuckets; label: string; empty: string }[] = [
  { key: "today", label: "오늘", empty: "오늘 예정된 {type}이 없습니다." },
  { key: "upcoming", label: "예정", empty: "앞으로 예정된 {type}이 없습니다. Slack이나 입력창에 “임서영 토요일 1시30분 보강”처럼 남기면 여기에 나타납니다." },
  { key: "overdue", label: "지난 미완료", empty: "날짜가 지났는데 완료되지 않은 {type}이 없습니다." },
  { key: "done", label: "완료", empty: "완료된 {type}이 아직 없습니다." },
];

function dateText(d: string | null): string {
  if (!d) return "날짜 미정";
  const [y, m, day] = d.split("-").map(Number);
  const w = "일월화수목금토"[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
  return `${m}/${day}(${w})`;
}

export default async function DirectorMakeupsPage({ searchParams }: { searchParams: Promise<{ type?: string; view?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login?next=/director/makeups");
  if (!session.role || !["원장", "행정", "강사", "조교"].includes(session.role)) redirect("/dashboard");

  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";
  const today = todayKST();
  const sp = await searchParams;
  const type = sp.type === "재시" ? "재시" : "보강";

  let buckets: ScheduleBuckets | null = null;
  let failed = false;
  try {
    buckets = await listScheduleTasks(type, today);
  } catch (err) {
    console.error("director/makeups load failed", err instanceof Error ? err.message : String(err));
    failed = true;
  }
  const defaultView: keyof ScheduleBuckets = buckets && buckets.today.length === 0 && buckets.upcoming.length > 0 ? "upcoming" : "today";
  const view = (VIEWS.find((v) => v.key === sp.view)?.key ?? defaultView) as keyof ScheduleBuckets;
  const rows: ScheduleTaskRow[] = buckets ? buckets[view] : [];
  const href = (t: string, v: string) => `/director/makeups?type=${encodeURIComponent(t)}&view=${v}`;

  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName={branchName} role={session.role ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DirectorTopbar
          staffName={session.name}
          role={session.role ?? ""}
          branchName={branchName}
          dateLabel={formatDateLabel(today)}
          greetingTitle="보강 · 재시"
          greetingText="Slack·입력창·일정 등록으로 잡힌 보강과 재시험 일정을 한곳에서 봅니다."
        />
        <main className="flex-1 overflow-y-auto bg-muted/50 px-4 py-5 md:px-6">
          <div className="mx-auto max-w-3xl">
            <div className="mb-4 flex items-center gap-2">
              {(["보강", "재시"] as const).map((t) => (
                <Link
                  key={t}
                  href={href(t, "today")}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-semibold no-underline ${t === type ? "bg-foreground text-background" : "bg-background text-muted-foreground"}`}
                >
                  {t === "재시" ? "재시험" : "보강"}
                </Link>
              ))}
            </div>

            {failed || !buckets ? (
              <div className="card">
                <p className="muted">{type} 일정을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p>
              </div>
            ) : (
              <>
                <div className="mb-4 grid grid-cols-4 gap-2">
                  {VIEWS.map((v) => (
                    <Link
                      key={v.key}
                      href={href(type, v.key)}
                      aria-current={v.key === view ? "page" : undefined}
                      className={`rounded-lg px-3 py-2.5 no-underline ${v.key === view ? "bg-background shadow-sm ring-1 ring-border" : "hover:bg-background/60"}`}
                    >
                      <div className="text-xs text-muted-foreground">{v.label}</div>
                      <div className="text-xl font-bold text-foreground">{buckets![v.key].length}</div>
                    </Link>
                  ))}
                </div>

                <div className="rounded-lg bg-background">
                  {rows.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                      {VIEWS.find((v) => v.key === view)!.empty.replace("{type}", type === "재시" ? "재시험" : "보강")}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {rows.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                          <div className="w-24 shrink-0">
                            <div className="text-sm font-semibold text-foreground">{dateText(r.date)}</div>
                            <div className="text-xs text-muted-foreground">{r.time || "시간 미정"}</div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-foreground">{r.studentName}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {r.done ? "완료" : r.owner ? `담당 ${r.owner}` : "담당 미배정"}
                              {r.memo ? ` · ${r.memo}` : ""}
                            </div>
                          </div>
                          {r.studentId && (
                            <Link
                              href={`/director/students?id=${encodeURIComponent(r.studentId)}&q=${encodeURIComponent(r.studentName)}`}
                              className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground no-underline hover:bg-muted"
                            >
                              학생 보기
                            </Link>
                          )}
                          <ScheduleRowActions id={r.id} date={r.date} time={r.time} done={r.done} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <p className="mt-3 text-xs text-muted-foreground">
                  담당자 변경·삭제는 <Link href="/director/dashboard">오늘 대시보드</Link>의 “보강·재시 확정 현황”에서 할 수 있습니다.
                </p>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
