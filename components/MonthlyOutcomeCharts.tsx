"use client";

import { useEffect, useState } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type Breakdown = {
  attendance: { 출석: number; 지각: number; 결석: number };
  vocab: { 통과: number; 재시험: number; 미응시: number };
  homework: { 완료: number; 미완료: number };
};

const ATTENDANCE_COLORS: Record<string, string> = { 출석: "#22c55e", 지각: "#f59e0b", 결석: "#e5484d" };
const VOCAB_COLORS: Record<string, string> = { 통과: "#22c55e", 재시험: "#f59e0b", 미응시: "#94a3b8" };
const HOMEWORK_COLORS: Record<string, string> = { 완료: "#2f6fed", 미완료: "#e5484d" };

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

function Donut({ title, data, colors }: { title: string; data: Record<string, number>; colors: Record<string, string> }) {
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
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72} paddingAngle={2}>
              {chartData.map((d) => (
                <Cell key={d.name} fill={colors[d.name] ?? "#94a3b8"} />
              ))}
            </Pie>
            <Tooltip formatter={(value: number, name: string) => [`${value}건 (${Math.round((value / total) * 100)}%)`, name]} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
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

  return (
    <div className="card">
      <div className="date-nav">
        <button type="button" className="secondary" onClick={() => setMonth((m) => shiftMonth(m, -1))}>◀</button>
        <strong>{monthLabel(month)} 현황</strong>
        <button type="button" className="secondary" onClick={() => setMonth((m) => shiftMonth(m, 1))}>▶</button>
        {month !== currentMonth() && (
          <button type="button" className="secondary" onClick={() => setMonth(currentMonth())}>이번달</button>
        )}
      </div>

      {loading ? (
        <p className="muted">불러오는 중...</p>
      ) : (
        <div className="donut-grid">
          <Donut title="출결상태 분포" data={data?.attendance ?? { 출석: 0, 지각: 0, 결석: 0 }} colors={ATTENDANCE_COLORS} />
          <Donut title="단어테스트 결과분포" data={data?.vocab ?? { 통과: 0, 재시험: 0, 미응시: 0 }} colors={VOCAB_COLORS} />
          <Donut title="과제완료율" data={data?.homework ?? { 완료: 0, 미완료: 0 }} colors={HOMEWORK_COLORS} />
        </div>
      )}
    </div>
  );
}
