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
import { cn } from "@/lib/utils";

type ScheduleRow = { id: string; label: string; studentName: string; detail: string };
type CategoryBreakdown = { label: string; done: number; total: number };
type ExamRow = {
  studentId: string;
  studentName: string;
  examTitle: string;
  school: string;
  grade: string | null;
  dDay: number;
  examRange: string;
  examDate: string | null;
  teachers: string[];
  progress: number;
  weakPoints: string;
  categories: CategoryBreakdown[];
};
type CounselingGapRow = { id: string; name: string; school: string; grade: string | null; lastCounseling: string | null };
type ClinicTaskRow = {
  id: string;
  studentName: string;
  studentNames: string[];
  assistantName: string;
  content: string;
  nextPrep: string;
  checked: boolean;
};
type MakeupTaskRow = {
  id: string;
  studentName: string;
  time: string;
  memo: string;
  owner: string;
  done: boolean;
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

// ListRow는 순수 표시용(div)이라 그 위에 button을 씌워 클릭 가능하게 만든다
// — 오늘 일정/시험 일정/보강 일정 각 행에서 재사용.
function ClickableRow({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="block w-full bg-transparent p-0 text-left">
      {children}
    </button>
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
  makeupItems,
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
  makeupItems: MakeupTaskRow[];
  inquiriesToday: InquiryItem[];
  counselingToday: CounselingItem[];
  upcomingExams: ExamRow[];
  counselingGapStudents: CounselingGapRow[];
}) {
  const router = useRouter();
  const inquiryById = new Map(inquiriesToday.map((i) => [i.id, i]));
  const counselingById = new Map(counselingToday.map((c) => [c.id, c]));
  function refreshSchedule() {
    router.refresh();
  }
  const [scheduleDetail, setScheduleDetail] = useState<ScheduleRow | null>(null);
  const [examDetail, setExamDetail] = useState<ExamRow | null>(null);
  const [makeupDetail, setMakeupDetail] = useState<MakeupTaskRow | null>(null);
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

      <div className={cn("grid grid-cols-2 gap-3", role === "원장" ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
        {role === "원장" && (
          <StatTile icon={Users} label="전체 학생" value={`${studentsCount}명`} sub={`재원 ${activeStudentsCount}`} />
        )}
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
            <ClickableRow key={i} onClick={() => setScheduleDetail(item)}>
              <ListRow primary={`${item.studentName} · ${item.label}`} secondary={item.detail} />
            </ClickableRow>
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
            <ClickableRow key={e.studentId + e.examTitle} onClick={() => setExamDetail(e)}>
              <ListRow
                primary={`${e.studentName} · ${e.examTitle}`}
                secondary={`${e.school} ${e.grade ?? ""}`}
                meta={`D-${e.dDay}`}
                tone={e.dDay <= 7 ? "destructive" : "default"}
              />
            </ClickableRow>
          ))}
        </ListCard>

        <ListCard
          title="보강 일정"
          countLabel={`오늘 ${makeupItems.length}건`}
          empty={makeupItems.length === 0}
          action={makeupItems.length > PREVIEW_SIZE ? <MoreButton count={makeupItems.length} onClick={() => setListPopup("makeup")} /> : undefined}
        >
          {makeupItems.slice(0, PREVIEW_SIZE).map((item) => (
            <ClickableRow key={item.id} onClick={() => setMakeupDetail(item)}>
              <ListRow primary={item.studentName} secondary={item.time || "시간 미정"} meta={item.owner && item.owner !== "-" ? item.owner : "담당 미배정"} />
            </ClickableRow>
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
              : `${makeupItems.length}건`
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
              return (
                <ClickableRow key={i} onClick={() => setScheduleDetail(item)}>
                  <ListRow primary={`${item.studentName} · ${item.label}`} secondary={item.detail} />
                </ClickableRow>
              );
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
              <ClickableRow key={e.studentId + e.examTitle} onClick={() => setExamDetail(e)}>
                <ListRow
                  primary={`${e.studentName} · ${e.examTitle}`}
                  secondary={`${e.school} ${e.grade ?? ""}`}
                  meta={`D-${e.dDay}`}
                  tone={e.dDay <= 7 ? "destructive" : "default"}
                />
              </ClickableRow>
            ))}
          {listPopup === "makeup" &&
            makeupItems.map((item) => (
              <ClickableRow key={item.id} onClick={() => setMakeupDetail(item)}>
                <ListRow primary={item.studentName} secondary={item.time || "시간 미정"} meta={item.owner && item.owner !== "-" ? item.owner : "담당 미배정"} />
              </ClickableRow>
            ))}
        </Popup>
      )}

      {scheduleDetail && (
        <Popup title={`${scheduleDetail.studentName} · ${scheduleDetail.label}`} onClose={() => setScheduleDetail(null)}>
          <p className="whitespace-pre-wrap text-sm text-foreground">{scheduleDetail.detail || "-"}</p>
        </Popup>
      )}

      {examDetail && (
        <Popup title={`${examDetail.studentName} · ${examDetail.examTitle}`} countLabel={`D-${examDetail.dDay}`} onClose={() => setExamDetail(null)}>
          <div className="space-y-2 text-sm">
            <div className="text-xs text-muted-foreground">
              {examDetail.school} {examDetail.grade ?? ""}
            </div>
            {examDetail.examRange && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">시험범위</span>
                <p className="text-foreground">{examDetail.examRange}</p>
              </div>
            )}
            {examDetail.examDate && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">시험일</span>
                <p className="text-foreground">{examDetail.examDate}</p>
              </div>
            )}
            <div>
              <span className="text-xs font-medium text-muted-foreground">담당교사</span>
              <p className="text-foreground">{examDetail.teachers.length > 0 ? examDetail.teachers.join(", ") : "-"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">진행률</span>
              <p className="text-foreground">{examDetail.progress}%</p>
            </div>
            {examDetail.categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {examDetail.categories.map((c) => (
                  <span key={c.label} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">
                    {c.label} {c.done}/{c.total}
                  </span>
                ))}
              </div>
            )}
            {examDetail.weakPoints && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">취약부분</span>
                <p className="whitespace-pre-wrap text-foreground">{examDetail.weakPoints}</p>
              </div>
            )}
          </div>
        </Popup>
      )}

      {makeupDetail && (
        <Popup title={`${makeupDetail.studentName} · 보강`} onClose={() => setMakeupDetail(null)}>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-xs font-medium text-muted-foreground">담당자</span>
              <p className="text-foreground">{makeupDetail.owner && makeupDetail.owner !== "-" ? makeupDetail.owner : "미배정"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">시간</span>
              <p className="text-foreground">{makeupDetail.time || "미정"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">완료 여부</span>
              <p className="text-foreground">{makeupDetail.done ? "완료" : "예정"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">메모</span>
              <p className="whitespace-pre-wrap text-foreground">{makeupDetail.memo || "메모가 없습니다."}</p>
            </div>
          </div>
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
