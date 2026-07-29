"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ClassSummary = {
  classId: string;
  className: string;
  studentCount: number;
  attendanceRate: number | null;
  homeworkRate: number | null;
  vocabPassRate: number | null;
};

type StudentListItem = {
  id: string;
  name: string;
  school: string;
  grade: string | null;
  status: string | null;
  attendanceRate: number | null;
  homeworkRate: number | null;
  vocabPassRate: number | null;
};

type StudentDetail = {
  student: StudentListItem;
  dailyRecords: {
    date: string | null;
    attendance: string | null;
    homeworkDone: boolean;
    vocabResult: string | null;
  }[];
  examScores: { date: string | null; examName: string; subject: string | null; score: number | null }[];
};

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);

export default function DashboardClient() {
  const [summary, setSummary] = useState<ClassSummary[]>([]);
  const [query, setQuery] = useState("");
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [selected, setSelected] = useState<StudentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    fetch("/api/classes/summary")
      .then((r) => r.json())
      .then(setSummary);
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      fetch(`/api/students?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then(setStudents);
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const chartData = useMemo(
    () =>
      summary.map((c) => ({
        name: c.className,
        출석률: c.attendanceRate === null ? 0 : Math.round(c.attendanceRate * 100),
        숙제제출률: c.homeworkRate === null ? 0 : Math.round(c.homeworkRate * 100),
      })),
    [summary]
  );

  async function selectStudent(id: string) {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/students/${id}`);
      const data = await res.json();
      setSelected(data);
    } finally {
      setLoadingDetail(false);
    }
  }

  const trendData = useMemo(() => {
    if (!selected) return [];
    return selected.dailyRecords.map((r) => ({
      date: r.date?.slice(5) ?? "",
      출석: r.attendance === "결석" ? 0 : 1,
      숙제: r.homeworkDone ? 1 : 0,
    }));
  }, [selected]);

  const scoreData = useMemo(() => {
    if (!selected) return [];
    return selected.examScores.map((s) => ({
      date: s.date?.slice(5) ?? "",
      점수: s.score ?? 0,
      시험명: s.examName,
    }));
  }, [selected]);

  return (
    <div className="page">
      <div className="card">
        <h2>반별 출석률 / 숙제제출률</h2>
        {chartData.length === 0 ? (
          <p className="muted">데이터를 불러오는 중입니다...</p>
        ) : (
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

      <div className="grid-2">
        <div className="card">
          <h2>학생 검색</h2>
          <input
            type="text"
            placeholder="학생 이름으로 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div style={{ marginTop: 12 }}>
            {students.map((s) => (
              <div key={s.id} className="student-row" onClick={() => selectStudent(s.id)}>
                <div>
                  <strong>{s.name}</strong>{" "}
                  <span className="muted">{s.school} {s.grade}</span>
                </div>
                <span className="badge">{s.status ?? "-"}</span>
              </div>
            ))}
            {students.length === 0 && <p className="muted">검색 결과가 없습니다.</p>}
          </div>
        </div>

        <div className="card">
          <h2>학생 상세</h2>
          {loadingDetail && <p className="muted">불러오는 중...</p>}
          {!loadingDetail && !selected && <p className="muted">왼쪽에서 학생을 선택하세요.</p>}
          {!loadingDetail && selected && (
            <div>
              <strong>{selected.student.name}</strong>{" "}
              <span className="muted">
                {selected.student.school} · {selected.student.grade}
              </span>
              <div style={{ display: "flex", gap: 16, margin: "10px 0" }}>
                <span className="badge">누적출석률 {pct(selected.student.attendanceRate)}</span>
                <span className="badge">숙제제출률 {pct(selected.student.homeworkRate)}</span>
                <span className="badge">단어테스트통과율 {pct(selected.student.vocabPassRate)}</span>
              </div>

              <h2 style={{ marginTop: 20 }}>출결/숙제 추이</h2>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 1]} ticks={[0, 1]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="출석" stroke="#2f6fed" strokeWidth={2} />
                  <Line type="monotone" dataKey="숙제" stroke="#22c55e" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>

              <h2 style={{ marginTop: 20 }}>성적 추이</h2>
              {scoreData.length === 0 ? (
                <p className="muted">등록된 시험 성적이 없습니다.</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={scoreData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="점수" stroke="#f59e0b" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
