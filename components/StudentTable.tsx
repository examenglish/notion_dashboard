"use client";

import { useEffect, useMemo, useState } from "react";
import { classColor, stripClassSuffix } from "@/lib/format";
import MonthlyBottomModal from "./MonthlyBottomModal";

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

export type MetricKey = "attendanceRate" | "vocabRetryRate" | "homeworkIncompleteRate";

export type MonthlyMetricRow = {
  studentId: string;
  studentName: string;
  className: string;
  recordCount: number;
  attendanceRate: number | null;
  vocabRetryRate: number | null;
  homeworkIncompleteRate: number | null;
};

type SortKey = "attendanceRate" | "homeworkRate" | "vocabPassRate" | "tuitionDay";

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);

const STATUS_COLORS: Record<string, string> = {
  재원: "#22c55e",
  대기생: "#2f6fed",
  휴원: "#f59e0b",
  퇴원: "#94a3b8",
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status || status === "재원") return null;
  return (
    <span className="badge" style={{ background: STATUS_COLORS[status] ?? "#94a3b8", color: "#fff", marginLeft: 6 }}>
      {status}
    </span>
  );
}

const METRIC_TABS: { key: MetricKey; label: string }[] = [
  { key: "attendanceRate", label: "출석률" },
  { key: "vocabRetryRate", label: "단어재시율" },
  { key: "homeworkIncompleteRate", label: "과제미이행률" },
];

function BottomMetricsList({ onSelect }: { onSelect: (id: string) => void }) {
  const [rows, setRows] = useState<MonthlyMetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<MetricKey>("attendanceRate");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetch("/api/students/monthly-bottom")
      .then((r) => r.json())
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  // attendanceRate: lower is worse (ascending). The other two: higher is worse (descending).
  const sorted = useMemo(() => {
    return [...rows]
      .filter((r) => r[metric] !== null)
      .sort((a, b) => {
        const av = a[metric] as number;
        const bv = b[metric] as number;
        return metric === "attendanceRate" ? av - bv : bv - av;
      });
  }, [rows, metric]);

  const visible = sorted.slice(0, 5);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {METRIC_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={metric === t.key ? "" : "secondary"}
            onClick={() => setMetric(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        이번 달 {METRIC_TABS.find((t) => t.key === metric)?.label} 하위 {visible.length}명
      </p>
      {loading && <p className="muted">불러오는 중...</p>}
      {!loading && sorted.length === 0 && <p className="muted">이번 달 기록이 없습니다.</p>}
      {!loading && sorted.length > 0 && (
        <div className="table-scroll">
          <table className="sortable-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>반</th>
                <th>{METRIC_TABS.find((t) => t.key === metric)?.label}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.studentId} onClick={() => onSelect(r.studentId)}>
                  <td>
                    <strong>{r.studentName}</strong>
                  </td>
                  <td>
                    <span className="badge" style={{ background: classColor(r.className), color: "#fff" }}>
                      {stripClassSuffix(r.className)}
                    </span>
                  </td>
                  <td>{pct(r[metric])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sorted.length > 5 && (
        <button type="button" className="secondary" style={{ marginTop: 10 }} onClick={() => setShowAll(true)}>
          더보기 (하위 30명까지)
        </button>
      )}
      {showAll && (
        <MonthlyBottomModal metric={metric} rows={rows} onClose={() => setShowAll(false)} onSelect={onSelect} />
      )}
    </div>
  );
}

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

      {query === "" ? (
        <BottomMetricsList onSelect={onSelect} />
      ) : (
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
                    <StatusBadge status={s.status} />
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
      )}
    </div>
  );
}
