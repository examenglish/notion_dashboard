"use client";

import { useEffect, useState } from "react";

type Schedule = {
  alarms: { id: string; studentName: string; learningLevel: string; action: string }[];
  firstDays: { id: string; studentName: string; school: string }[];
  newStudentCounseling: { id: string; title: string; time: string; studentName: string; done: boolean }[];
  makeupClasses: { id: string; title: string; time: string; studentName: string; done: boolean }[];
  retests: { id: string; title: string; time: string; studentName: string; done: boolean }[];
};

const EMPTY: Schedule = {
  alarms: [],
  firstDays: [],
  newStudentCounseling: [],
  makeupClasses: [],
  retests: [],
};

function Section({
  title,
  items,
  render,
}: {
  title: string;
  items: any[];
  render: (item: any) => React.ReactNode;
}) {
  return (
    <div>
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

export default function TodayScheduleCard() {
  const [schedule, setSchedule] = useState<Schedule>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/today-schedule")
      .then((r) => r.json())
      .then(setSchedule)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="card">
      <h2>오늘의 일정</h2>
      {loading ? (
        <p className="muted">불러오는 중...</p>
      ) : (
        <div className="schedule-grid">
          <Section
            title="학습레벨/조치 알람"
            items={schedule.alarms}
            render={(a) => (
              <>
                <strong>{a.studentName}</strong> — {a.learningLevel || "레벨 미기재"} · {a.action || "조치 미기재"}
              </>
            )}
          />
          <Section
            title="신입생 첫등원"
            items={schedule.firstDays}
            render={(f) => (
              <>
                <strong>{f.studentName}</strong> <span className="muted">({f.school})</span>
              </>
            )}
          />
          <Section
            title="신입생 상담"
            items={schedule.newStudentCounseling}
            render={(t) => (
              <>
                <span className="muted">{t.time || "시간 미정"}</span> {t.studentName || t.title}
              </>
            )}
          />
          <Section
            title="보강"
            items={schedule.makeupClasses}
            render={(t) => (
              <>
                <span className="muted">{t.time || "시간 미정"}</span> {t.studentName || t.title}
              </>
            )}
          />
          <Section
            title="재시"
            items={schedule.retests}
            render={(t) => (
              <>
                <span className="muted">{t.time || "시간 미정"}</span> {t.studentName || t.title}
              </>
            )}
          />
        </div>
      )}
    </div>
  );
}
