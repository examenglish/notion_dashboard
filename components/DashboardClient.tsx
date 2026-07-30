"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import RecentListCard from "./RecentListCard";
import ClassDateChart from "./ClassDateChart";
import TodayScheduleCard from "./TodayScheduleCard";
import StudentTable, { StudentRow } from "./StudentTable";

type AdminInboxItem = {
  id: string;
  date: string | null;
  type: string | null;
  studentName: string;
  content: string;
  done: boolean;
};

type CounselingItem = {
  id: string;
  date: string | null;
  studentName: string;
  counselor: string;
  content: string;
  followUp: string;
};

type StudentListItem = StudentRow;

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
  const [query, setQuery] = useState("");
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [selected, setSelected] = useState<StudentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [adminInbox, setAdminInbox] = useState<AdminInboxItem[]>([]);
  const [counseling, setCounseling] = useState<CounselingItem[]>([]);

  useEffect(() => {
    fetch("/api/admin-inbox")
      .then((r) => r.json())
      .then(setAdminInbox);
    fetch("/api/counseling")
      .then((r) => r.json())
      .then(setCounseling);
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      fetch(`/api/students?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then(setStudents);
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

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
      과제: r.homeworkDone ? 1 : 0,
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
      <TodayScheduleCard />

      <ClassDateChart />

      <div className="grid-2">
        <StudentTable students={students} query={query} onQueryChange={setQuery} onSelect={selectStudent} />

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
                <span className="badge">과제제출률 {pct(selected.student.homeworkRate)}</span>
                <span className="badge">단어테스트통과율 {pct(selected.student.vocabPassRate)}</span>
              </div>

              <h2 style={{ marginTop: 20 }}>출결/과제 추이</h2>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 1]} ticks={[0, 1]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="출석" stroke="#2f6fed" strokeWidth={2} />
                  <Line type="monotone" dataKey="과제" stroke="#22c55e" strokeWidth={2} />
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

      <div className="grid-2">
        <RecentListCard
          title="행정입력함"
          items={adminInbox}
          keyOf={(i) => i.id}
          renderItem={(i) => (
            <>
              <div className="recent-list-top">
                <strong>{i.studentName}</strong>
                <span className="badge">{i.type ?? "-"}</span>
              </div>
              <div>{i.content}</div>
              <div className="recent-list-meta">
                {i.date ?? "-"} · {i.done ? "처리완료" : "미처리"}
              </div>
            </>
          )}
        />

        <RecentListCard
          title="상담일지"
          items={counseling}
          keyOf={(i) => i.id}
          renderItem={(i) => (
            <>
              <div className="recent-list-top">
                <strong>{i.studentName}</strong>
                <span className="badge">{i.counselor}</span>
              </div>
              <div>{i.content}</div>
              <div className="recent-list-meta">{i.date ?? "-"}</div>
            </>
          )}
        />
      </div>
    </div>
  );
}
