import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { todayKST, formatDateLabel } from "@/lib/date";
import { DIRECTOR_HOME, navForRole } from "@/lib/directorNav";
import DirectorTopbar from "@/components/director/DirectorTopbar";

// 전체 보기 — 이 계정이 쓸 수 있는 화면 전체를 카테고리별로. 사이드바(자주 쓰는 것)와 달리 설명까지 모두 펼쳐 보여준다.
// 역할별 메뉴(navForRole)를 그대로 써서 원장 전용 화면은 원장에게만 보인다.
export default async function DirectorSitemapPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/director/sitemap");
  if (!session.role || !["원장", "행정", "강사", "조교"].includes(session.role)) redirect("/dashboard");

  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";
  const role = session.role;
  const groups = navForRole(role);

  return (
    <>
        <DirectorTopbar
          staffName={session.name}
          role={role}
          branchName={branchName}
          dateLabel={formatDateLabel(todayKST())}
          greetingTitle="전체 보기"
          greetingText="이 계정으로 쓸 수 있는 모든 화면입니다."
        />
        <main className="flex-1 overflow-y-auto bg-muted/50 px-4 py-6 md:px-6">
          <div className="mx-auto max-w-5xl">
            <div className="mb-6">
              <h1 className="text-lg font-bold text-foreground">EXAM AI에서 할 수 있는 일</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                가장 빠른 방법은 <Link href={DIRECTOR_HOME.href}>{role === "원장" ? "원장 홈" : "홈"}</Link>의 입력창에 말로 요청하는 것입니다(예:
                “임서영 보강 보여줘”, “이사벨고 추가프린트 찾아줘”). 아래는 메뉴로 찾아가는 전체 구조입니다.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {groups.map((g) => (
                <section key={g.key} id={g.key} className="scroll-mt-4 rounded-lg bg-background p-5">
                  <h2 className="text-base font-bold text-foreground">{g.label}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{g.desc}</p>
                  <ul className="mt-3 space-y-1">
                    {g.links.map((l) => (
                      <li key={l.href}>
                        <Link href={l.href} className="block rounded-md px-2 py-2 no-underline hover:bg-muted">
                          <span className="block text-sm font-semibold text-foreground">{l.label}</span>
                          <span className="block text-xs text-muted-foreground">{l.desc}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <section className="mt-6 rounded-lg bg-background p-5">
              <h2 className="text-base font-bold text-foreground">내가 남긴 정보는 어디서 보나요?</h2>
              <ul className="mt-3 space-y-2 text-sm text-foreground">
                <li>
                  <b>보강·재시험</b>(Slack·입력창·일정 등록) → <Link href="/director/makeups">보강 · 재시</Link>, 학생 화면의 “보강”
                </li>
                <li>
                  <b>학생 기록</b>(단어시험·숙제·암기·재시험 결과) → <Link href="/director/students">전체 학생</Link>에서 학생 선택 → “학생 기록”
                </li>
                <li>
                  <b>업무 지시</b> → <Link href="/director/tasks">{role === "조교" ? "내 업무" : "업무 보드"}</Link>
                </li>
                <li>
                  <b>Slack에 올린 파일</b> → <Link href="/director/files">파일 검색</Link>(Google Drive 원본 열기)
                </li>
                <li>
                  <b>Slack 학생기록 메시지</b> → 학생 화면의 “전체기록” → Slack 학생기록
                </li>
              </ul>
            </section>
          </div>
        </main>
    </>
  );
}
