"use client";

import { useEffect, useState } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { classColor, CHART_COLORS } from "@/lib/format";

type Breakdown = {
  attendance: { 출석: number; 지각: number; 결석: number };
  vocab: { 통과: number; 재시험: number; 미응시: number };
  homework: { 완료: number; 미완료: number };
  counselingByCounselor: Record<string, number>;
};

const ATTENDANCE_COLORS: Record<string, string> = {
  출석: CHART_COLORS.sageGreen,
  지각: CHART_COLORS.mutedAmber,
  결석: CHART_COLORS.dustyRose,
};
const VOCAB_COLORS: Record<string, string> = {
  통과: CHART_COLORS.sageGreen,
  재시험: CHART_COLORS.mutedAmber,
  미응시: CHART_COLORS.warmGray,
};
const HOMEWORK_COLORS: Record<string, string> = {
  완료: CHART_COLORS.slateBlue,
  미완료: CHART_COLORS.dustyRose,
};

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${y}년 ${m}월`;
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function Donut({
  title,
  data,
  colors,
  centerPercent,
}: {
  title: string;
  data: Record<string, number>;
  colors: Record<string, string>;
  centerPercent?: number | null;
}) {
  const chartData = Object.entries(data)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));
  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <div>
      <h2>{title}</h2>
      {total === 0 ? (
        <p className="muted">이 달 기록이 없습니다.</p>
      ) : (
        <div style={{ position: "relative" }}>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72} paddingAngle={2}>
                {chartData.map((d) => (
                  <Cell key={d.name} fill={colors[d.name] ?? classColor(d.name)} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number, name: string) => [`${value}건 (${Math.round((value / total) * 100)}%)`, name]} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
          {centerPercent !== undefined && centerPercent !== null && (
            <div
              style={{
                position: "absolute",
                top: "40%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                textAlign: "center",
                pointerEvents: "none",
                fontSize: 26,
                fontWeight: 700,
              }}
            >
              {centerPercent}%
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function pct(numerator: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((numerator / total) * 100);
}

export default function MonthlyOutcomeCharts() {
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<Breakdown | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard/monthly-outcomes?month=${month}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [month]);

  const attendance = data?.attendance ?? { 출석: 0, 지각: 0, 결석: 0 };
  const vocab = data?.vocab ?? { 통과: 0, 재시험: 0, 미응시: 0 };
  const homework = data?.homework ?? { 완료: 0, 미완료: 0 };

  const attendanceTotal = attendance.출석 + attendance.지각 + attendance.결석;
  const vocabTotal = vocab.통과 + vocab.재시험 + vocab.미응시;
  const homeworkTotal = homework.완료 + homework.미완료;

  return (
    <div className="card">
      <div className="date-nav">
        <button type="button" className="secondary date-nav-arrow" onClick={() => setMonth((m) => shiftMonth(m, -1))}>◀</button>
        <strong>{monthLabel(month)} 현황</strong>
        <button type="button" className="secondary date-nav-arrow" onClick={() => setMonth((m) => shiftMonth(m, 1))}>▶</button>
        {month !== currentMonth() && (
          <button type="button" className="secondary date-nav-today" onClick={() => setMonth(currentMonth())}>이번달</button>
        )}
      </div>

      {loading ? (
        <p className="muted">불러오는 중...</p>
      ) : (
        <div className="donut-grid">
          <Donut
            title="출결상태 분포"
            data={attendance}
            colors={ATTENDANCE_COLORS}
            centerPercent={pct(attendance.출석, attendanceTotal)}
          />
          <Donut
            title="단어테스트 결과분포"
            data={vocab}
            colors={VOCAB_COLORS}
            centerPercent={pct(vocab.통과, vocabTotal)}
          />
          <Donut
            title="과제완료율"
            data={homework}
            colors={HOMEWORK_COLORS}
            centerPercent={pct(homework.완료, homeworkTotal)}
          />
          <Donut title="상담자별 상담비율" data={data?.counselingByCounselor ?? {}} colors={{}} />
        </div>
      )}
    </div>
  );
}
