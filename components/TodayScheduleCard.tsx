"use client";

import { useEffect, useRef, useState } from "react";
import { todayKST } from "@/lib/date";
import StaffPicker from "./StaffPicker";

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
  studentName: string;
  school: string;
  gradeNum: string;
  owner: string;
  done: boolean;
};

type Schedule = {
  alarms: AlarmItem[];
  firstDays: FirstDayItem[];
  newStudentEvents: TodoItem[];
  makeupClasses: TodoItem[];
  retests: TodoItem[];
};

type SectionKey = keyof Schedule;

const SECTION_META: { key: SectionKey; title: string }[] = [
  { key: "alarms", title: "학습레벨/조치사항" },
  { key: "newStudentEvents", title: "신입생 상담 및 레벨테스트" },
  { key: "firstDays", title: "신입생 첫등원" },
  { key: "makeupClasses", title: "보강" },
  { key: "retests", title: "재시" },
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

  function removeItem(date: string, key: SectionKey, id: string) {
    setCache((c) => {
      const sched = c[date];
      if (!sched) return c;
      return { ...c, [date]: { ...sched, [key]: (sched[key] as any[]).filter((it) => it.id !== id) } };
    });
  }

  return { cache, ensureDate, refetchDate, removeItem };
}

function DateNav({ date, onShift, onToday }: { date: string; onShift: (delta: number) => void; onToday: () => void }) {
  return (
    <div className="date-nav" style={{ margin: "6px 0", fontSize: 13 }}>
      <button type="button" className="secondary date-nav-arrow" onClick={() => onShift(-1)}>◀</button>
      <strong>{formatLabel(date)}</strong>
      <button type="button" className="secondary date-nav-arrow" onClick={() => onShift(1)}>▶</button>
      {date !== todayKST() && (
        <button type="button" className="secondary" onClick={onToday}>오늘</button>
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
  render,
}: {
  meta: { key: SectionKey; title: string };
  date: string;
  items: any[];
  loading: boolean;
  onShift: (delta: number) => void;
  onToday: () => void;
  onMore: () => void;
  render: (item: any) => React.ReactNode;
}) {
  const visible = items.slice(0, 5);
  return (
    <div className="card">
      <div className="schedule-section-title">
        {meta.title} <span className="muted">({items.length})</span>
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
  render,
}: {
  meta: { key: SectionKey; title: string };
  date: string;
  items: any[];
  loading: boolean;
  onShift: (delta: number) => void;
  onToday: () => void;
  onClose: () => void;
  render: (item: any) => React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {meta.title} <span className="muted">({items.length})</span>
          </h2>
          <button type="button" className="secondary" onClick={onClose}>닫기</button>
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

export default function TodayScheduleCard() {
  const { cache, ensureDate, refetchDate, removeItem } = useScheduleCache();
  const [dates, setDates] = useState<Record<SectionKey, string>>(() => {
    const t = todayKST();
    return { alarms: t, newStudentEvents: t, firstDays: t, makeupClasses: t, retests: t };
  });
  const [popup, setPopup] = useState<{ key: SectionKey; date: string } | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);

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

  async function completeItem(key: "newStudentEvents" | "makeupClasses", date: string, id: string) {
    // Optimistic removal — completed items drop off "오늘의 일정" immediately.
    removeItem(date, key, id);
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
            <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0, cursor: "pointer" }}>
              <input type="checkbox" checked={false} onChange={() => completeItem("newStudentEvents", date, t.id)} />
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
            <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0, cursor: "pointer" }}>
              <input type="checkbox" checked={false} onChange={() => completeItem("makeupClasses", date, t.id)} />
              <strong>{t.studentName}</strong>
              <span className="muted">{schoolGrade(t.school, t.gradeNum)}</span>
              <span className="muted">{t.time || "시간 미정"}</span>
              <span className="muted">· 보강자: {t.owner}</span>
            </label>
            {editBtn(t)}
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
    </>
  );
}
