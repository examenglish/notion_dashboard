import Link from "next/link";
import { getTodaySchedule, listMyTasks, listReviewInbox, getMakeupScheduleStatus, type TaskRecord } from "@/lib/notion";
import HomeRecentWork from "./HomeRecentWork";

// 첫 화면(자연어 입력창 아래) — 역할별 "지금 할 일". 읽기만 하고, 처리는 기존 화면(업무 보드·보강·학생)에서 한다.
//  원장: 학원 전체에서 오늘 볼 것 + 확인이 필요한 것
//  행정: 오늘 처리할 것 + 빠진 것(미확정 보강·재시, 오늘 문의)
//  조교·강사: 내 업무(급한 것·시간 임박 순), 없으면 오늘 확인 가능한 보강·재시
type Props = { role: string; staffId: string; staffName: string; today: string };

type Count = { label: string; value: number; href: string };

function byPriority(a: TaskRecord, b: TaskRecord, today: string) {
  const rank = (t: TaskRecord) => (t.urgent ? 0 : t.date && t.date < today ? 1 : t.date === today ? 2 : 3);
  return rank(a) - rank(b) || `${a.date ?? "9999"} ${a.time}`.localeCompare(`${b.date ?? "9999"} ${b.time}`);
}

function taskBadge(t: TaskRecord, today: string): { text: string; tone: string } {
  if (t.urgent) return { text: "긴급", tone: "text-red-700" };
  if (t.date && t.date < today) return { text: "기한 지남", tone: "text-red-700" };
  if (t.date === today) return { text: t.time ? `오늘 ${t.time}` : "오늘", tone: "text-foreground" };
  return { text: t.date ? `${t.date.slice(5).replace("-", "/")}${t.time ? ` ${t.time}` : ""}` : "기한 없음", tone: "text-muted-foreground" };
}

export default async function HomeToday({ role, staffId, staffName, today }: Props) {
  const isWorker = role === "조교" || role === "강사";
  const [schedule, myTasks, review, makeups] = await Promise.all([
    getTodaySchedule(today, staffId || undefined).catch(() => null),
    isWorker && staffId ? listMyTasks(staffId).catch(() => null) : Promise.resolve(null),
    role === "원장" || role === "행정" ? listReviewInbox().catch(() => null) : Promise.resolve(null),
    role === "원장" || role === "행정" ? getMakeupScheduleStatus({}).catch(() => null) : Promise.resolve(null),
  ]);

  const todayMakeups = (schedule?.makeupClasses ?? []).filter((m) => !m.done);
  const todayRetests = (schedule?.retests ?? []).filter((m) => !m.done);
  const counts: Count[] = [
    { label: "오늘 보강", value: todayMakeups.length, href: "/director/makeups?type=보강&view=today" },
    { label: "오늘 재시험", value: todayRetests.length, href: "/director/makeups?type=재시&view=today" },
  ];
  if (role === "원장" || role === "행정") {
    counts.push({ label: "미확정 보강·재시", value: (makeups ?? []).filter((m) => !m.confirmed).length, href: "/director/dashboard" });
    counts.push({ label: role === "원장" ? "원장 확인 대기" : "검토 대기 업무", value: (review ?? []).length, href: "/director/tasks" });
  }
  if (role === "행정") counts.push({ label: "오늘 문의·행정", value: (schedule?.inquiries ?? []).length, href: "/director/dashboard" });

  const openTasks = (myTasks ?? []).filter((t) => !t.done).sort((a, b) => byPriority(a, b, today));
  const todayTasks = (myTasks ?? []).filter((t) => t.date === today);
  const doneToday = todayTasks.filter((t) => t.done).length;

  return (
    <section className="home-today" aria-label="오늘 할 일">
      {isWorker && (
        <div className="home-today-block">
          <div className="home-today-head">
            <h2>지금 할 일</h2>
            {myTasks && (
              <span className="home-today-meta">
                오늘 완료 {doneToday} / {todayTasks.length} · 남은 업무 {openTasks.length}
              </span>
            )}
          </div>
          {myTasks === null ? (
            <p className="home-today-empty">업무를 불러오지 못했습니다. <Link href="/director/tasks">내 업무 열기</Link></p>
          ) : openTasks.length === 0 ? (
            <div className="home-today-empty">
              <p>{staffName} 선생님께 지금 배정된 업무가 없습니다. 오늘 확인할 수 있는 항목입니다.</p>
            </div>
          ) : (
            <ol className="home-task-list">
              {openTasks.slice(0, 5).map((t, i) => {
                const b = taskBadge(t, today);
                return (
                  <li key={t.id}>
                    <Link href="/director/tasks" className="home-task">
                      <span className="home-task-order">{i === 0 ? "먼저" : i === 1 ? "다음" : ""}</span>
                      <span className="home-task-body">
                        <span className="home-task-title">
                          {t.studentName ? `${t.studentName} · ` : ""}
                          {t.title || t.typeLabel}
                        </span>
                        <span className="home-task-sub">
                          {t.typeLabel}
                          {t.className ? ` · ${t.className}` : ""}
                          {t.note ? ` · ${t.note}` : ""}
                        </span>
                      </span>
                      <span className={`home-task-when ${b.tone}`}>{b.text}</span>
                    </Link>
                  </li>
                );
              })}
              {openTasks.length > 5 && (
                <li>
                  <Link href="/director/tasks" className="home-more">
                    남은 업무 {openTasks.length - 5}건 더 보기
                  </Link>
                </li>
              )}
            </ol>
          )}
        </div>
      )}

      <div className="home-today-block">
        <div className="home-today-head">
          <h2>{isWorker ? "오늘 확인할 것" : role === "행정" ? "오늘 행정" : "오늘 학원"}</h2>
          <Link href="/director/dashboard" className="home-today-meta">
            오늘 대시보드 →
          </Link>
        </div>
        <div className="home-counts">
          {counts.map((c) => (
            <Link key={c.label} href={c.href} className="home-count">
              <span className="home-count-value">{c.value}</span>
              <span className="home-count-label">{c.label}</span>
            </Link>
          ))}
        </div>
        {todayMakeups.length > 0 && (
          <ul className="home-makeups">
            {todayMakeups.slice(0, 5).map((m) => (
              <li key={m.id}>
                <span className="home-makeup-time">{m.time || "시간 미정"}</span>
                <span>{m.studentName} 보강</span>
                <span className="home-today-meta">{m.owner && m.owner !== "-" ? m.owner : "담당 미배정"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="home-today-block">
        <div className="home-today-head">
          <h2>최근 작업</h2>
        </div>
        <HomeRecentWork />
      </div>

      <nav className="home-shortcuts" aria-label="바로가기">
        {(isWorker
          ? [
              ["내 업무", "/director/tasks"],
              ["학생 찾기", "/director/students"],
              ["보강 · 재시", "/director/makeups"],
              ["기록 입력", "/director/input?tab=records"],
              ["파일 찾기", "/director/files"],
            ]
          : [
              ["학생 찾기", "/director/students"],
              ["보강 · 재시", "/director/makeups"],
              ["업무", "/director/tasks"],
              ["시험대비", "/director/exam-prep"],
              ["파일 찾기", "/director/files"],
            ]
        ).map(([label, href]) => (
          <Link key={href} href={href} className="home-shortcut">
            {label}
          </Link>
        ))}
        <Link href="/director/sitemap" className="home-shortcut home-shortcut-all">
          전체 보기
        </Link>
      </nav>
    </section>
  );
}
