"use client";

import { useEffect, useState } from "react";
import { todayKST, formatDateLabel } from "@/lib/date";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function formatNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay()];
  return `${y}년 ${Number(m)}월 ${Number(d)}일 (${weekday}) ${get("hour")}:${get("minute")}:${get("second")}`;
}

export default function DateTimeHeader({
  scheduleDate,
  onShiftSchedule,
  onResetSchedule,
}: {
  // 세 props가 모두 있어야 좌우 화살표가 뜬다 — "오늘의 일정" 전체를
  // 옮기는 화면(대시보드)에서만 넘겨주고, 그 외에는 지금까지처럼 시계만
  // 표시한다.
  scheduleDate?: string;
  onShiftSchedule?: (delta: number) => void;
  onResetSchedule?: () => void;
}) {
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    setNow(formatNow());
    const id = setInterval(() => setNow(formatNow()), 1000);
    return () => clearInterval(id);
  }, []);

  const showNav = !!onShiftSchedule && !!scheduleDate;

  return (
    <div className="datetime-header">
      {showNav ? (
        <div className="datetime-header-row">
          <button type="button" className="secondary date-nav-arrow" onClick={() => onShiftSchedule!(-1)}>◀</button>
          <span>{now ?? ""}</span>
          <button type="button" className="secondary date-nav-arrow" onClick={() => onShiftSchedule!(1)}>▶</button>
        </div>
      ) : (
        now ?? ""
      )}
      {showNav && scheduleDate !== todayKST() && (
        <div className="datetime-header-sub">
          오늘의 일정: {formatDateLabel(scheduleDate!)} 표시 중
          <button type="button" className="secondary date-nav-today" onClick={onResetSchedule}>오늘</button>
        </div>
      )}
    </div>
  );
}
