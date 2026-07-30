"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { todayKST } from "@/lib/date";
import { stripClassSuffix } from "@/lib/format";

type DaySummary = {
  classId: string;
  className: string;
  recordCount: number;
  attendanceRate: number | null;
  homeworkRate: number | null;
  counselingRate: number | null;
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

type Row = { name: string; value: number };

function ClassMetricRow({
  title,
  color,
  rows,
  emptyText,
}: {
  title: string;
  color: string;
  rows: Row[];
  emptyText: string;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <ResponsiveContainer width="100%" height={110}>
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" unit="%" domain={[0, 100]} />
            <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
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

  const attendanceRows = useMemo(
    () =>
      data
        .filter((c) => c.recordCount > 0 && c.attendanceRate !== null)
        .map((c) => ({ name: stripClassSuffix(c.className), value: Math.round((c.attendanceRate as number) * 100) })),
    [data]
  );
  const homeworkRows = useMemo(
    () =>
      data
        .filter((c) => c.recordCount > 0 && c.homeworkRate !== null)
        .map((c) => ({ name: stripClassSuffix(c.className), value: Math.round((c.homeworkRate as number) * 100) })),
    [data]
  );
  const counselingRows = useMemo(
    () =>
      data
        .filter((c) => c.counselingRate !== null && c.counselingRate > 0)
        .map((c) => ({ name: stripClassSuffix(c.className), value: Math.round((c.counselingRate as number) * 100) })),
    [data]
  );

  return (
    <div className="card">
      <h2>반별 출석률 / 과제제출률 / 상담률</h2>
      <div className="date-nav">
        <button type="button" className="secondary date-nav-arrow" onClick={() => setDate((d) => shiftDate(d, -1))}>
          ◀
        </button>
        <strong>{formatLabel(date)}</strong>
        <button type="button" className="secondary date-nav-arrow" onClick={() => setDate((d) => shiftDate(d, 1))}>
          ▶
        </button>
        {date !== todayKST() && (
          <button type="button" className="secondary date-nav-today" onClick={() => setDate(todayKST())}>
            오늘
          </button>
        )}
      </div>

      {loading && <p className="muted">불러오는 중...</p>}
      {!loading && (
        <div style={{ marginTop: 12 }}>
          <ClassMetricRow
            title="반별 출석률"
            color="#2f6fed"
            rows={attendanceRows}
            emptyText="이 날짜에 등록된 출결 기록이 없습니다."
          />
          <ClassMetricRow
            title="반별 과제제출률"
            color="#22c55e"
            rows={homeworkRows}
            emptyText="이 날짜에 등록된 과제 기록이 없습니다."
          />
          <ClassMetricRow
            title="반별 상담률"
            color="#f59e0b"
            rows={counselingRows}
            emptyText="이 날짜에 등록된 상담 기록이 없습니다."
          />
        </div>
      )}
    </div>
  );
}
