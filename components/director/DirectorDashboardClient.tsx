"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users, CheckCircle2, XCircle, BookX, ClipboardX } from "lucide-react";
import StatTile from "./StatTile";
import ListCard, { ListRow } from "./ListCard";
import Popup from "./Popup";
import NaturalLanguageInput from "@/components/NaturalLanguageInput";
import MakeupStatusCard from "@/components/MakeupStatusCard";
import TodayClinicCard from "./TodayClinicCard";
import { InquiryEditRow, CounselingEditRow, type InquiryItem, type CounselingItem } from "./EditableScheduleRow";
import type { DailyOutcomeStudent } from "@/lib/notion";

type ScheduleRow = { id: string; label: string; studentName: string; detail: string };
type ExamRow = { studentId: string; studentName: string; examTitle: string; school: string; grade: string | null; dDay: number };
type CounselingGapRow = { id: string; name: string; school: string; grade: string | null; lastCounseling: string | null };
type ClinicTaskRow = {
  id: string;
  studentName: string;
  time: string;
  memo: string;
  owner: string;
  done: boolean;
  school: string;
  gradeNum: string;
};

function MoreButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <div className="px-4 pb-3 pt-1">
      <button type="button" onClick={onClick} className="bg-transparent p-0 text-xs font-medium text-primary hover:underline">
        더보기 · 전체 {count}건
      </button>
    </div>
  );
}

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
  clinicItems,
  inquiriesToday,
  counselingToday,
  upcomingExams,
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
  clinicItems: ClinicTaskRow[];
  inquiriesToday: InquiryItem[];
  counselingToday: CounselingItem[];
  upcomingExams: ExamRow[];
  counselingGapStudents: CounselingGapRow[];
}) {
  const router = useRouter();
  const makeupToday = scheduleFlat.filter((i) => i.label === "보강");
  const inquiryById = new Map(inquiriesToday.map((i) => [i.id, i]));
  const counselingById = new Map(counselingToday.map((c) => [c.id, c]));
  function refreshSchedule() {
    router.refresh();
  }
  const [popup, setPopup] = useState<null | "absent" | "homework" | "vocabRetest">(null);
  const [detail, setDetail] = useState<{
    absentStudents: DailyOutcomeStudent[];
    incompleteHomeworkStudents: DailyOutcomeStudent[];
    vocabRetestStudents: DailyOutcomeStudent[];
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function openPopup(kind: "absent" | "homework" | "vocabRetest") {
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
    popup === "absent"
      ? detail?.absentStudents
      : popup === "homework"
      ? detail?.incompleteHomeworkStudents
      : popup === "vocabRetest"
      ? detail?.vocabRetestStudents
      : undefined;

  // First-row cards (오늘 일정/상담 필요 학생/시험 일정/보강 일정) only show the
  // first PREVIEW_SIZE rows inline — the rest is available via "더보기" so a
  // busy day doesn't blow out the card height and break the 4-up row layout.
  const PREVIEW_SIZE = 4;
  const [listPopup, setListPopup] = useState<null | "schedule" | "counseling" | "exams" | "makeup">(null);

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
        <StatTile
          icon={BookX}
          label="단어 재시험"
          value={`${vocabRetestCount}명`}
          tone="warning"
          onClick={() => openPopup("vocabRetest")}
        />
        <StatTile
          icon={ClipboardX}
          label="미완료 과제"
          value={`${homeworkIncompleteCount}명`}
          tone="warning"
          onClick={() => openPopup("homework")}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ListCard
          title="오늘 일정"
          countLabel={`전체 ${scheduleTotal}건`}
          empty={scheduleTotal === 0}
          action={scheduleTotal > PREVIEW_SIZE ? <MoreButton count={scheduleTotal} onClick={() => setListPopup("schedule")} /> : undefined}
        >
          {scheduleFlat.slice(0, PREVIEW_SIZE).map((item, i) => (
            <ListRow key={i} primary={`${item.studentName} · ${item.label}`} secondary={item.detail} />
          ))}
        </ListCard>

        <ListCard
          title="상담 필요 학생"
          countLabel="상담 30일 이상 공백"
          empty={counselingGapStudents.length === 0}
          action={
            counselingGapStudents.length > PREVIEW_SIZE ? (
              <MoreButton count={counselingGapStudents.length} onClick={() => setListPopup("counseling")} />
            ) : undefined
          }
        >
          {counselingGapStudents.slice(0, PREVIEW_SIZE).map((s) => (
            <ListRow
              key={s.id}
              primary={s.name}
              secondary={`${s.school} ${s.grade ?? ""}`}
              meta={s.lastCounseling ? `마지막 상담 ${s.lastCounseling}` : "상담 이력 없음"}
              tone="warning"
            />
          ))}
        </ListCard>

        <ListCard
          title="시험 일정"
          countLabel="앞으로 21일"
          empty={upcomingExams.length === 0}
          action={upcomingExams.length > PREVIEW_SIZE ? <MoreButton count={upcomingExams.length} onClick={() => setListPopup("exams")} /> : undefined}
        >
          {upcomingExams.slice(0, PREVIEW_SIZE).map((e) => (
            <ListRow
              key={e.studentId + e.examTitle}
              primary={`${e.studentName} · ${e.examTitle}`}
              secondary={`${e.school} ${e.grade ?? ""}`}
              meta={`D-${e.dDay}`}
              tone={e.dDay <= 7 ? "destructive" : "default"}
            />
          ))}
        </ListCard>

        <ListCard
          title="보강 일정"
          countLabel={`오늘 ${makeupToday.length}건`}
          empty={makeupToday.length === 0}
          action={makeupToday.length > PREVIEW_SIZE ? <MoreButton count={makeupToday.length} onClick={() => setListPopup("makeup")} /> : undefined}
        >
          {makeupToday.slice(0, PREVIEW_SIZE).map((item, i) => (
            <ListRow key={i} primary={item.studentName} secondary={item.detail} />
          ))}
        </ListCard>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <TodayClinicCard today={today} initialItems={clinicItems} />

        <div className="director-embed">
          <MakeupStatusCard role={role} variant="embed" />
        </div>
      </div>

      {listPopup && (
        <Popup
          title={
            listPopup === "schedule"
              ? "오늘 일정"
              : listPopup === "counseling"
              ? "상담 필요 학생"
              : listPopup === "exams"
              ? "시험 일정"
              : "보강 일정"
          }
          countLabel={
            listPopup === "schedule"
              ? `${scheduleTotal}건`
              : listPopup === "counseling"
              ? `${counselingGapStudents.length}명`
              : listPopup === "exams"
              ? `${upcomingExams.length}건`
              : `${makeupToday.length}건`
          }
          onClose={() => setListPopup(null)}
        >
          {listPopup === "schedule" &&
            scheduleFlat.map((item, i) => {
              if (item.label === "행정실 문의") {
                const inquiry = inquiryById.get(item.id);
                if (inquiry) return <InquiryEditRow key={item.id} item={inquiry} onChanged={refreshSchedule} />;
              }
              if (item.label === "상담일지") {
                const entry = counselingById.get(item.id);
                if (entry) return <CounselingEditRow key={item.id} item={entry} onChanged={refreshSchedule} />;
              }
              return <ListRow key={i} primary={`${item.studentName} · ${item.label}`} secondary={item.detail} />;
            })}
          {listPopup === "counseling" &&
            counselingGapStudents.map((s) => (
              <ListRow
                key={s.id}
                primary={s.name}
                secondary={`${s.school} ${s.grade ?? ""}`}
                meta={s.lastCounseling ? `마지막 상담 ${s.lastCounseling}` : "상담 이력 없음"}
                tone="warning"
              />
            ))}
          {listPopup === "exams" &&
            upcomingExams.map((e) => (
              <ListRow
                key={e.studentId + e.examTitle}
                primary={`${e.studentName} · ${e.examTitle}`}
                secondary={`${e.school} ${e.grade ?? ""}`}
                meta={`D-${e.dDay}`}
                tone={e.dDay <= 7 ? "destructive" : "default"}
              />
            ))}
          {listPopup === "makeup" &&
            makeupToday.map((item, i) => <ListRow key={i} primary={item.studentName} secondary={item.detail} />)}
        </Popup>
      )}

      {popup && (
        <Popup
          title={popup === "absent" ? "오늘 결석" : popup === "homework" ? "미완료 과제" : "단어 재시험"}
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
