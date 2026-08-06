"use client";

import { useEffect, useRef, useState } from "react";
import { todayKST, shiftDate, formatDateLabel } from "@/lib/date";
import { stripClassSuffix } from "@/lib/format";
import StaffPicker from "./StaffPicker";
import StudentPicker from "./StudentPicker";
import CounselingEditModal, { CounselingRecord } from "./CounselingEditModal";
import AdminInboxDetailModal, { AdminInboxRecord } from "./AdminInboxDetailModal";
import MaterialTaskModal, { MaterialTaskRecord } from "./MaterialTaskModal";
import QuickScheduleForm, { QuickScheduleKind } from "./QuickScheduleForm";

type AlarmItem = { id: string; studentName: string; school: string; content: string; counselor: string };
type FirstDayItem = {
  id: string;
  studentName: string;
  school: string;
  gradeNum: string;
  classDays: string[];
  classTime: string;
  status: string | null;
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
type PersonalTodoItem = { id: string; title: string; done: boolean };

type Schedule = {
  alarms: AlarmItem[];
  firstDays: FirstDayItem[];
  newStudentEvents: TodoItem[];
  makeupClasses: TodoItem[];
  retests: TodoItem[];
  clinicTasks: TodoItem[];
  reviewTasks: TodoItem[];
  personalTodos: PersonalTodoItem[];
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
  // 본인만 보이는 개인 할일 — 서버가 세션의 담당자로만 걸러서 내려주므로
  // 다른 직원 목록과 섞이지 않는다. "/to do list ..."로도 등록 가능.
  { key: "personalTodos", title: "개인 할일" },
  { key: "counseling", title: "상담일지", readOnly: true },
  { key: "inquiries", title: "행정실 문의", readOnly: true },
];

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
      <strong>{formatDateLabel(date)}</strong>
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
  meta: { key: string; title: string; readOnly?: boolean };
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
  meta: { key: string; title: string; readOnly?: boolean };
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

type EditTarget = { kind: SectionKey; item: AlarmItem | FirstDayItem | TodoItem | PersonalTodoItem; date: string };

const EDIT_GRADE_OPTIONS = ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"];

function ScheduleEditModal({
  target,
  staffRole,
  onClose,
  onSaved,
}: {
  target: EditTarget;
  staffRole: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isAlarm = target.kind === "alarms";
  const isFirstDay = target.kind === "firstDays";
  const isPersonal = target.kind === "personalTodos";
  const isTodo = !isAlarm && !isFirstDay && !isPersonal;

  const alarmItem = target.item as AlarmItem;
  const todoItem = target.item as TodoItem;
  const personalItem = target.item as PersonalTodoItem;

  const [content, setContent] = useState(isAlarm ? alarmItem.content : "");
  const [counselor, setCounselor] = useState(isAlarm ? alarmItem.counselor : "");
  const [alarmDate, setAlarmDate] = useState(target.date);
  const [time, setTime] = useState(isTodo ? todoItem.time : "");
  const [note, setNote] = useState(isTodo ? todoItem.memo ?? "" : "");
  const [owner, setOwner] = useState(isTodo && todoItem.owner !== "-" ? todoItem.owner : "");
  const [todoDate, setTodoDate] = useState(target.date);
  const [personalContent, setPersonalContent] = useState(isPersonal ? personalItem.title : "");
  const [personalDate, setPersonalDate] = useState(target.date);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "신입생 첫등원" 수정은 등원일만 고치는 게 아니라, 반을 옮기거나 이름/학교
  // 등이 잘못 입력된 경우도 바로잡을 수 있어야 해서 학생 전체 정보를 불러와
  // /api/students/[id] PATCH로 저장한다(다른 반으로 옮기면 Notion 양방향
  // relation이라 DB①반의 소속학생 목록도 함께 갱신된다 — 별도 처리 불필요).
  const [loadingStudent, setLoadingStudent] = useState(isFirstDay);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [name, setNameField] = useState("");
  const [school, setSchool] = useState("");
  const [grade, setGrade] = useState("");
  const [phone, setPhone] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [enrolledAt, setEnrolledAt] = useState(target.date);

  useEffect(() => {
    if (!isFirstDay) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/students/${target.item.id}`).then((r) => r.json()),
      fetch("/api/classes").then((r) => r.json()),
    ]).then(([data, classList]) => {
      if (cancelled) return;
      const s = data.student;
      setNameField(s.name ?? "");
      setSchool(s.school ?? "");
      setGrade(s.grade ?? "");
      setPhone(s.phone ?? "");
      setParentPhone(s.parentPhone ?? "");
      setClassIds(s.classIds ?? []);
      setEnrolledAt(s.enrolledAt || target.date);
      setClasses(classList);
      setLoadingStudent(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirstDay, target.item.id]);

  function toggleClass(id: string) {
    setClassIds((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]));
  }

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
        res = await fetch(`/api/students/${target.item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, school, grade, phone, parentPhone, classIds, enrolledAt }),
        });
      } else if (isPersonal) {
        res = await fetch(`/api/personal-todo/${target.item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: personalContent, date: personalDate }),
        });
      } else {
        res = await fetch(`/api/schedule-entry/${target.item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: todoDate, time, ownerName: owner, note }),
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

  async function handleDeleteAlarm() {
    if (!window.confirm("이 조치사항 알람을 삭제하시겠습니까? 전체기록의 조치사항 이력도 함께 정리됩니다.")) return;
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/student-info/${target.item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "삭제에 실패했습니다.");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  const modalTitle = isFirstDay
    ? name || "학생 정보"
    : isPersonal
    ? "개인 할일"
    : "studentName" in target.item
    ? target.item.studentName
    : "";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{modalTitle} 수정</h2>
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

        {isFirstDay && loadingStudent && <p className="muted">불러오는 중...</p>}
        {isFirstDay && !loadingStudent && (
          <>
            <div className="field-row">
              <div>
                <label htmlFor="editName">이름</label>
                <input id="editName" type="text" value={name} onChange={(e) => setNameField(e.target.value)} />
              </div>
              <div>
                <label htmlFor="editSchool">학교</label>
                <input id="editSchool" type="text" value={school} onChange={(e) => setSchool(e.target.value)} />
              </div>
            </div>
            <div className="field-row">
              <div>
                <label htmlFor="editGrade">학년</label>
                <select id="editGrade" value={grade} onChange={(e) => setGrade(e.target.value)}>
                  <option value="">선택 안 함</option>
                  {EDIT_GRADE_OPTIONS.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="editEnrolledAt">등원일 (첫 등원일)</label>
                <input id="editEnrolledAt" type="date" value={enrolledAt} onChange={(e) => setEnrolledAt(e.target.value)} />
              </div>
            </div>
            <div className="field-row">
              <div>
                <label htmlFor="editPhone">학생 연락처</label>
                <input id="editPhone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" />
              </div>
              <div>
                <label htmlFor="editParentPhone">학부모 연락처</label>
                <input id="editParentPhone" type="tel" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} placeholder="010-0000-0000" />
              </div>
            </div>
            <label>소속반 (반 이동 시 여기서 변경)</label>
            <div className="class-checkbox-grid">
              {classes.map((c) => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, margin: 0 }}>
                  <input type="checkbox" checked={classIds.includes(c.id)} onChange={() => toggleClass(c.id)} />
                  {stripClassSuffix(c.name)}
                </label>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              등원일이 오늘이거나 지났으면 저장 시 대기생 상태가 자동으로 재원으로 전환됩니다.
            </p>
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
            <StaffPicker value={owner} onChange={setOwner} label="담당자" date={todoDate} time={time} />
            {target.kind === "clinicTasks" && staffRole === "조교" ? (
              <>
                <label htmlFor="editTodoNote">지시사항 (수정 불가)</label>
                <textarea id="editTodoNote" value={note} readOnly disabled style={{ background: "#f3f4f6" }} />
                <p className="muted" style={{ fontSize: 12 }}>
                  지시사항은 지시한 강사/원장/행정만 고칠 수 있습니다. 진행한 클리닉 내용은
                  "클리닉 기록 작성"에서 이 할일과 연결해 남겨주세요.
                </p>
              </>
            ) : (
              <>
                <label htmlFor="editTodoNote">
                  {target.kind === "clinicTasks" ? "지시사항" : "내용/메모"}
                </label>
                <textarea id="editTodoNote" value={note} onChange={(e) => setNote(e.target.value)} />
              </>
            )}
          </>
        )}

        {isPersonal && (
          <>
            <label htmlFor="editPersonalContent">내용</label>
            <textarea id="editPersonalContent" value={personalContent} onChange={(e) => setPersonalContent(e.target.value)} />
            <label htmlFor="editPersonalDate">날짜</label>
            <input id="editPersonalDate" type="date" value={personalDate} onChange={(e) => setPersonalDate(e.target.value)} />
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button type="button" disabled={saving || loadingStudent} onClick={handleSave}>
            {saving ? "저장 중..." : "저장"}
          </button>
          {isAlarm && staffRole === "원장" && (
            <button type="button" className="secondary" disabled={deleting} onClick={handleDeleteAlarm}>
              {deleting ? "삭제 중..." : "삭제"}
            </button>
          )}
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
// the /input page — 필드/저장 로직은 QuickScheduleForm(입력 페이지의 "일정
// 빠른등록" 카드와 완전히 동일한 컴포넌트)에 위임해서, 여기서 등록하든
// 입력 페이지에서 등록하든 항상 같은 방식으로 동작하게 한다.
function ScheduleQuickAddModal({
  target,
  onClose,
  onSaved,
}: {
  target: QuickAddTarget;
  onClose: () => void;
  onSaved: (date: string) => void;
}) {
  const title = SECTION_META.find((m) => m.key === target.kind)?.title ?? "";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title} 빠른 등록</h2>
          <button type="button" className="secondary" onClick={onClose}>닫기</button>
        </div>
        <QuickScheduleForm
          lockedKind={target.kind as QuickScheduleKind}
          initialDate={target.date}
          onSaved={(savedDate) => {
            onSaved(savedDate);
            onClose();
          }}
        />
      </div>
    </div>
  );
}

export default function TodayScheduleCard({
  staffName,
  staffRole,
  refreshSignal,
  globalDate,
  onChanged,
}: {
  staffName: string | null;
  staffRole: string | null;
  refreshSignal?: number;
  // 상단 DateTimeHeader의 좌우 화살표로 넘어오는 "전체 날짜" — 바뀔 때마다
  // 아래 모든 섹션(자재관리 포함)의 날짜를 한 번에 같은 날로 맞춘다. 이후
  // 각 섹션의 개별 ◀▶는 그대로 동작해서, 필요하면 특정 섹션만 다시 따로
  // 옮겨볼 수 있다 — 헤더 화살표를 다시 누르면 다시 전체가 그 날짜로 맞춰진다.
  globalDate?: string;
  onChanged?: () => void;
}) {
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
      personalTodos: t,
      counseling: t,
      inquiries: t,
    };
  });
  const [popup, setPopup] = useState<{ key: SectionKey; date: string } | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [quickAdd, setQuickAdd] = useState<QuickAddTarget | null>(null);

  // 교재·시험자료 제작관리는 별도 DB(DB⑥)라 위 useScheduleCache(/api/today-schedule
  // 하나로 5개 섹션을 공유)에 끼워넣지 않고, 그 자체로 독립된 날짜 탐색기를
  // 가진 섹션으로 붙인다. 카드/팝업 표시는 기존 ScheduleSectionCard·
  // SchedulePopup을 그대로 재사용한다.
  const [materialDate, setMaterialDate] = useState(todayKST());
  const [materialItems, setMaterialItems] = useState<MaterialTaskRecord[] | null>(null);
  const [materialPopupOpen, setMaterialPopupOpen] = useState(false);
  const [materialEditing, setMaterialEditing] = useState<MaterialTaskRecord | null>(null);
  const [materialCreating, setMaterialCreating] = useState(false);

  function fetchMaterial(date: string) {
    setMaterialItems(null);
    fetch(`/api/material-tasks?date=${date}`)
      .then((r) => r.json())
      .then(setMaterialItems);
  }

  useEffect(() => {
    fetchMaterial(materialDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialDate]);

  const prevGlobalDate = useRef(globalDate);
  useEffect(() => {
    if (globalDate === undefined) return;
    if (prevGlobalDate.current === globalDate) return;
    prevGlobalDate.current = globalDate;
    setDates((cur) => {
      const next = { ...cur };
      for (const key of Object.keys(next) as SectionKey[]) next[key] = globalDate;
      return next;
    });
    setMaterialDate(globalDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalDate]);

  useEffect(() => {
    Object.values(dates).forEach(ensureDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates]);

  useEffect(() => {
    if (popup) ensureDate(popup.date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup?.date]);

  // 행정실/상담일지가 이 카드 밖(대시보드의 행정실 리스트 등)에서 수정·삭제돼도
  // 여기 캐시는 그대로라 반영이 안 되던 문제 — 부모가 refreshSignal을 bump하면
  // 현재 열려있는 모든 날짜를 다시 불러온다. 최초 마운트 시(undefined->0 등)에는
  // 건너뛴다 — 어차피 위 useEffect들이 처음 데이터를 채운다.
  const prevRefreshSignal = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === undefined) return;
    if (prevRefreshSignal.current === refreshSignal) return;
    prevRefreshSignal.current = refreshSignal;
    Object.values(dates).forEach(refetchDate);
    if (materialDate) fetchMaterial(materialDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

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
    onChanged?.();
  }

  async function completePersonalTodo(date: string, id: string) {
    markDone(date, "personalTodos", id);
    await fetch(`/api/personal-todo/${id}`, { method: "PATCH" });
    onChanged?.();
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
              {" · "}
              <span className={f.status === "대기생" ? "badge" : "badge badge-success"}>{f.status ?? "-"}</span>
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
      case "personalTodos":
        return (t: PersonalTodoItem) => (
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
                onChange={() => completePersonalTodo(date, t.id)}
              />
              {t.title}
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
        <ScheduleSectionCard
          meta={{ key: "materialTasks", title: "교재·시험자료 제작" }}
          date={materialDate}
          items={materialItems ?? []}
          loading={materialItems === null}
          onShift={(d) => setMaterialDate((cur) => shiftDate(cur, d))}
          onToday={() => setMaterialDate(todayKST())}
          onMore={() => setMaterialPopupOpen(true)}
          onQuickAdd={() => setMaterialCreating(true)}
          render={(t: MaterialTaskRecord) => (
            <div className="schedule-item-row schedule-item-clickable" onClick={() => setMaterialEditing(t)}>
              <div>
                <strong>{t.title}</strong> <span className="muted">담당: {t.ownerName}</span>
                {" · "}
                <span className={t.status === "완료" ? "badge badge-success" : "badge"}>{t.status}</span>{" "}
                <span className="muted">{t.progress}%</span>
                <br />
                <span className="muted">{t.content || "-"}</span>
              </div>
            </div>
          )}
        />
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
          staffRole={staffRole}
          onClose={() => setEditing(null)}
          onSaved={() => {
            refetchDate(editing.date);
            onChanged?.();
          }}
        />
      )}

      {quickAdd && (
        <ScheduleQuickAddModal
          target={quickAdd}
          onClose={() => setQuickAdd(null)}
          onSaved={(savedDate) => {
            refetchDate(savedDate);
            onChanged?.();
          }}
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
              onSaved={() => {
                refetchDate(viewingCounseling.date);
                onChanged?.();
              }}
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
              onSaved={() => {
                refetchDate(viewingInquiry.date);
                onChanged?.();
              }}
            />
          );
        })()}

      {viewingClinicTask && (
        <ClinicTaskDetailModal item={viewingClinicTask} onClose={() => setViewingClinicTask(null)} />
      )}

      {materialPopupOpen && (
        <SchedulePopup
          meta={{ key: "materialTasks", title: "교재·시험자료 제작" }}
          date={materialDate}
          items={materialItems ?? []}
          loading={materialItems === null}
          onShift={(d) => setMaterialDate((cur) => shiftDate(cur, d))}
          onToday={() => setMaterialDate(todayKST())}
          onClose={() => setMaterialPopupOpen(false)}
          onQuickAdd={() => setMaterialCreating(true)}
          render={(t: MaterialTaskRecord) => (
            <div className="schedule-item-row schedule-item-clickable" onClick={() => setMaterialEditing(t)}>
              <div>
                <strong>{t.title}</strong> <span className="muted">담당: {t.ownerName}</span>
                {" · "}
                <span className={t.status === "완료" ? "badge badge-success" : "badge"}>{t.status}</span>{" "}
                <span className="muted">{t.progress}%</span>
                <br />
                <span className="muted">{t.content || "-"}</span>
              </div>
            </div>
          )}
        />
      )}

      {materialCreating && (
        <MaterialTaskModal
          item={null}
          defaultDueDate={materialDate}
          onClose={() => setMaterialCreating(false)}
          onSaved={() => fetchMaterial(materialDate)}
        />
      )}

      {materialEditing && (
        <MaterialTaskModal
          item={materialEditing}
          defaultDueDate={materialDate}
          onClose={() => setMaterialEditing(null)}
          onSaved={() => fetchMaterial(materialDate)}
        />
      )}
    </>
  );
}
