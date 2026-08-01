"use client";

import { classColor, stripClassSuffix } from "@/lib/format";
import type { MetricKey, MonthlyMetricRow } from "./StudentTable";

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);

const METRIC_LABEL: Record<MetricKey, string> = {
  attendanceRate: "출석률",
  vocabPassRate: "단어통과율",
  homeworkIncompleteRate: "과제미이행률",
};

export default function MonthlyBottomModal({
  metric,
  rows,
  onClose,
  onSelect,
}: {
  metric: MetricKey;
  rows: MonthlyMetricRow[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  // attendanceRate/vocabPassRate: lower is worse. homeworkIncompleteRate: higher is worse.
  const sorted = [...rows]
    .filter((r) => r[metric] !== null)
    .sort((a, b) => {
      const av = a[metric] as number;
      const bv = b[metric] as number;
      return metric === "homeworkIncompleteRate" ? bv - av : av - bv;
    })
    .slice(0, 30);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{METRIC_LABEL[metric]} 하위 {sorted.length}명</h2>
          <button type="button" className="secondary" onClick={onClose}>닫기</button>
        </div>

        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="sortable-table">
            <thead>
              <tr>
                <th>순위</th>
                <th>이름</th>
                <th>반</th>
                <th>{METRIC_LABEL[metric]}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr
                  key={r.studentId}
                  onClick={() => {
                    onSelect(r.studentId);
                    onClose();
                  }}
                >
                  <td>{i + 1}</td>
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
          {sorted.length === 0 && <p className="muted">데이터가 없습니다.</p>}
        </div>
      </div>
    </div>
  );
}
