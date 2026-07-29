"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { todayKST } from "@/lib/date";

type DaySummary = {
  classId: string;
  className: string;
  recordCount: number;
  attendanceRate: number | null;
  homeworkRate: number | null;
};

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
  return `${m}월 ${d}일 ${weekday}요일`;
}

function shiftDate(dateStr: string, delta: number) {
  const { y, m, d } = parts(dateStr);
  const next = new Date(Date.UTC(y, m - 1, d + delta));
  return next.toISOString().slice(0, 10);
}

export default function ClassDateChart() {
  const [date, setDate] = useState(() => todayKST());
  const [data, setData] = useState<DaySummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/classes/summary-by-date?date=${date}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [date]);

  const chartData = useMemo(
    () =>
      data
        .filter((c) => c.recordCount > 0)
        .map((c) => ({
          name: c.className,
          출석률: c.attendanceRate === null ? 0 : Math.round(c.attendanceRate * 100),
          숙제제출률: c.homeworkRate === null ? 0 : Math.round(c.homeworkRate * 100),
        })),
    [data]
  );

  return (
    <div className="card">
      <h2>반별 출석률 / 숙제제출률</h2>
      <div className="date-nav">
        <button type="button" className="secondary" onClick={() => setDate((d) => shiftDate(d, -1))}>
          ◀
        </button>
        <strong>{formatLabel(date)}</strong>
        <button type="button" className="secondary" onClick={() => setDate((d) => shiftDate(d, 1))}>
          ▶
        </button>
        {date !== todayKST() && (
          <button type="button" className="secondary" onClick={() => setDate(todayKST())}>
            오늘
          </button>
        )}
      </div>

      {loading && <p className="muted">불러오는 중...</p>}
      {!loading && chartData.length === 0 && (
        <p className="muted">이 날짜에 등록된 출결 기록이 없습니다.</p>
      )}
      {!loading && chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis unit="%" domain={[0, 100]} />
            <Tooltip />
            <Legend />
            <Bar dataKey="출석률" fill="#2f6fed" radius={[4, 4, 0, 0]} />
            <Bar dataKey="숙제제출률" fill="#22c55e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
