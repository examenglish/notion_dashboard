"use client";

import { useEffect, useState } from "react";

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

export default function DateTimeHeader() {
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    setNow(formatNow());
    const id = setInterval(() => setNow(formatNow()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="datetime-header">
      {now ?? ""}
    </div>
  );
}
