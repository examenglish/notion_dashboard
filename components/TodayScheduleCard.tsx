"use client";

import { useEffect, useRef, useState } from "react";
import { todayKST } from "@/lib/date";
import StaffPicker from "./StaffPicker";
import StudentPicker from "./StudentPicker";
import CounselingEditModal, { CounselingRecord } from "./CounselingEditModal";
import AdminInboxDetailModal, { AdminInboxRecord } from "./AdminInboxDetailModal";

type AlarmItem = { id: string; studentName: string; school: string; content: string; counselor: string };
type FirstDayItem = {
  id: string;
  studentName: string;
  school: string;
  gradeNum: string;
  classDays: string[];
  classTime: string;
};
type TodoItem = {
  id: string;
  title: string;
  time: string;
  memo?: string;
  studentName: string;
  school: string;
  gradeNum: string;
  owner: string;
  done: boolean;
};
type CounselingBrief = {
  id: string;
  date: string | null;
  studentId: string | null;
  studentName: string;
  school: string;
  grade: string | null;
  gradeNum: string;
  counselor: string;
  transcript: string;
  content: string;
  followUp: string;
  enteredBy?: string;
};
type InquiryBrief = {
  id: string;
  date: string | null;
  endDate: string | null;
  studentId: string | null;
  studentName: string;
  school: string;
  grade: string | null;
  gradeNum: string;
  type: string | null;
  content: string;
  done: boolean;
  owner: string;
  enteredBy?: string;
};

type Schedule = {
  alarms: AlarmItem[];
  firstDays: FirstDayItem[];
  newStudentEvents: TodoItem[];
  makeupClasses: TodoItem[];
  retests: TodoItem[];
  clinicTasks: TodoItem[];
  reviewTasks: TodoItem[];
  counseling: CounselingBrief[];
  inquiries: InquiryBrief[];
};

type SectionKey = keyof Schedule;

// 조교 클리닉/보강/재시/신입생상담은 DB⑱할일관리 기반이라 공용 수정·빠른등록
// 모달(ScheduleEditModal/ScheduleQuickAddModal)을 그대로 재사용한다. 상담일지와
// 행정실 문의는 새 항목을 만드는 전용 폼(상담일지 등록/결석예정 등)이 따로
// 있으므로 여기서는 "빠른등록"만 숨기고, 클릭하면 대시보드와 동일한 상세
// 모달(CounselingEditModal/AdminInboxDetailModal)이 열려 수정권한이 있는
// 사람은 바로 내용을 고칠 수 있다.
const SECTION_META: { key: SectionKey; title: string; readOnly?: boolean }[] = [
  { key: "alarms", title: "학습레벨/조치사항" },
  { key: "newStudentEvents", title: "신입생 상담 및 레벨테스트" },
  { key: "firstDays", title: "신입생 첫등원" },
  { key: "makeupClasses", title: "보강" },
  { key: "retests", title: "재시" },
  { key: "clinicTasks", title: "클리닉" },
  // 복습은 "오늘 수업 기록" 저장 시 복습 주기(일)에 맞춰 자동 생성되므로
  // 여기서 수동으로 새로 만들 필요는 없지만(글쓰기 버튼 숨김), 완료 체크나
  // 예정일 수정은 다른 TODO 섹션과 동일하게 가능하다.
  { key: "reviewTasks", title: "복습", readOnly: true },
  { key: "counseling", title: "상담일지", readOnly: true },
  { key: "inquiries", title: "행정실 문의", readOnly: true },
];

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// Pure calendar-date arithmetic (via Date.UTC) so this never depends on the
// browser's or server's local timezone — only on the Y/M/D digits themselves.
function parts(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d };
}

function formatLabel(dateStr: string) {
  const { y, m, d } = parts(dateStr);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일(${weekday})`;
}

function shiftDate(dateStr: string, delta: number) {
  const { y, m, d } = parts(dateStr);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function schoolGrade(school: string, gradeNum: string) {
  const s = school || "학교미상";
  return gradeNum ? `${s}(${gradeNum})` : s;
}

// Shared date-keyed cache so the 5 independently-navigable sections and the
// 더보기 popup can all reuse one fetch per distinct date instead of
// re-requesting the whole schedule every time any single section moves.
function useScheduleCache() {
  const [cache, setCache] = useState<Record<string, Schedule>>({});
  const requested = useRef<Set<string>>(new Set());

  function ensureDate(date: string) {
    if (requested.current.has(date)) return;
    requested.current.add(date);
    fetch(`/api/today-schedule?date=${date}`)
      .then((r) => r.json())
      .then((data: Schedule) => setCache((c) => ({ ...c, [date]: data })));
  }

  // Force a fresh fetch for a date whose content just changed (edit/complete),
  // regardless of whether it was already cached.
  function refetchDate(date: string) {
    requested.current.add(date);
    fetch(`/api/today-schedule?date=${date}`)
      .then((r) => r.json())
      .then((data: Schedule) => setCache((c) => ({ ...c, [date]: data })));
  }

  // Marks an item done in place instead of removing it — checking the box
  // no longer drops the item out of "오늘의 일정" (reverted per request; it
  // stays visible, shown as completed).
  function markDone(date: string, key: SectionKey, id: string) {
    setCache((c) => {
      const sched = c[date];
      if (!sched) return c;
      return {
        ...c,
        [date]: {
          ...sched,
          [key]: (sched[key] as any[]).map((it) => (it.id === id ? { ...it, done: true } : it)),
        },
      };
    });
  }

  return { cache, ensureDate, refetchDate, markDone };
}

function DateNav({ date, onShift, onToday }: { date: string; onShift: (delta: number) => void; onToday: () => void }) {
  return (
    <div className="date-nav" style={{ margin: "6px 0", fontSize: 13 }}>
      <button type="button" className="secondary date-nav-arrow" onClick={() => onShift(-1)}>◀</button>
      <strong>{formatLabel(date)}</strong>
      <button type="button" className="secondary date-nav-arrow" onClick={() => onShift(1)}>▶</button>
      {date !== todayKST() && (
        <button type="button" className="secondary date-nav-today" onClick={onToday}>오늘</button>
      )}
    </div>
  );
}

function ScheduleSectionCard({
  meta,
  date,
  items,
  loading,
  onShift,
  onToday,
  onMore,
  onQuickAdd,
  render,
}: {
  meta: { key: SectionKey; title: string; readOnly?: boolean };
  date: string;
  items: any[];
  loading: boolean;
  onShift: (delta: number) => void;
  onToday: () => void;
  onMore: () => void;
  onQuickAdd?: () => void;
  render: (item: any) => React.ReactNode;
}) {
  const visible = items.slice(0, 5);
  return (
    <div className="card">
      <div className="schedule-section-title">
        <span>
          {meta.title} <span className="muted">({items.length})</span>
        </span>
        {!meta.readOnly && onQuickAdd && (
          <button type="button" className="secondary schedule-quickadd-btn" onClick={onQuickAdd}>
            ✏️ 글쓰기
          </button>
        )}
      </div>
      <DateNav date={date} onShift={onShift} onToday={onToday} />
      {loading ? (
        <p className="muted">불러오는 중...</p>
      ) : items.length === 0 ? (
        <p className="muted" style={{ margin: "4px 0 0" }}>없음</p>
      ) : (
        <ul className="schedule-list">
          {visible.map((item, i) => (
            <li key={item.id ?? i}>{render(item)}</li>
          ))}
        </ul>
      )}
      {!loading && (
        <button type="button" className="secondary schedule-more-btn" onClick={onMore}>
          더보기
        </button>
      )}
    </div>
  );
}

function SchedulePopup({
  meta,
  date,
  items,
  loading,
  onShift,
  onToday,
  onClose,
  onQuickAdd,
  render,
}: {
  meta: { key: SectionKey; title: string; readOnly?: boolean };
  date: string;
  items: any[];
  loading: boolean;
  onShift: (delta: number) => void;
  onToday: () => void;
  onClose: () => void;
  onQuickAdd?: () => void;
  render: (item: any) => React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {meta.title} <span className="muted">({items.length})</span>
          </h2>
          <div style={{ display: "flex", gap: 8 }}>
            {!meta.readOnly && onQuickAdd && (
              <button type="button" className="secondary" onClick={onQuickAdd}>✏️ 글쓰기</button>
            )}
            <button type="button" className="secondary" onClick={onClose}>닫기</button>
          </div>
        </div>
        <DateNav date={date} onShift={onShift} onToday={onToday} />
        {loading ? (
          <p className="muted">불러오는 중...</p>
        ) : items.length === 0 ? (
          <p className="muted">없음</p>
        ) : (
          <ul className="schedule-list">
            {items.map((item, i) => (
              <li key={item.id ?? i}>{render(item)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type EditTarget = { kind: SectionKey; item: AlarmItem | FirstDayItem | TodoItem; date: string };

function ScheduleEditModal({
  target,
  onClose,
  onSaved,
}: {
  target: EditTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isAlarm = target.kind === "alarms";
  const isFirstDay = target.kind === "firstDays";
  const isTodo = !isAlarm && !isFirstDay;

  const alarmItem = target.item as AlarmItem;
  const todoItem = target.item as TodoItem;

  const [content, setContent] = useState(isAlarm ? alarmItem.content : "");
  const [counselor, setCounselor] = useState(isAlarm ? alarmItem.counselor : "");
  const [alarmDate, setAlarmDate] = useState(target.date);
  const [enrolledAt, setEnrolledAt] = useState(target.date);
  const [time, setTime] = useState(isTodo ? todoItem.time : "");
  const [owner, setOwner] = useState(isTodo && todoItem.owner !== "-" ? todoItem.owner : "");
  const [todoDate, setTodoDate] = useState(target.date);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!window.confirm("수정하시겠습니까?")) return;
    setError(null);
    setSaving(true);
    try {
      let res: Response;
      if (isAlarm) {
        res = await fetch("/api/student-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: target.item.id,
            action: content,
            actionOwner: counselor,
            actionAlarmDate: alarmDate,
          }),
        });
      } else if (isFirstDay) {
        res = await fetch("/api/student-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId: target.item.id, enrolledAt }),
        });
      } else {
        res = await fetch(`/api/schedule-entry/${target.item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: todoDate, time, ownerName: owner }),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const name = "studentName" in target.item ? target.item.studentName : "";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{name} 수정</h2>
          <button type="button" className="secondary" onClick={onClose}>닫기</button>
        </div>

        {isAlarm && (
          <>
            <label htmlFor="editAlarmContent">조치사항</label>
            <textarea id="editAlarmContent" value={content} onChange={(e) => setContent(e.target.value)} />
            <StaffPicker value={counselor} onChange={setCounselor} label="담당자" />
            <label htmlFor="editAlarmDate">알람일</label>
            <input id="editAlarmDate" type="date" value={alarmDate} onChange={(e) => setAlarmDate(e.target.value)} />
          </>
        )}

        {isFirstDay && (
          <>
            <label htmlFor="editEnrolledAt">등원일</label>
            <input id="editEnrolledAt" type="date" value={enrolledAt} onChange={(e) => setEnrolledAt(e.target.value)} />
          </>
        )}

        {isTodo && (
          <>
            <label htmlFor="editTodoDate">예정일</label>
            <input id="editTodoDate" type="date" value={todoDate} onChange={(e) => setTodoDate(e.target.value)} />
            <label htmlFor="editTodoTime">시간</label>
            <input
              id="editTodoTime"
              type="text"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="예: 16:00"
            />
            <StaffPicker value={owner} onChange={setOwner} label="담당자" />
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        <div style={{ marginTop: 16 }}>
          <button type="button" disabled={saving} onClick={handleSave}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// "클리닉" 섹션은 목록에 학생명/시간/담당조교만 보여주고, 지시사항(메모)처럼
// 길이가 들쭉날쭉한 내용은 "더보기" 클릭 시 팝업으로만 노출해 목록 카드가
// 메모 길이에 따라 틀어지지 않게 한다.
function ClinicTaskDetailModal({ item, onClose }: { item: TodoItem; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{item.studentName} 클리닉</h2>
          <button type="button" className="secondary" onClick={onClose}>닫기</button>
        </div>
        <p className="muted">{schoolGrade(item.school, item.gradeNum)}</p>
        <p className="muted">
          {item.time || "시간 미정"} · 담당조교: {item.owner}
        </p>
        <label>지시사항</label>
        <p style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{item.memo || "-"}</p>
      </div>
    </div>
  );
}

type QuickAddTarget = { kind: SectionKey; date: string };

// Lets staff add a new 오늘의 일정 item without leaving the dashboard for
// the /input page — mirrors ScheduleEditModal's field layout per section
// kind, but POSTs a new record instead of PATCHing an existing one.
function ScheduleQuickAddModal({
  target,
  onClose,
  onSaved,
}: {
  target: QuickAddTarget;
  onClose: () => void;
  onSaved: (date: string) => void;
}) {
  const isAlarm = target.kind === "alarms";
  const isFirstDay = target.kind === "firstDays";
  const isNewStudentEvent = target.kind === "newStudentEvents";
  const isTodo = !isAlarm && !isFirstDay;

  const [studentId, setStudentId] = useState("");
  const [subType, setSubType] = useState("신입생상담");
  const [content, setContent] = useState("");
  const [counselor, setCounselor] = useState("");
  const [alarmDate, setAlarmDate] = useState(target.date);
  const [enrolledAt, setEnrolledAt] = useState(target.date);
  const [todoDate, setTodoDate] = useState(target.date);
  const [time, setTime] = useState("");
  const [owner, setOwner] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todoType = isNewStudentEvent
    ? subType
    : target.kind === "makeupClasses"
    ? "보강"
    : target.kind === "clinicTasks"
    ? "클리닉"
    : target.kind === "reviewTasks"
    ? "복습"
    : "재시";

  async function handleSave() {
    if ((isAlarm || isFirstDay) && !studentId) {
      setError("학생을 선택해 주세요.");
      return;
    }
    if (!window.confirm("등록하시겠습니까?")) return;
    setError(null);
    setSaving(true);
    try {
      let res: Response;
      let savedDate = target.date;
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
      onSaved(savedDate);
      onClose();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const title = SECTION_META.find((m) => m.key === target.kind)?.title ?? "";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title} 빠른 등록</h2>
          <button type="button" className="secondary" onClick={onClose}>닫기</button>
        </div>

        <StudentPicker studentId={studentId} onChange={setStudentId} allowEmpty={isTodo} />

        {isNewStudentEvent && (
          <>
            <label htmlFor="quickSubType">유형</label>
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
            <StaffPicker value={owner} onChange={setOwner} label="담당자" />
            <label htmlFor="quickTodoNote">메모</label>
            <textarea id="quickTodoNote" value={note} onChange={(e) => setNote(e.target.value)} />
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        <div style={{ marginTop: 16 }}>
          <button type="button" disabled={saving} onClick={handleSave}>
            {saving ? "저장 중..." : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TodayScheduleCard({ staffName }: { staffName: string | null }) {
  const { cache, ensureDate, refetchDate, markDone } = useScheduleCache();
  const [viewingCounseling, setViewingCounseling] = useState<{ item: CounselingBrief; date: string } | null>(null);
  const [viewingInquiry, setViewingInquiry] = useState<{ item: InquiryBrief; date: string } | null>(null);
  const [viewingClinicTask, setViewingClinicTask] = useState<TodoItem | null>(null);

  function canEdit(enteredBy?: string) {
    return !enteredBy || enteredBy === staffName;
  }
  const [dates, setDates] = useState<Record<SectionKey, string>>(() => {
    const t = todayKST();
    return {
      alarms: t,
      newStudentEvents: t,
      firstDays: t,
      makeupClasses: t,
      retests: t,
      clinicTasks: t,
      reviewTasks: t,
      counseling: t,
      inquiries: t,
    };
  });
  const [popup, setPopup] = useState<{ key: SectionKey; date: string } | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [quickAdd, setQuickAdd] = useState<QuickAddTarget | null>(null);

  useEffect(() => {
    Object.values(dates).forEach(ensureDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates]);

  useEffect(() => {
    if (popup) ensureDate(popup.date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup?.date]);

  function shiftSection(key: SectionKey, delta: number) {
    setDates((cur) => ({ ...cur, [key]: shiftDate(cur[key], delta) }));
  }

  function resetSection(key: SectionKey) {
    setDates((cur) => ({ ...cur, [key]: todayKST() }));
  }

  async function completeItem(
    key: "newStudentEvents" | "makeupClasses" | "clinicTasks" | "reviewTasks",
    date: string,
    id: string
  ) {
    markDone(date, key, id);
    await fetch(`/api/schedule-entry/${id}`, { method: "PATCH" });
  }

  function renderItem(key: SectionKey, date: string): (item: any) => React.ReactNode {
    const editBtn = (item: any) => (
      <button
        type="button"
        className="secondary schedule-edit-btn"
        onClick={(e) => {
          e.stopPropagation();
          setEditing({ kind: key, item, date });
        }}
      >
        수정
      </button>
    );

    switch (key) {
      case "alarms":
        return (a: AlarmItem) => (
          <div className="schedule-item-row">
            <div>
              <strong>{a.studentName}</strong> <span className="muted">{a.school}</span> — {a.content || "내용 미기재"}{" "}
              <span className="muted">(상담자: {a.counselor || "-"})</span>
            </div>
            {editBtn(a)}
          </div>
        );
      case "newStudentEvents":
        return (t: TodoItem) => (
          <div className="schedule-item-row">
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                margin: 0,
                cursor: t.done ? "default" : "pointer",
                textDecoration: t.done ? "line-through" : "none",
                opacity: t.done ? 0.6 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={t.done}
                disabled={t.done}
                onChange={() => completeItem("newStudentEvents", date, t.id)}
              />
              <strong>{t.studentName}</strong>
              <span className="muted">{schoolGrade(t.school, t.gradeNum)}</span>
              <span className="muted">{t.time || "시간 미정"}</span>
            </label>
            {editBtn(t)}
          </div>
        );
      case "firstDays":
        return (f: FirstDayItem) => (
          <div className="schedule-item-row">
            <div>
              <strong>{f.studentName}</strong> <span className="muted">{schoolGrade(f.school, f.gradeNum)}</span>
              {", "}
              <span className="muted">
                {f.classDays.length > 0 ? f.classDays.join("·") : "요일 미정"} {f.classTime || ""}
              </span>
            </div>
            {editBtn(f)}
          </div>
        );
      case "makeupClasses":
        return (t: TodoItem) => (
          <div className="schedule-item-row">
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                margin: 0,
                cursor: t.done ? "default" : "pointer",
                textDecoration: t.done ? "line-through" : "none",
                opacity: t.done ? 0.6 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={t.done}
                disabled={t.done}
                onChange={() => completeItem("makeupClasses", date, t.id)}
              />
              <strong>{t.studentName}</strong>
              <span className="muted">{schoolGrade(t.school, t.gradeNum)}</span>
              <span className="muted">{t.time || "시간 미정"}</span>
              <span className="muted">· 보강자: {t.owner}</span>
            </label>
            {editBtn(t)}
          </div>
        );
      case "clinicTasks":
        return (t: TodoItem) => (
          <div className="schedule-item-row">
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                margin: 0,
                cursor: t.done ? "default" : "pointer",
                textDecoration: t.done ? "line-through" : "none",
                opacity: t.done ? 0.6 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={t.done}
                disabled={t.done}
                onChange={() => completeItem("clinicTasks", date, t.id)}
              />
              <strong>{t.studentName}</strong>
              <span className="muted">{t.time || "시간 미정"}</span>
              <span className="muted">· 담당조교: {t.owner}</span>
            </label>
            <button
              type="button"
              className="secondary schedule-edit-btn"
              onClick={(e) => {
                e.stopPropagation();
                setViewingClinicTask(t);
              }}
            >
              더보기
            </button>
            {editBtn(t)}
          </div>
        );
      case "reviewTasks":
        return (t: TodoItem) => (
          <div className="schedule-item-row">
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                margin: 0,
                cursor: t.done ? "default" : "pointer",
                textDecoration: t.done ? "line-through" : "none",
                opacity: t.done ? 0.6 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={t.done}
                disabled={t.done}
                onChange={() => completeItem("reviewTasks", date, t.id)}
              />
              <strong>{t.studentName}</strong>
              <span className="muted">{schoolGrade(t.school, t.gradeNum)}</span>
              {t.memo && <span className="muted schedule-item-memo">· {t.memo}</span>}
            </label>
            {editBtn(t)}
          </div>
        );
      case "counseling":
        return (c: CounselingBrief) => (
          <div className="schedule-item-row schedule-item-clickable" onClick={() => setViewingCounseling({ item: c, date })}>
            <div>
              <strong>{c.studentName}</strong> <span className="muted">{schoolGrade(c.school, c.gradeNum)}</span>
              {", "}
              <span className="muted">상담자: {c.counselor || "-"}</span>
              <br />
              <span className="muted">{c.content || "-"}</span>
            </div>
          </div>
        );
      case "inquiries":
        return (q: InquiryBrief) => (
          <div className="schedule-item-row schedule-item-clickable" onClick={() => setViewingInquiry({ item: q, date })}>
            <div>
              <strong>{q.studentName}</strong> <span className="muted">{schoolGrade(q.school, q.gradeNum)}</span>
              {" · "}
              <span className={q.type === "긴급상담요청" ? "badge badge-urgent" : "badge"}>{q.type ?? "-"}</span>{" "}
              <span className={q.done ? "badge badge-success" : "badge"}>{q.done ? "처리완료" : "미처리"}</span>
              {q.owner && <span className="muted"> · 담당: {q.owner}</span>}
              <br />
              <span className="muted">{q.content || "-"}</span>
            </div>
          </div>
        );
      case "retests":
      default:
        return (t: TodoItem) => (
          <div className="schedule-item-row">
            <div>
              <strong>{t.studentName}</strong> <span className="muted">{schoolGrade(t.school, t.gradeNum)}</span>
              {", "}
              <span className="muted">{t.time || "시간 미정"}</span>
            </div>
            {editBtn(t)}
          </div>
        );
    }
  }

  return (
    <>
      <div className="schedule-cards-grid">
        {SECTION_META.map((meta) => {
          const date = dates[meta.key];
          const sched = cache[date];
          const items = sched ? (sched[meta.key] as any[]) : [];
          return (
            <ScheduleSectionCard
              key={meta.key}
              meta={meta}
              date={date}
              items={items}
              loading={!sched}
              onShift={(d) => shiftSection(meta.key, d)}
              onToday={() => resetSection(meta.key)}
              onMore={() => setPopup({ key: meta.key, date })}
              onQuickAdd={() => setQuickAdd({ kind: meta.key, date })}
              render={renderItem(meta.key, date)}
            />
          );
        })}
      </div>

      {popup &&
        (() => {
          const meta = SECTION_META.find((m) => m.key === popup.key)!;
          const sched = cache[popup.date];
          const items = sched ? (sched[popup.key] as any[]) : [];
          return (
            <SchedulePopup
              meta={meta}
              date={popup.date}
              items={items}
              loading={!sched}
              onShift={(d) => setPopup((p) => (p ? { ...p, date: shiftDate(p.date, d) } : p))}
              onToday={() => setPopup((p) => (p ? { ...p, date: todayKST() } : p))}
              onClose={() => setPopup(null)}
              onQuickAdd={() => setQuickAdd({ kind: popup.key, date: popup.date })}
              render={renderItem(popup.key, popup.date)}
            />
          );
        })()}

      {editing && (
        <ScheduleEditModal
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={() => refetchDate(editing.date)}
        />
      )}

      {quickAdd && (
        <ScheduleQuickAddModal
          target={quickAdd}
          onClose={() => setQuickAdd(null)}
          onSaved={(savedDate) => refetchDate(savedDate)}
        />
      )}

      {viewingCounseling &&
        (() => {
          const c = viewingCounseling.item;
          const record: CounselingRecord = {
            id: c.id,
            date: c.date,
            studentId: c.studentId,
            studentName: c.studentName,
            studentSchool: c.school,
            studentGrade: c.grade,
            counselor: c.counselor,
            transcript: c.transcript,
            content: c.content,
            followUp: c.followUp,
            enteredBy: c.enteredBy,
          };
          return (
            <CounselingEditModal
              item={record}
              canEdit={canEdit(c.enteredBy)}
              onClose={() => setViewingCounseling(null)}
              onSaved={() => refetchDate(viewingCounseling.date)}
            />
          );
        })()}

      {viewingInquiry &&
        (() => {
          const q = viewingInquiry.item;
          const record: AdminInboxRecord = {
            id: q.id,
            date: q.date,
            endDate: q.endDate,
            type: q.type,
            studentName: q.studentName,
            studentSchool: q.school,
            studentGrade: q.grade,
            content: q.content,
            done: q.done,
            enteredBy: q.enteredBy,
            owner: q.owner,
          };
          return (
            <AdminInboxDetailModal
              item={record}
              canEdit={canEdit(q.enteredBy)}
              onClose={() => setViewingInquiry(null)}
              onSaved={() => refetchDate(viewingInquiry.date)}
            />
          );
        })()}

      {viewingClinicTask && (
        <ClinicTaskDetailModal item={viewingClinicTask} onClose={() => setViewingClinicTask(null)} />
      )}
    </>
  );
}
