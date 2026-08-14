"use client";

import { useState } from "react";
import { Users, CheckCircle2, XCircle, BookX, ClipboardX } from "lucide-react";
import StatTile from "./StatTile";
import ListCard, { ListRow } from "./ListCard";
import Popup from "./Popup";
import NaturalLanguageInput from "@/components/NaturalLanguageInput";
import MakeupStatusCard from "@/components/MakeupStatusCard";
import type { DailyOutcomeStudent } from "@/lib/notion";

type ScheduleRow = { label: string; studentName: string; detail: string };
type ExamRow = { studentId: string; studentName: string; examTitle: string; school: string; grade: string | null; dDay: number };
type GradeRow = { id: string; name: string; subject: string; examName: string; score: number | string; date: string };
type CounselingGapRow = { id: string; name: string; school: string; grade: string | null; lastCounseling: string | null };

export default function DirectorDashboardClient({
  today,
  role,
  studentsCount,
  activeStudentsCount,
  attendanceRatePct,
  attendanceLoggedLabel,
  absentCount,
  vocabRetestCount,
  homeworkIncompleteCount,
  scheduleFlat,
  scheduleTotal,
  upcomingExams,
  recentGrades,
  counselingGapStudents,
}: {
  today: string;
  role: string;
  studentsCount: number;
  activeStudentsCount: number;
  attendanceRatePct: number | null;
  attendanceLoggedLabel: string;
  absentCount: number;
  vocabRetestCount: number;
  homeworkIncompleteCount: number;
  scheduleFlat: ScheduleRow[];
  scheduleTotal: number;
  upcomingExams: ExamRow[];
  recentGrades: GradeRow[];
  counselingGapStudents: CounselingGapRow[];
}) {
  const [popup, setPopup] = useState<null | "absent" | "homework">(null);
  const [detail, setDetail] = useState<{ absentStudents: DailyOutcomeStudent[]; incompleteHomeworkStudents: DailyOutcomeStudent[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function openPopup(kind: "absent" | "homework") {
    setPopup(kind);
    if (detail) return;
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/daily-outcome-detail?date=${encodeURIComponent(today)}`);
      setDetail(await res.json());
    } finally {
      setLoadingDetail(false);
    }
  }

  const popupList =
    popup === "absent" ? detail?.absentStudents : popup === "homework" ? detail?.incompleteHomeworkStudents : undefined;

  return (
    <>
      <div className="mb-3">
        <NaturalLanguageInput />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile icon={Users} label="전체 학생" value={`${studentsCount}명`} sub={`재원 ${activeStudentsCount}`} />
        <StatTile
          icon={CheckCircle2}
          label="오늘 출석"
          value={attendanceRatePct !== null ? `${attendanceRatePct}%` : "-"}
          sub={attendanceLoggedLabel}
          tone="success"
        />
        <StatTile icon={XCircle} label="오늘 결석" value={`${absentCount}명`} tone="destructive" onClick={() => openPopup("absent")} />
        <StatTile icon={BookX} label="단어 재시험" value={`${vocabRetestCount}명`} tone="warning" />
        <StatTile
          icon={ClipboardX}
          label="미완료 과제"
          value={`${homeworkIncompleteCount}명`}
          tone="warning"
          onClick={() => openPopup("homework")}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <ListCard title="오늘 일정" countLabel={`전체 ${scheduleTotal}건`} empty={scheduleTotal === 0}>
          {scheduleFlat.slice(0, 8).map((item, i) => (
            <ListRow key={i} primary={`${item.studentName} · ${item.label}`} secondary={item.detail} />
          ))}
          {scheduleTotal > 8 && (
            <p className="pt-1.5 text-[11px] text-muted-foreground">외 {scheduleTotal - 8}건 더 — 대시보드에서 전체 확인</p>
          )}
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

        <div className="director-embed">
          <MakeupStatusCard role={role} variant="embed" />
        </div>

        <ListCard title="시험 일정" countLabel="앞으로 21일" empty={upcomingExams.length === 0}>
          {upcomingExams.map((e) => (
            <ListRow
              key={e.studentId + e.examTitle}
              primary={`${e.studentName} · ${e.examTitle}`}
              secondary={`${e.school} ${e.grade ?? ""}`}
              meta={`D-${e.dDay}`}
              tone={e.dDay <= 7 ? "destructive" : "default"}
            />
          ))}
        </ListCard>

        <ListCard title="최근 성적" empty={recentGrades.length === 0}>
          {recentGrades.map((s) => (
            <ListRow key={s.id} primary={s.name} secondary={`${s.subject} ${s.examName}`} meta={`${s.score}점 · ${s.date}`} />
          ))}
        </ListCard>
      </div>

      {popup && (
        <Popup
          title={popup === "absent" ? "오늘 결석" : "미완료 과제"}
          countLabel={popupList ? `${popupList.length}명` : undefined}
          onClose={() => setPopup(null)}
        >
          {loadingDetail && <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중...</p>}
          {!loadingDetail && popupList?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">해당하는 학생이 없습니다.</p>
          )}
          {!loadingDetail &&
            popupList?.map((s) => (
              <ListRow
                key={s.studentId}
                primary={s.studentName}
                secondary={`${s.school} ${s.grade ?? ""} · ${s.className}`}
              />
            ))}
        </Popup>
      )}
    </>
  );
}
