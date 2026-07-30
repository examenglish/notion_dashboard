"use client";

import { useEffect, useState } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type Breakdown = {
  attendance: { 출석: number; 지각: number; 결석: number };
  vocab: { 통과: number; 재시험: number; 미응시: number };
};

const ATTENDANCE_COLORS: Record<string, string> = { 출석: "#22c55e", 지각: "#f59e0b", 결석: "#e5484d" };
const VOCAB_COLORS: Record<string, string> = { 통과: "#22c55e", 재시험: "#f59e0b", 미응시: "#94a3b8" };

function Donut({ title, data, colors }: { title: string; data: Record<string, number>; colors: Record<string, string> }) {
  const chartData = Object.entries(data)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));
  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <div>
      <h2>{title}</h2>
      {total === 0 ? (
        <p className="muted">이번 달 기록이 없습니다.</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
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
  const [data, setData] = useState<Breakdown | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/monthly-outcomes")
      .then((r) => r.json())
      .then(setData);
  }, []);

  return (
    <div className="card">
      <div className="grid-2">
        <Donut title="이번달 출결상태 분포" data={data?.attendance ?? { 출석: 0, 지각: 0, 결석: 0 }} colors={ATTENDANCE_COLORS} />
        <Donut title="이번달 단어테스트 결과분포" data={data?.vocab ?? { 통과: 0, 재시험: 0, 미응시: 0 }} colors={VOCAB_COLORS} />
      </div>
    </div>
  );
}
