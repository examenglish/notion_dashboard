import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { todayKST, formatDateLabel } from "@/lib/date";
import {
  searchStudents,
  getTodaySchedule,
  getDailyOutcomeBreakdown,
  listExamPrepOverview,
  getRecentCounseling,
  getClinicRecordsByDate,
} from "@/lib/notion";
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import DirectorDashboardClient from "@/components/director/DirectorDashboardClient";

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

  const [students, todaySchedule, dailyOutcome, examPrepItems, counselingEntries, clinicRecordsToday] = await Promise.all([
    searchStudents(""),
    getTodaySchedule(today, session.staffId),
    getDailyOutcomeBreakdown(today),
    listExamPrepOverview(),
    getRecentCounseling(),
    getClinicRecordsByDate(today),
  ]);

  // "조교 클리닉" 카드는 지시된 할일(DB⑱)이 아니라 조교가 실제로 작성한
  // 보고(DB⑮)를 보여준다 — 한 기록이 학생 여러 명을 담당학생으로 묶어둘 수
  // 있어(예: 담당반 전체 클리닉), 학생별 한 줄 표시를 위해 여기서 펼친다.
  const clinicItems = clinicRecordsToday.flatMap((r) =>
    (r.studentNames.length > 0 ? r.studentNames : ["-"]).map((name, idx) => ({
      id: `${r.id}:${idx}`,
      studentName: name,
      studentNames: r.studentNames,
      assistantName: r.assistantName,
      content: r.content,
      nextPrep: r.nextPrep,
      checked: r.checked,
    }))
  );

  const statusCounts = students.reduce<Record<string, number>>((acc, s) => {
    acc[s.status ?? "재원"] = (acc[s.status ?? "재원"] ?? 0) + 1;
    return acc;
  }, {});

  const { attendance, vocab, homework } = dailyOutcome;
  const loggedToday = attendance.출석 + attendance.지각 + attendance.결석;
  const attendanceRatePct = loggedToday > 0 ? Math.round(((attendance.출석 + attendance.지각) / loggedToday) * 100) : null;

  const upcomingExams = examPrepItems
    .filter((e) => e.examDate && daysUntil(e.examDate, today) >= 0 && daysUntil(e.examDate, today) <= 21)
    .sort((a, b) => (a.examDate! < b.examDate! ? -1 : 1))
    .map((e) => ({
      studentId: e.studentId,
      studentName: e.studentName,
      examTitle: e.examTitle || "시험대비",
      school: e.school,
      grade: e.grade ?? null,
      dDay: daysUntil(e.examDate!, today),
      examRange: e.examRange,
      examDate: e.examDate,
      teachers: e.teachers,
      progress: e.progress,
      weakPoints: e.weakPoints,
      categories: e.categories,
    }));

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
    .sort((a, b) => (b.gapDays ?? 9999) - (a.gapDays ?? 9999));

  const scheduleFlat = SCHEDULE_GROUPS.flatMap(({ key, label, detail }) =>
    ((todaySchedule as any)[key] as any[]).map((item) => ({
      id: item.id as string,
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

        <main className="flex-1 overflow-y-auto bg-muted/50 px-6 py-5">
          <div className="mb-3">
            <h1 className="text-base font-bold leading-tight text-foreground">전체 학원 현황</h1>
            <p className="text-xs text-muted-foreground">{session.name} 원장님, 오늘 하루 현황입니다.</p>
          </div>

          <DirectorDashboardClient
            today={today}
            role={session.role ?? ""}
            studentsCount={students.length}
            activeStudentsCount={statusCounts["재원"] ?? 0}
            attendanceRatePct={attendanceRatePct}
            attendanceLoggedLabel={`${attendance.출석 + attendance.지각}/${loggedToday || 0}명 기록`}
            absentCount={attendance.결석}
            vocabRetestCount={vocab.재시험}
            homeworkIncompleteCount={homework.미완료}
            scheduleFlat={scheduleFlat}
            scheduleTotal={scheduleTotal}
            clinicItems={clinicItems}
            makeupItems={todaySchedule.makeupClasses}
            inquiriesToday={todaySchedule.inquiries}
            counselingToday={todaySchedule.counseling}
            upcomingExams={upcomingExams}
            counselingGapStudents={counselingGapStudents}
          />
        </main>
      </div>
    </div>
  );
}
