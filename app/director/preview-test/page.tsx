// TEMPORARY — visual QA only. Renders the real /director presentational
// components with hardcoded fixture data because this sandbox's NOTION_TOKEN
// is invalid, so the real page.tsx (live Notion data) can't render here.
// Delete this file before shipping; it is not linked from anywhere.
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import DirectorDashboardClient from "@/components/director/DirectorDashboardClient";

export default function PreviewTestPage() {
  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName="이그잼영어학원 · 금정" role="원장" />
      <div className="flex min-w-0 flex-1 flex-col">
        <DirectorTopbar
          staffName="김원장"
          role="원장"
          dateLabel="8월 14일(금)"
          greetingTitle="전체 학원 현황"
          greetingText="김원장 원장님, 오늘 하루 현황입니다."
        />

        <main className="flex-1 overflow-y-auto bg-muted/50 px-6 py-5">
          <DirectorDashboardClient
            today="2026-08-14"
            role="원장"
            staffName="김원장"
            studentsCount={184}
            activeStudentsCount={171}
            attendanceRatePct={94}
            attendanceLoggedLabel="122/130명 기록"
            absentCount={6}
            vocabRetestCount={11}
            homeworkIncompleteCount={9}
            scheduleFlat={[
              { id: "s1", label: "보강", studentName: "김민준", detail: "18:00" },
              { id: "s2", label: "재시", studentName: "이서연", detail: "19:30" },
              { id: "s3", label: "신입생 상담", studentName: "박도윤", detail: "15:00 레벨테스트" },
              { id: "s4", label: "클리닉", studentName: "최지우", detail: "17:00" },
              { id: "s5", label: "조치사항", studentName: "정하은", detail: "학부모 연락 필요" },
              { id: "s6", label: "복습", studentName: "한소율", detail: "16:00" },
              { id: "q1", label: "상담일지", studentName: "오지훈", detail: "진로 상담" },
              { id: "i1", label: "행정실 문의", studentName: "강명아", detail: "교재 문의" },
            ]}
            scheduleTotal={14}
            inquiriesToday={[{ id: "i1", studentName: "강명아", content: "교재 문의 — 다음 학기 교재 언제 나오는지 물어봄" }]}
            counselingToday={[
              { id: "q1", studentName: "오지훈", counselor: "김원장", content: "진로 상담 진행, 이과 vs 문과 고민", followUp: "다음달 재상담 예정" },
            ]}
            clinicItems={[
              {
                id: "c1:0",
                studentName: "최지우",
                studentNames: ["최지우"],
                assistantName: "최조교",
                content: "단어 재시험 대비 유닛 5 복습",
                nextPrep: "유닛 6 예습 확인",
                checked: false,
              },
              {
                id: "c2:0",
                studentName: "정하은",
                studentNames: ["정하은", "한소율"],
                assistantName: "-",
                content: "",
                nextPrep: "",
                checked: false,
              },
            ]}
            makeupItems={[
              { id: "m1", studentName: "김민준", time: "18:00", memo: "지난주 결석분 보강 — Unit 4 문법", owner: "박선생", done: false },
              { id: "m2", studentName: "이서연", time: "", memo: "", owner: "-", done: false },
            ]}
            urgentCounseling={[
              {
                id: "u1",
                date: "2026-08-13",
                studentId: "5",
                studentName: "정하은",
                school: "이그잼중",
                grade: "1",
                content: "성적 급락으로 학부모가 긴급 상담 요청",
                owner: "김원장",
                enteredBy: "박선생",
              },
            ]}
            counselingGapStudents={[
              { id: "1", name: "정하은", school: "이그잼중", grade: "1", lastCounseling: null },
              { id: "2", name: "한소율", school: "이그잼고", grade: "2", lastCounseling: "2026-06-20" },
              { id: "3", name: "오지훈", school: "이그잼중", grade: "3", lastCounseling: "2026-06-11" },
            ]}
          />
        </main>
      </div>
    </div>
  );
}
