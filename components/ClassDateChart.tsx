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

  const activeClasses = useMemo(() => data.filter((c) => c.recordCount > 0), [data]);

  function startTimer(len: number) {
    if (timerRef.current) clearInterval(timerRef.current);
    if (len <= 1) return;
    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % len);
    }, ROTATE_INTERVAL_MS);
  }

  useEffect(() => {
    startTimer(activeClasses.length);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClasses.length, date]);

  function goTo(delta: number) {
    if (activeClasses.length === 0) return;
    setIndex((i) => (i + delta + activeClasses.length) % activeClasses.length);
    startTimer(activeClasses.length);
  }

  const current = activeClasses[index];

  return (
    <div className="card">
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
      {!loading && activeClasses.length === 0 && (
        <p className="muted">이 날짜에 등록된 기록이 없습니다.</p>
      )}
      {!loading && current && (
        <>
          <div className="class-summary-rotator">
            <button type="button" className="secondary date-nav-arrow" onClick={() => goTo(-1)}>◀</button>
            <div key={current.classId} className="class-summary-fade">
              <h3 style={{ textAlign: "center", fontSize: 20, margin: "0 0 16px" }}>
                {stripClassSuffix(current.className)}
              </h3>
              <MetricBar label="출석률" value={current.attendanceRate} color={CHART_COLORS.slateBlue} />
              <MetricBar label="과제 제출률" value={current.homeworkRate} color={CHART_COLORS.sageGreen} />
              <MetricBar label="상담률" value={current.counselingRate} color={CHART_COLORS.mutedAmber} />
              <MetricBar label="단어 통과율" value={current.vocabPassRate} color={CHART_COLORS.mutedTeal} />
            </div>
            <button type="button" className="secondary date-nav-arrow" onClick={() => goTo(1)}>▶</button>
          </div>
          {activeClasses.length > 1 && (
            <p className="muted" style={{ textAlign: "center", marginTop: 4 }}>
              {index + 1} / {activeClasses.length}
            </p>
          )}
        </>
      )}
    </div>
  );
}
