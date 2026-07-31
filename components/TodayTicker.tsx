"use client";

import { useEffect, useState } from "react";
import { todayKST } from "@/lib/date";

type StatusField = { status?: string | null };
type AlarmItem = StatusField & { id: string; studentName: string; content: string };
type FirstDayItem = StatusField & { id: string; studentName: string; classTime: string };
type TodoItem = StatusField & { id: string; studentName: string; time: string };

type Schedule = {
  alarms: AlarmItem[];
  firstDays: FirstDayItem[];
  newStudentEvents: TodoItem[];
  makeupClasses: TodoItem[];
  retests: TodoItem[];
};

type TickerItem = { id: string; text: string; status: string | null };

const STATUS_LABEL: Record<string, string> = {
  재원: "재원생",
  대기생: "대기생",
  휴원: "휴원생",
  퇴원: "퇴원생",
};

function statusTag(status: string | null | undefined) {
  if (!status || status === "재원") return "";
  return `[${STATUS_LABEL[status] ?? status}] `;
}

export default function TodayTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);

  useEffect(() => {
    fetch(`/api/today-schedule?date=${todayKST()}`)
      .then((r) => r.json())
      .then((d: Schedule) => {
        const msgs: TickerItem[] = [];
        d.alarms?.forEach((a) =>
          msgs.push({ id: `a-${a.id}`, status: a.status ?? null, text: `${statusTag(a.status)}⚠ ${a.studentName} — ${a.content || "조치 필요"}` })
        );
        d.newStudentEvents?.forEach((t) =>
          msgs.push({ id: `n-${t.id}`, status: t.status ?? null, text: `${statusTag(t.status)}🆕 ${t.studentName} 신입생상담/레벨테스트 ${t.time || ""}` })
        );
        d.firstDays?.forEach((f) =>
          msgs.push({ id: `f-${f.id}`, status: f.status ?? null, text: `${statusTag(f.status)}🎉 ${f.studentName} 오늘 첫 등원` })
        );
        d.makeupClasses?.forEach((t) =>
          msgs.push({ id: `m-${t.id}`, status: t.status ?? null, text: `${statusTag(t.status)}📌 ${t.studentName} 보강 ${t.time || ""}` })
        );
        d.retests?.forEach((t) =>
          msgs.push({ id: `r-${t.id}`, status: t.status ?? null, text: `${statusTag(t.status)}✏️ ${t.studentName} 재시 ${t.time || ""}` })
        );
        setItems(msgs);
      })
      .catch(() => setItems([]));
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="ticker-bar">
      <div className="ticker-track">
        {items.map((it) => (
          <span key={it.id} className={`ticker-item${it.status && it.status !== "재원" ? " ticker-item-flag" : ""}`}>
            {it.text}
          </span>
        ))}
        {items.map((it) => (
          <span key={it.id + "-dup"} className={`ticker-item${it.status && it.status !== "재원" ? " ticker-item-flag" : ""}`} aria-hidden="true">
            {it.text}
          </span>
        ))}
      </div>
    </div>
  );
}
