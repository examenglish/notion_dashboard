"use client";

import { useState } from "react";
import StudentPicker from "./StudentPicker";
import StaffPicker from "./StaffPicker";
import { todayKST } from "@/lib/date";

export type QuickScheduleKind =
  | "alarms"
  | "newStudentEvents"
  | "firstDays"
  | "makeupClasses"
  | "retests"
  | "clinicTasks"
  | "personalTodos";

export const QUICK_SCHEDULE_KIND_OPTIONS: { value: QuickScheduleKind; label: string }[] = [
  { value: "makeupClasses", label: "보강" },
  { value: "retests", label: "재시" },
  { value: "newStudentEvents", label: "신입생 상담/레벨테스트" },
  { value: "clinicTasks", label: "클리닉" },
  { value: "firstDays", label: "신입생 첫등원" },
  { value: "alarms", label: "학습레벨/조치사항" },
  { value: "personalTodos", label: "개인 할일" },
];

// 대시보드 "오늘의 일정"의 빠른 등록(ScheduleQuickAddModal)과 입력 페이지의
// 일정 등록 카드가 여기 한 곳의 필드/저장 로직을 공유한다 — 두 화면이 서로
// 다르게 동작하며 어긋나는 일을 원천적으로 막기 위함. kind를 고정해서
// 넘기면(lockedKind) 유형 선택 없이 그 한 종류만 등록하는 모달용 폼이 되고,
// 비워두면 입력 페이지처럼 유형을 직접 골라 등록하는 독립 폼이 된다.
export default function QuickScheduleForm({
  lockedKind,
  initialDate,
  onSaved,
}: {
  lockedKind?: QuickScheduleKind;
  initialDate?: string;
  onSaved?: (date: string) => void;
}) {
  const [kind, setKind] = useState<QuickScheduleKind>(lockedKind ?? "makeupClasses");
  const isAlarm = kind === "alarms";
  const isFirstDay = kind === "firstDays";
  const isNewStudentEvent = kind === "newStudentEvents";
  const isPersonal = kind === "personalTodos";
  const isTodo = !isAlarm && !isFirstDay && !isPersonal;

  const baseDate = initialDate ?? todayKST();
  const [studentId, setStudentId] = useState("");
  const [subType, setSubType] = useState("신입생상담");
  const [content, setContent] = useState("");
  const [counselor, setCounselor] = useState("");
  const [alarmDate, setAlarmDate] = useState(baseDate);
  const [enrolledAt, setEnrolledAt] = useState(baseDate);
  const [todoDate, setTodoDate] = useState(baseDate);
  const [time, setTime] = useState("");
  const [owner, setOwner] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todoType = isNewStudentEvent
    ? subType
    : kind === "makeupClasses"
    ? "보강"
    : kind === "clinicTasks"
    ? "클리닉"
    : "재시";

  function resetFields() {
    setStudentId("");
    setContent("");
    setCounselor("");
    setTime("");
    setOwner("");
    setNote("");
  }

  async function handleSave() {
    if ((isAlarm || isFirstDay) && !studentId) {
      setError("학생을 선택해 주세요.");
      return;
    }
    if (isPersonal && !content.trim()) {
      setError("내용을 입력해 주세요.");
      return;
    }
    if (!window.confirm("등록하시겠습니까?")) return;
    setError(null);
    setDone(false);
    setSaving(true);
    try {
      let res: Response;
      let savedDate = todoDate;
      if (isAlarm) {
        savedDate = alarmDate;
        res = await fetch("/api/student-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId, action: content, actionOwner: counselor, actionAlarmDate: alarmDate }),
        });
      } else if (isFirstDay) {
        savedDate = enrolledAt;
        res = await fetch("/api/student-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId, enrolledAt }),
        });
      } else if (isPersonal) {
        savedDate = todoDate;
        res = await fetch("/api/personal-todo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, date: todoDate }),
        });
      } else {
        savedDate = todoDate;
        res = await fetch("/api/schedule-entry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: todoType, studentId: studentId || null, date: todoDate, time, note, ownerName: owner }),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setDone(true);
      resetFields();
      onSaved?.(savedDate);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {!lockedKind && (
        <>
          <label htmlFor="quickKind">유형</label>
          <select
            id="quickKind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as QuickScheduleKind);
              setError(null);
              setDone(false);
            }}
          >
            {QUICK_SCHEDULE_KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </>
      )}

      {!isPersonal && <StudentPicker studentId={studentId} onChange={setStudentId} allowEmpty={isTodo} />}

      {isPersonal && (
        <>
          <label htmlFor="quickPersonalContent">내용</label>
          <textarea
            id="quickPersonalContent"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="예: 문법책 재고 주문하기"
          />
          <label htmlFor="quickPersonalDate">날짜</label>
          <input id="quickPersonalDate" type="date" value={todoDate} onChange={(e) => setTodoDate(e.target.value)} />
        </>
      )}

      {isNewStudentEvent && (
        <>
          <label htmlFor="quickSubType">세부유형</label>
          <select id="quickSubType" value={subType} onChange={(e) => setSubType(e.target.value)}>
            <option value="신입생상담">신입생상담</option>
            <option value="레벨체크">레벨체크</option>
          </select>
        </>
      )}

      {isAlarm && (
        <>
          <label htmlFor="quickAlarmContent">조치사항</label>
          <textarea id="quickAlarmContent" value={content} onChange={(e) => setContent(e.target.value)} />
          <StaffPicker value={counselor} onChange={setCounselor} label="담당자" />
          <label htmlFor="quickAlarmDate">알람일</label>
          <input id="quickAlarmDate" type="date" value={alarmDate} onChange={(e) => setAlarmDate(e.target.value)} />
        </>
      )}

      {isFirstDay && (
        <>
          <label htmlFor="quickEnrolledAt">등원일</label>
          <input id="quickEnrolledAt" type="date" value={enrolledAt} onChange={(e) => setEnrolledAt(e.target.value)} />
        </>
      )}

      {isTodo && (
        <>
          <label htmlFor="quickTodoDate">예정일</label>
          <input id="quickTodoDate" type="date" value={todoDate} onChange={(e) => setTodoDate(e.target.value)} />
          <label htmlFor="quickTodoTime">시간</label>
          <input
            id="quickTodoTime"
            type="text"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="예: 16:00"
          />
          <StaffPicker value={owner} onChange={setOwner} label="담당자" date={todoDate} time={time} />
          <label htmlFor="quickTodoNote">메모</label>
          <textarea id="quickTodoNote" value={note} onChange={(e) => setNote(e.target.value)} />
        </>
      )}

      {error && <p className="error-text">{error}</p>}
      {done && (
        <p className="success-box" style={{ marginTop: 12 }}>
          저장됐습니다.
        </p>
      )}

      <div style={{ marginTop: 16 }}>
        <button type="button" disabled={saving} onClick={handleSave}>
          {saving ? "저장 중..." : "등록"}
        </button>
      </div>
    </div>
  );
}
