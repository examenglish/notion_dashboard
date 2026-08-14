import { redirect } from "next/navigation";
import { Users, CheckCircle2, XCircle, BookX, ClipboardX } from "lucide-react";
import { getSession } from "@/lib/auth";
import { todayKST, formatDateLabel } from "@/lib/date";
import { searchStudents, getTodaySchedule, getDailyOutcomeBreakdown, listExamPrepOverview, getRecentCounseling } from "@/lib/notion";
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import StatTile from "@/components/director/StatTile";
import ListCard, { ListRow } from "@/components/director/ListCard";

const SCHEDULE_GROUPS: { key: string; label: string; detail: (item: any) => string }[] = [
  { key: "alarms", label: "조치사항", detail: (i) => i.content || "-" },
  { key: "firstDays", label: "신입생 첫등원", detail: (i) => i.classTime || "-" },
  { key: "newStudentEvents", label: "신입생 상담", detail: (i) => i.memo || i.time || "-" },
  { key: "makeupClasses", label: "보강", detail: (i) => i.time || "미확정" },
  { key: "retests", label: "재시", detail: (i) => i.time || "미확정" },
  { key: "clinicTasks", label: "클리닉", detail: (i) => i.time || "-" },
  { key: "reviewTasks", label: "복습", detail: (i) => i.time || "-" },
  { key: "counseling", label: "상담일지", detail: (i) => i.content || "-" },
  { key: "inquiries", label: "행정실 문의", detail: (i) => i.content || "-" },
];

function daysUntil(dateStr: string, today: string): number {
  const [y1, m1, d1] = today.split("-").map(Number);
  const [y2, m2, d2] = dateStr.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export default async function DirectorDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/director");
  if (session.role !== "원장") redirect("/dashboard");

  const today = todayKST();
  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";

  const [students, todaySchedule, dailyOutcome, examPrepItems, counselingEntries] = await Promise.all([
    searchStudents(""),
    getTodaySchedule(today, session.staffId),
    getDailyOutcomeBreakdown(today),
    listExamPrepOverview(),
    getRecentCounseling(),
  ]);

  // 전체 학생 / 상태 breakdown
  const statusCounts = students.reduce<Record<string, number>>((acc, s) => {
    acc[s.status ?? "재원"] = (acc[s.status ?? "재원"] ?? 0) + 1;
    return acc;
  }, {});

  // 오늘 출석/결석/재시험/과제
  const { attendance, vocab, homework } = dailyOutcome;
  const loggedToday = attendance.출석 + attendance.지각 + attendance.결석;
  const attendanceRatePct = loggedToday > 0 ? Math.round(((attendance.출석 + attendance.지각) / loggedToday) * 100) : null;

  // 시험 일정 — 오늘부터 앞으로 21일 이내
  const upcomingExams = examPrepItems
    .filter((e) => e.examDate && daysUntil(e.examDate, today) >= 0 && daysUntil(e.examDate, today) <= 21)
    .sort((a, b) => (a.examDate! < b.examDate! ? -1 : 1))
    .slice(0, 5);

  // 최근 성적 — latestExam이 있는 학생, 날짜 내림차순
  const recentGrades = students
    .filter((s) => s.latestExam)
    .sort((a, b) => (a.latestExam!.date < b.latestExam!.date ? 1 : -1))
    .slice(0, 5);

  // 상담 필요 학생 — 재원 학생 중 상담 이력이 없거나 30일 이상 지난 학생
  const lastCounselingByStudent = new Map<string, string>();
  for (const c of counselingEntries) {
    if (!c.studentId || !c.date) continue;
    const prev = lastCounselingByStudent.get(c.studentId);
    if (!prev || c.date > prev) lastCounselingByStudent.set(c.studentId, c.date);
  }
  const counselingGapStudents = students
    .filter((s) => s.status === "재원")
    .map((s) => {
      const last = lastCounselingByStudent.get(s.id) ?? null;
      const gapDays = last ? -daysUntil(last, today) : null;
      return { ...s, lastCounseling: last, gapDays };
    })
    .filter((s) => s.gapDays === null || s.gapDays >= 30)
    .sort((a, b) => (b.gapDays ?? 9999) - (a.gapDays ?? 9999))
    .slice(0, 5);

  // 오늘 일정 — 카테고리별 합산 + 상위 5건 미리보기
  const scheduleFlat = SCHEDULE_GROUPS.flatMap(({ key, label, detail }) =>
    ((todaySchedule as any)[key] as any[]).map((item) => ({
      label,
      studentName: item.studentName ?? "-",
      detail: detail(item),
    }))
  );
  const scheduleTotal = scheduleFlat.length;

  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName={branchName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DirectorTopbar staffName={session.name} role={session.role ?? ""} dateLabel={formatDateLabel(today)} />

        <main className="flex-1 overflow-y-auto bg-muted/50 px-6 py-6">
          <div className="mb-5">
            <h1 className="text-lg font-bold text-foreground">전체 학원 현황</h1>
            <p className="text-sm text-muted-foreground">{session.name} 원장님, 오늘 하루 현황입니다.</p>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatTile
              icon={Users}
              label="전체 학생"
              value={`${students.length}명`}
              sub={`재원 ${statusCounts["재원"] ?? 0}`}
            />
            <StatTile
              icon={CheckCircle2}
              label="오늘 출석"
              value={attendanceRatePct !== null ? `${attendanceRatePct}%` : "-"}
              sub={`${attendance.출석 + attendance.지각}/${loggedToday || 0}명 기록`}
              tone="success"
            />
            <StatTile icon={XCircle} label="오늘 결석" value={`${attendance.결석}명`} tone="destructive" />
            <StatTile icon={BookX} label="단어 재시험" value={`${vocab.재시험}명`} tone="warning" />
            <StatTile icon={ClipboardX} label="미완료 과제" value={`${homework.미완료}명`} tone="warning" />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ListCard title="오늘 일정" countLabel={`전체 ${scheduleTotal}건`} empty={scheduleTotal === 0}>
              {scheduleFlat.slice(0, 5).map((item, i) => (
                <ListRow key={i} primary={`${item.studentName} · ${item.label}`} secondary={item.detail} />
              ))}
              {scheduleTotal > 5 && (
                <p className="pt-2 text-xs text-muted-foreground">외 {scheduleTotal - 5}건 더 — 대시보드에서 전체 확인</p>
              )}
            </ListCard>

            <ListCard title="시험 일정" countLabel="앞으로 21일" empty={upcomingExams.length === 0}>
              {upcomingExams.map((e) => (
                <ListRow
                  key={e.studentId + e.examTitle}
                  primary={`${e.studentName} · ${e.examTitle || "시험대비"}`}
                  secondary={`${e.school} ${e.grade ?? ""}`}
                  meta={`D-${daysUntil(e.examDate!, today)}`}
                  tone={daysUntil(e.examDate!, today) <= 7 ? "destructive" : "default"}
                />
              ))}
            </ListCard>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ListCard title="최근 성적" empty={recentGrades.length === 0}>
              {recentGrades.map((s) => (
                <ListRow
                  key={s.id}
                  primary={s.name}
                  secondary={`${s.latestExam!.subject ?? ""} ${s.latestExam!.examName ?? ""}`}
                  meta={`${s.latestExam!.score ?? "-"}점 · ${s.latestExam!.date}`}
                />
              ))}
            </ListCard>

            <ListCard
              title="상담 필요 학생"
              countLabel="상담 30일 이상 공백"
              empty={counselingGapStudents.length === 0}
            >
              {counselingGapStudents.map((s) => (
                <ListRow
                  key={s.id}
                  primary={s.name}
                  secondary={`${s.school} ${s.grade ?? ""}`}
                  meta={s.lastCounseling ? `마지막 상담 ${s.lastCounseling}` : "상담 이력 없음"}
                  tone="warning"
                />
              ))}
            </ListCard>
          </div>
        </main>
      </div>
    </div>
  );
}
