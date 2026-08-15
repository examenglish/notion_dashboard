"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, CheckCircle2, XCircle, BookX, ClipboardX } from "lucide-react";
import StatTile from "./StatTile";
import ListCard, { ListRow } from "./ListCard";
import Popup from "./Popup";
import NaturalLanguageInput from "@/components/NaturalLanguageInput";
import StaffPicker from "@/components/StaffPicker";
import MakeupStatusCard from "@/components/MakeupStatusCard";
import TodayClinicCard from "./TodayClinicCard";
import { InquiryEditRow, CounselingEditRow, type InquiryItem, type CounselingItem } from "./EditableScheduleRow";
import type { DailyOutcomeStudent } from "@/lib/notion";
import { cn } from "@/lib/utils";

type ScheduleRow = {
  id: string;
  label: string;
  kind: "todo" | "student" | "counseling" | "inquiry";
  studentName: string;
  detail: string;
  time: string | null;
  memo: string | null;
  owner: string | null;
};
type UrgentRow = {
  id: string;
  date: string | null;
  studentId: string | null;
  studentName: string;
  school: string;
  grade: string | null;
  content: string;
  owner: string;
  enteredBy: string;
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
  staffName,
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
  urgentCounseling,
  counselingGapStudents,
}: {
  today: string;
  role: string;
  staffName: string;
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
  urgentCounseling: UrgentRow[];
  counselingGapStudents: CounselingGapRow[];
}) {
  const router = useRouter();
  const inquiryById = new Map(inquiriesToday.map((i) => [i.id, i]));
  const counselingById = new Map(counselingToday.map((c) => [c.id, c]));
  function refreshSchedule() {
    router.refresh();
  }

  // 오늘 일정 한 줄을 kind별로 알맞은 형태로 그린다 — 상담일지/행정실 문의는
  // 이미 있는 인라인 수정 폼을 그대로 쓰고, 그 외(todo/student)는 클릭하면
  // scheduleDetail 팝업에서 보거나(student) 수정·삭제한다(todo). 미리보기
  // 카드와 "더보기" 팝업이 완전히 같은 목록을 다른 개수로 보여줄 뿐이라
  // 렌더링 로직을 하나로 합쳐 둘이 어긋나지 않게 한다.
  function renderScheduleItem(item: ScheduleRow, key: string | number) {
    if (item.kind === "inquiry") {
      const inquiry = inquiryById.get(item.id);
      if (inquiry) {
        return <InquiryEditRow key={item.id} item={inquiry} staffName={staffName} staffRole={role} onChanged={refreshSchedule} />;
      }
    }
    if (item.kind === "counseling") {
      const entry = counselingById.get(item.id);
      if (entry) {
        return <CounselingEditRow key={item.id} item={entry} staffName={staffName} staffRole={role} onChanged={refreshSchedule} />;
      }
    }
    return (
      <ClickableRow key={key} onClick={() => setScheduleDetail(item)}>
        <ListRow primary={`${item.studentName} · ${item.label}`} secondary={item.detail} />
      </ClickableRow>
    );
  }

  const [scheduleDetail, setScheduleDetail] = useState<ScheduleRow | null>(null);
  const [scheduleTimeDraft, setScheduleTimeDraft] = useState("");
  const [scheduleMemoDraft, setScheduleMemoDraft] = useState("");
  const [scheduleOwnerDraft, setScheduleOwnerDraft] = useState("");
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleDeleting, setScheduleDeleting] = useState(false);
  const [scheduleEditError, setScheduleEditError] = useState<string | null>(null);
  useEffect(() => {
    setScheduleTimeDraft(scheduleDetail?.time ?? "");
    setScheduleMemoDraft(scheduleDetail?.memo ?? "");
    setScheduleOwnerDraft(scheduleDetail?.owner && scheduleDetail.owner !== "-" ? scheduleDetail.owner : "");
    setScheduleEditError(null);
  }, [scheduleDetail]);

  async function saveScheduleItem() {
    if (!scheduleDetail) return;
    setScheduleSaving(true);
    setScheduleEditError(null);
    try {
      const res = await fetch(`/api/schedule-entry/${scheduleDetail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time: scheduleTimeDraft, note: scheduleMemoDraft, ownerName: scheduleOwnerDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setScheduleEditError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setScheduleDetail(null);
      router.refresh();
    } finally {
      setScheduleSaving(false);
    }
  }

  async function deleteScheduleItem() {
    if (!scheduleDetail) return;
    if (!window.confirm(`${scheduleDetail.studentName} 학생의 ${scheduleDetail.label} 항목을 삭제하시겠습니까?`)) return;
    setScheduleDeleting(true);
    setScheduleEditError(null);
    try {
      const res = await fetch(`/api/schedule-entry/${scheduleDetail.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setScheduleEditError(data.error ?? "삭제에 실패했습니다.");
        return;
      }
      setScheduleDetail(null);
      router.refresh();
    } finally {
      setScheduleDeleting(false);
    }
  }
  const [urgentDetail, setUrgentDetail] = useState<UrgentRow | null>(null);
  const [urgentActing, setUrgentActing] = useState(false);
  const [urgentError, setUrgentError] = useState<string | null>(null);

  async function completeUrgent() {
    if (!urgentDetail) return;
    if (!window.confirm(`${urgentDetail.studentName} 학생의 긴급상담을 완료 처리하시겠습니까? 학생 전체기록의 상담 기록에 남습니다.`)) return;
    setUrgentActing(true);
    setUrgentError(null);
    try {
      const res = await fetch(`/api/urgent-counseling/${urgentDetail.id}/complete`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUrgentError(data.error ?? "완료 처리에 실패했습니다.");
        return;
      }
      setUrgentDetail(null);
      router.refresh();
    } finally {
      setUrgentActing(false);
    }
  }

  async function deleteUrgent() {
    if (!urgentDetail) return;
    if (!window.confirm(`${urgentDetail.studentName} 학생의 긴급상담 요청을 삭제하시겠습니까?`)) return;
    setUrgentActing(true);
    setUrgentError(null);
    try {
      const res = await fetch(`/api/admin-inbox/${urgentDetail.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUrgentError(data.error ?? "삭제에 실패했습니다.");
        return;
      }
      setUrgentDetail(null);
      router.refresh();
    } finally {
      setUrgentActing(false);
    }
  }
  const [makeupDetail, setMakeupDetail] = useState<MakeupTaskRow | null>(null);
  const [makeupOwnerDraft, setMakeupOwnerDraft] = useState("");
  const [makeupOwnerSaving, setMakeupOwnerSaving] = useState(false);
  const [makeupOwnerError, setMakeupOwnerError] = useState<string | null>(null);
  useEffect(() => {
    setMakeupOwnerDraft(makeupDetail?.owner && makeupDetail.owner !== "-" ? makeupDetail.owner : "");
    setMakeupOwnerError(null);
  }, [makeupDetail]);

  async function saveMakeupOwner() {
    if (!makeupDetail) return;
    setMakeupOwnerSaving(true);
    setMakeupOwnerError(null);
    try {
      const res = await fetch(`/api/schedule-entry/${makeupDetail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerName: makeupOwnerDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMakeupOwnerError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setMakeupDetail((prev) => (prev ? { ...prev, owner: makeupOwnerDraft || "-" } : prev));
      router.refresh();
    } finally {
      setMakeupOwnerSaving(false);
    }
  }
  const [popup, setPopup] = useState<null | "absent" | "homework" | "vocabRetest" | "attendance">(null);
  const [detail, setDetail] = useState<{
    absentStudents: DailyOutcomeStudent[];
    incompleteHomeworkStudents: DailyOutcomeStudent[];
    vocabRetestStudents: DailyOutcomeStudent[];
    attendedStudents: DailyOutcomeStudent[];
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function openPopup(kind: "absent" | "homework" | "vocabRetest" | "attendance") {
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
      : popup === "attendance"
      ? detail?.attendedStudents
      : undefined;

  // First-row cards (오늘 일정/상담 필요 학생/시험 일정/보강 일정) only show the
  // first PREVIEW_SIZE rows inline — the rest is available via "더보기" so a
  // busy day doesn't blow out the card height and break the 4-up row layout.
  const PREVIEW_SIZE = 4;
  const [listPopup, setListPopup] = useState<null | "schedule" | "counseling" | "urgent" | "makeup">(null);

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
          onClick={() => openPopup("attendance")}
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
          {scheduleFlat.slice(0, PREVIEW_SIZE).map((item, i) => renderScheduleItem(item, i))}
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
          title="긴급상담"
          countLabel="처리 안 된 건"
          empty={urgentCounseling.length === 0}
          action={
            urgentCounseling.length > PREVIEW_SIZE ? (
              <MoreButton count={urgentCounseling.length} onClick={() => setListPopup("urgent")} />
            ) : undefined
          }
        >
          {urgentCounseling.slice(0, PREVIEW_SIZE).map((u) => (
            <ClickableRow key={u.id} onClick={() => setUrgentDetail(u)}>
              <ListRow
                primary={u.studentName}
                secondary={`${u.school} ${u.grade ?? ""}`}
                meta={u.date ?? ""}
                tone="destructive"
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
              : listPopup === "urgent"
              ? "긴급상담"
              : "보강 일정"
          }
          countLabel={
            listPopup === "schedule"
              ? `${scheduleTotal}건`
              : listPopup === "counseling"
              ? `${counselingGapStudents.length}명`
              : listPopup === "urgent"
              ? `${urgentCounseling.length}건`
              : `${makeupItems.length}건`
          }
          onClose={() => setListPopup(null)}
        >
          {listPopup === "schedule" && scheduleFlat.map((item, i) => renderScheduleItem(item, i))}
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
          {listPopup === "urgent" &&
            urgentCounseling.map((u) => (
              <ClickableRow key={u.id} onClick={() => setUrgentDetail(u)}>
                <ListRow primary={u.studentName} secondary={`${u.school} ${u.grade ?? ""}`} meta={u.date ?? ""} tone="destructive" />
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

      {scheduleDetail && scheduleDetail.kind !== "todo" && (
        <Popup title={`${scheduleDetail.studentName} · ${scheduleDetail.label}`} onClose={() => setScheduleDetail(null)}>
          <p className="whitespace-pre-wrap text-sm text-foreground">{scheduleDetail.detail || "-"}</p>
        </Popup>
      )}

      {scheduleDetail && scheduleDetail.kind === "todo" && (
        <Popup title={`${scheduleDetail.studentName} · ${scheduleDetail.label}`} onClose={() => setScheduleDetail(null)}>
          <div className="space-y-2 text-sm">
            <div>
              <label className="text-xs font-medium text-muted-foreground">시간</label>
              <input
                type="text"
                placeholder="예: 16:30"
                value={scheduleTimeDraft}
                onChange={(e) => setScheduleTimeDraft(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">메모</label>
              <textarea value={scheduleMemoDraft} onChange={(e) => setScheduleMemoDraft(e.target.value)} style={{ minHeight: 60 }} />
            </div>
            <StaffPicker value={scheduleOwnerDraft} onChange={setScheduleOwnerDraft} label="담당자" />
            {scheduleEditError && <p className="error-text text-xs">{scheduleEditError}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" disabled={scheduleSaving} onClick={saveScheduleItem}>
                {scheduleSaving ? "저장 중..." : "저장"}
              </button>
              {(role === "원장" || role === "행정") && (
                <button type="button" className="secondary" disabled={scheduleDeleting} onClick={deleteScheduleItem}>
                  {scheduleDeleting ? "삭제 중..." : "삭제"}
                </button>
              )}
            </div>
          </div>
        </Popup>
      )}

      {urgentDetail && (
        <Popup title={`${urgentDetail.studentName} · 긴급상담`} countLabel={urgentDetail.date ?? undefined} onClose={() => setUrgentDetail(null)}>
          <div className="space-y-2 text-sm">
            <div className="text-xs text-muted-foreground">
              {urgentDetail.school} {urgentDetail.grade ?? ""}
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">담당자</span>
              <p className="text-foreground">{urgentDetail.owner || "미배정"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">내용</span>
              <p className="whitespace-pre-wrap text-foreground">{urgentDetail.content || "-"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">입력자</span>
              <p className="text-foreground">{urgentDetail.enteredBy || "-"}</p>
            </div>
            {urgentError && <p className="error-text text-xs">{urgentError}</p>}
            {role === "원장" && (
              <div className="flex gap-2 pt-1">
                <button type="button" disabled={urgentActing} onClick={completeUrgent}>
                  {urgentActing ? "처리 중..." : "완료 처리"}
                </button>
                <button type="button" className="secondary" disabled={urgentActing} onClick={deleteUrgent}>
                  {urgentActing ? "처리 중..." : "삭제"}
                </button>
              </div>
            )}
          </div>
        </Popup>
      )}

      {makeupDetail && (
        <Popup title={`${makeupDetail.studentName} · 보강`} onClose={() => setMakeupDetail(null)}>
          <div className="space-y-2 text-sm">
            <div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <StaffPicker value={makeupOwnerDraft} onChange={setMakeupOwnerDraft} label="담당자" />
                </div>
                <button
                  type="button"
                  disabled={makeupOwnerSaving || makeupOwnerDraft === (makeupDetail.owner === "-" ? "" : makeupDetail.owner)}
                  onClick={saveMakeupOwner}
                >
                  {makeupOwnerSaving ? "저장 중..." : "저장"}
                </button>
              </div>
              {makeupOwnerError && <p className="error-text mt-1 text-xs">{makeupOwnerError}</p>}
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
          title={
            popup === "absent" ? "오늘 결석" : popup === "homework" ? "미완료 과제" : popup === "attendance" ? "오늘 출석" : "단어 재시험"
          }
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
                meta={s.status}
              />
            ))}
        </Popup>
      )}
    </>
  );
}
