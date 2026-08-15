import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { todayKST, formatDateLabel } from "@/lib/date";
import {
  searchStudents,
  getTodaySchedule,
  getDailyOutcomeBreakdown,
  getRecentCounseling,
  getClinicRecordsByDate,
  getUrgentCounselingRequests,
} from "@/lib/notion";
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import DirectorDashboardClient from "@/components/director/DirectorDashboardClient";

// kind는 클라이언트가 "오늘 일정" 항목을 눌렀을 때 어떤 수정/삭제 경로를
// 태울지 결정한다 — "todo"는 DB⑱할일관리 소속이라 /api/schedule-entry로
// 시간·메모·담당자 수정 + 삭제가 가능하고, "counseling"/"inquiry"는 이미
// 있는 CounselingEditRow/InquiryEditRow를 그대로 쓴다. "student"(조치사항/
// 신입생 첫등원)는 DB②학생마스터 필드라 여기서 수정 대상으로 다루지 않는다.
const SCHEDULE_GROUPS: {
  key: string;
  label: string;
  kind: "todo" | "student" | "counseling" | "inquiry";
  detail: (item: any) => string;
}[] = [
  { key: "alarms", label: "조치사항", kind: "student", detail: (i) => i.content || "-" },
  { key: "firstDays", label: "신입생 첫등원", kind: "student", detail: (i) => i.classTime || "-" },
  { key: "newStudentEvents", label: "신입생 상담", kind: "todo", detail: (i) => i.memo || i.time || "-" },
  { key: "makeupClasses", label: "보강", kind: "todo", detail: (i) => i.time || "미확정" },
  { key: "retests", label: "재시", kind: "todo", detail: (i) => i.time || "미확정" },
  { key: "clinicTasks", label: "클리닉", kind: "todo", detail: (i) => i.time || "-" },
  { key: "reviewTasks", label: "복습", kind: "todo", detail: (i) => i.time || "-" },
  { key: "counseling", label: "상담일지", kind: "counseling", detail: (i) => i.content || "-" },
  { key: "inquiries", label: "행정실 문의", kind: "inquiry", detail: (i) => i.content || "-" },
];

function daysUntil(dateStr: string, today: string): number {
  const [y1, m1, d1] = today.split("-").map(Number);
  const [y2, m2, d2] = dateStr.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export default async function DirectorDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/director");
  if (!session.role || !["원장", "행정", "강사", "조교"].includes(session.role)) redirect("/dashboard");

  const today = todayKST();
  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";

  const [students, todaySchedule, dailyOutcome, urgentCounseling, counselingEntries, clinicRecordsToday] = await Promise.all([
    searchStudents(""),
    getTodaySchedule(today, session.staffId),
    getDailyOutcomeBreakdown(today),
    getUrgentCounselingRequests(),
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

  const scheduleFlat = SCHEDULE_GROUPS.flatMap(({ key, label, kind, detail }) =>
    ((todaySchedule as any)[key] as any[]).map((item) => ({
      id: item.id as string,
      label,
      kind,
      studentName: item.studentName ?? "-",
      detail: detail(item),
      time: item.time ?? null,
      memo: item.memo ?? null,
      owner: item.owner ?? null,
    }))
  );
  const scheduleTotal = scheduleFlat.length;

  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName={branchName} role={session.role ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DirectorTopbar
          staffName={session.name}
          role={session.role ?? ""}
          dateLabel={formatDateLabel(today)}
          greetingTitle="전체 학원 현황"
          greetingText={`${session.name} ${session.role === "원장" ? "원장님" : "선생님"}, 오늘 하루 현황입니다.`}
        />

        <main className="flex-1 overflow-y-auto bg-muted/50 px-6 py-5">
          <DirectorDashboardClient
            today={today}
            role={session.role ?? ""}
            staffName={session.name}
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
            urgentCounseling={urgentCounseling}
            counselingGapStudents={counselingGapStudents}
          />
        </main>
      </div>
    </div>
  );
}
