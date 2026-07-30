"use client";

import { useEffect, useState } from "react";

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

const EMPTY: Schedule = {
  alarms: [],
  firstDays: [],
  newStudentEvents: [],
  makeupClasses: [],
  retests: [],
};

function SectionCard({
  title,
  items,
  render,
}: {
  title: string;
  items: any[];
  render: (item: any) => React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="schedule-section-title">
        {title} <span className="muted">({items.length})</span>
      </div>
      {items.length === 0 ? (
        <p className="muted" style={{ margin: "4px 0 0" }}>없음</p>
      ) : (
        <ul className="schedule-list">
          {items.map((item, i) => (
            <li key={item.id ?? i}>{render(item)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function schoolGrade(school: string, gradeNum: string) {
  const s = school || "학교미상";
  return gradeNum ? `${s}(${gradeNum})` : s;
}

export default function TodayScheduleCard() {
  const [schedule, setSchedule] = useState<Schedule>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/today-schedule")
      .then((r) => r.json())
      .then(setSchedule)
      .finally(() => setLoading(false));
  }, []);

  async function completeItem(key: "newStudentEvents" | "makeupClasses", id: string) {
    // Optimistic removal — completed items drop off "오늘의 일정" immediately.
    setSchedule((cur) => ({ ...cur, [key]: cur[key].filter((t) => t.id !== id) }));
    await fetch(`/api/schedule-entry/${id}`, { method: "PATCH" });
  }

  if (loading) {
    return (
      <div className="card">
        <h2>오늘의 일정</h2>
        <p className="muted">불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="schedule-cards-grid">
      <SectionCard
        title="학습레벨/조치사항"
        items={schedule.alarms}
        render={(a: AlarmItem) => (
          <>
            <strong>{a.studentName}</strong> <span className="muted">{a.school}</span> — {a.content || "내용 미기재"}
            {" "}
            <span className="muted">(상담자: {a.counselor || "-"})</span>
          </>
        )}
      />

      <SectionCard
        title="신입생 상담 및 레벨테스트"
        items={schedule.newStudentEvents}
        render={(t: TodoItem) => (
          <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0, cursor: "pointer" }}>
            <input type="checkbox" checked={false} onChange={() => completeItem("newStudentEvents", t.id)} />
            <strong>{t.studentName}</strong>
            <span className="muted">{schoolGrade(t.school, t.gradeNum)}</span>
            <span className="muted">{t.time || "시간 미정"}</span>
          </label>
        )}
      />

      <SectionCard
        title="신입생 첫등원"
        items={schedule.firstDays}
        render={(f: FirstDayItem) => (
          <>
            <strong>{f.studentName}</strong> <span className="muted">{schoolGrade(f.school, f.gradeNum)}</span>
            {", "}
            <span className="muted">
              {f.classDays.length > 0 ? f.classDays.join("·") : "요일 미정"} {f.classTime || ""}
            </span>
          </>
        )}
      />

      <SectionCard
        title="보강"
        items={schedule.makeupClasses}
        render={(t: TodoItem) => (
          <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0, cursor: "pointer" }}>
            <input type="checkbox" checked={false} onChange={() => completeItem("makeupClasses", t.id)} />
            <strong>{t.studentName}</strong>
            <span className="muted">{schoolGrade(t.school, t.gradeNum)}</span>
            <span className="muted">{t.time || "시간 미정"}</span>
            <span className="muted">· 보강자: {t.owner}</span>
          </label>
        )}
      />

      <SectionCard
        title="재시"
        items={schedule.retests}
        render={(t: TodoItem) => (
          <>
            <strong>{t.studentName}</strong> <span className="muted">{schoolGrade(t.school, t.gradeNum)}</span>
            {", "}
            <span className="muted">{t.time || "시간 미정"}</span>
          </>
        )}
      />
    </div>
  );
}
