"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { todayKST } from "@/lib/date";
import { stripClassSuffix, CHART_COLORS } from "@/lib/format";

type DaySummary = {
  classId: string;
  className: string;
  recordCount: number;
  attendanceRate: number | null;
  homeworkRate: number | null;
  vocabPassRate: number | null;
  counselingRate: number | null;
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const ROTATE_INTERVAL_MS = 5000;

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

function MetricBar({ label, value, color }: { label: string; value: number | null; color: string }) {
  const pctVal = value === null ? 0 : Math.round(value * 100);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 700 }}>{value === null ? "-" : `${pctVal}%`}</span>
      </div>
      <div style={{ background: "var(--border)", borderRadius: 6, height: 8, overflow: "hidden", marginTop: 4 }}>
        <div
          style={{
            width: `${pctVal}%`,
            height: "100%",
            background: color,
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}

export default function ClassDateChart() {
  const [date, setDate] = useState(() => todayKST());
  const [data, setData] = useState<DaySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/classes/summary-by-date?date=${date}`)
      .then((r) => r.json())
      .then((d: DaySummary[]) => {
        setData(d);
        setIndex(0);
      })
      .finally(() => setLoading(false));
  }, [date]);

  // Show every registered class regardless of whether it has records for
  // the selected day (MetricBar already renders "-" for null values), so
  // staff can browse to any class — sorted so the chip row is predictable
  // instead of whatever order the API happens to return.
  const sortedClasses = useMemo(
    () => [...data].sort((a, b) => a.className.localeCompare(b.className, "ko")),
    [data]
  );

  function startTimer(len: number) {
    if (timerRef.current) clearInterval(timerRef.current);
    if (len <= 1) return;
    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % len);
    }, ROTATE_INTERVAL_MS);
  }

  useEffect(() => {
    startTimer(sortedClasses.length);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedClasses.length, date]);

  function selectIndex(i: number) {
    setIndex(i);
    startTimer(sortedClasses.length);
  }

  const current = sortedClasses[index];

  return (
    <div className="card class-summary-card">
      <h2>반별 현황</h2>
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
      {!loading && sortedClasses.length === 0 && (
        <p className="muted">등록된 반이 없습니다.</p>
      )}
      {!loading && current && (
        <div key={current.classId} className="class-summary-fade class-summary-body">
          <MetricBar label="출석률" value={current.attendanceRate} color={CHART_COLORS.slateBlue} />
          <MetricBar label="과제 제출률" value={current.homeworkRate} color={CHART_COLORS.sageGreen} />
          <MetricBar label="상담률" value={current.counselingRate} color={CHART_COLORS.mutedAmber} />
          <MetricBar label="단어 통과율" value={current.vocabPassRate} color={CHART_COLORS.mutedTeal} />
        </div>
      )}

      {!loading && sortedClasses.length > 0 && (
        <div className="class-chip-row">
          {sortedClasses.map((c, i) => (
            <button
              key={c.classId}
              type="button"
              className={`secondary class-chip${i === index ? " active" : ""}`}
              onClick={() => selectIndex(i)}
            >
              {stripClassSuffix(c.className)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
