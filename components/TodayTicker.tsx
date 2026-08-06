"use client";

import { useEffect, useRef, useState } from "react";
import { todayKST } from "@/lib/date";

// 트랙(.ticker-track)의 CSS 애니메이션 재생시간이 고정값이면, 항목이
// 많아져 트랙 폭이 늘어날수록 같은 시간에 더 먼 거리를 이동해야 해서
// 체감 속도가 빨라진다("글자가 많아지면 더 빨라짐"). 항목 수와 무관하게
// 항상 같은 속도(px/초)로 흐르도록, 실제 렌더된 폭을 측정해 재생시간을
// 그때그때 계산한다.
const PIXELS_PER_SECOND = 55;
const MIN_DURATION_SECONDS = 20;

type StatusField = { status?: string | null };
type AlarmItem = StatusField & { id: string; studentName: string; content: string };
type FirstDayItem = StatusField & { id: string; studentName: string; classTime: string };
type TodoItem = StatusField & { id: string; studentName: string; time: string; memo?: string };
type CounselingBrief = StatusField & { id: string; studentName: string; counselor: string; content: string };
type InquiryBrief = StatusField & { id: string; studentName: string; type: string | null; content: string; done: boolean };

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

export default function TodayTicker({ refreshSignal }: { refreshSignal?: number } = {}) {
  const [items, setItems] = useState<TickerItem[]>([]);
  const trackRef = useRef<HTMLDivElement>(null);
  const [durationSec, setDurationSec] = useState(MIN_DURATION_SECONDS);

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
        d.clinicTasks?.forEach((t) =>
          msgs.push({
            id: `c-${t.id}`,
            status: t.status ?? null,
            text: `${statusTag(t.status)}🧑‍🏫 ${t.studentName} 클리닉 ${t.time || ""}${t.memo ? " · " + t.memo : ""}`,
          })
        );
        d.reviewTasks?.forEach((t) =>
          msgs.push({
            id: `rv-${t.id}`,
            status: t.status ?? null,
            text: `${statusTag(t.status)}📚 ${t.studentName} 복습${t.memo ? " · " + t.memo : ""}`,
          })
        );
        d.counseling?.forEach((c) =>
          msgs.push({
            id: `cs-${c.id}`,
            status: c.status ?? null,
            text: `${statusTag(c.status)}💬 ${c.studentName} 상담(${c.counselor || "-"}) ${c.content || ""}`,
          })
        );
        d.inquiries?.forEach((q) =>
          msgs.push({
            id: `q-${q.id}`,
            status: q.status ?? null,
            text: `${statusTag(q.status)}${q.type === "긴급상담요청" ? "🚨" : "📮"} ${q.studentName} ${q.type ?? ""} ${q.done ? "(처리완료)" : ""}`,
          })
        );
        setItems(msgs);
      })
      .catch(() => setItems([]));
  }, [refreshSignal]);

  // items가 그려진 뒤 실제 폭을 재서 속도를 다시 계산한다 — 트랙에는
  // 항목이 두 벌 이어붙어 있으므로(seamless loop) 폭의 절반이 한 바퀴
  // 이동 거리다.
  useEffect(() => {
    if (!trackRef.current) return;
    const singleSetWidth = trackRef.current.scrollWidth / 2;
    if (singleSetWidth <= 0) return;
    setDurationSec(Math.max(singleSetWidth / PIXELS_PER_SECOND, MIN_DURATION_SECONDS));
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div className="ticker-bar">
      <div className="ticker-track" ref={trackRef} style={{ animationDuration: `${durationSec}s` }}>
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
