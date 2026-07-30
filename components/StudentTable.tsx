"use client";

import { useMemo, useState } from "react";

export type StudentRow = {
  id: string;
  name: string;
  school: string;
  grade: string | null;
  status: string | null;
  attendanceRate: number | null;
  homeworkRate: number | null;
  vocabPassRate: number | null;
  isNew: boolean;
  tuitionDay: number | null;
  latestExam: { date: string; score: number | null; subject: string | null; examName: string } | null;
};

type SortKey = "attendanceRate" | "homeworkRate" | "vocabPassRate" | "tuitionDay";

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);

export default function StudentTable({
  students,
  query,
  onQueryChange,
  onSelect,
}: {
  students: StudentRow[];
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (id: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return students;
    const withVal = students.map((s) => ({ s, v: s[sortKey] }));
    withVal.sort((a, b) => {
      if (a.v === null && b.v === null) return 0;
      if (a.v === null) return 1; // nulls last regardless of direction
      if (b.v === null) return -1;
      return sortDir === "asc" ? a.v - b.v : b.v - a.v;
    });
    return withVal.map((x) => x.s);
  }, [students, sortKey, sortDir]);

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <div className="card">
      <h2>학생 검색</h2>
      <input
        type="text"
        placeholder="학생 이름으로 검색"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table className="sortable-table">
          <thead>
            <tr>
              <th>이름</th>
              <th
                className={sortKey === "attendanceRate" ? "active" : ""}
                onClick={() => toggleSort("attendanceRate")}
              >
                출석률{arrow("attendanceRate")}
              </th>
              <th
                className={sortKey === "homeworkRate" ? "active" : ""}
                onClick={() => toggleSort("homeworkRate")}
              >
                과제제출률{arrow("homeworkRate")}
              </th>
              <th
                className={sortKey === "vocabPassRate" ? "active" : ""}
                onClick={() => toggleSort("vocabPassRate")}
              >
                단어통과율{arrow("vocabPassRate")}
              </th>
              <th className={sortKey === "tuitionDay" ? "active" : ""} onClick={() => toggleSort("tuitionDay")}>
                회비일{arrow("tuitionDay")}
              </th>
              <th>직전 시험</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.id} onClick={() => onSelect(s.id)}>
                <td>
                  <strong>{s.name}</strong>
                  {s.isNew && <span className="new-badge">신</span>}
                  <div className="muted">{s.school} {s.grade}</div>
                </td>
                <td>{pct(s.attendanceRate)}</td>
                <td>{pct(s.homeworkRate)}</td>
                <td>{pct(s.vocabPassRate)}</td>
                <td>{s.tuitionDay ? `매월 ${s.tuitionDay}일` : "-"}</td>
                <td>
                  {s.latestExam
                    ? `${s.latestExam.subject ?? ""} ${s.latestExam.score ?? "-"}점 (${s.latestExam.date})`
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && <p className="muted">검색 결과가 없습니다.</p>}
      </div>
    </div>
  );
}
