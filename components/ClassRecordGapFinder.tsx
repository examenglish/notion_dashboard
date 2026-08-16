"use client";

import { useState } from "react";
import { todayKST as todayStr, shiftDate } from "@/lib/date";
import { stripClassSuffix } from "@/lib/format";

type Gap = { classId: string; className: string; date: string; weekday: string };

// 반/날짜를 하나씩 골라야만 진도·브리핑 입력 여부를 알 수 있던 것을 보완 —
// 기간을 지정하면 "이 요일에 수업이 있는 반인데 아직 기록이 없는" 항목만
// 모아서 보여주고, 클릭하면 바로 그 반/날짜로 입력폼이 채워진다.
export default function ClassRecordGapFinder({ onPick }: { onPick: (classId: string, date: string) => void }) {
  const [from, setFrom] = useState(shiftDate(todayStr(), -6));
  const [to, setTo] = useState(todayStr());
  const [includeExamClasses, setIncludeExamClasses] = useState(false);
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function search() {
    setLoading(true);
    setError(null);
    fetch(`/api/class-record/gaps?from=${from}&to=${to}&includeExamClasses=${includeExamClasses ? "1" : "0"}`)
      .then((r) => r.json())
      .then((data: { gaps?: Gap[]; error?: string }) => {
        if (data.error) {
          setError(data.error);
          setGaps(null);
        } else {
          setGaps(data.gaps ?? []);
        }
      })
      .catch(() => setError("네트워크 오류가 발생했습니다."))
      .finally(() => setLoading(false));
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 15 }}>미입력 반 찾기 <span className="title-lab-tag">(실험실)</span></h2>
      <p className="muted" style={{ marginTop: -4 }}>
        기간을 지정하면, 그 요일에 수업이 있는 반인데 아직 진도/브리핑 기록이 없는 반×날짜만 모아 보여줍니다.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label htmlFor="gapFrom">시작일</label>
          <input id="gapFrom" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="gapTo">종료일</label>
          <input id="gapTo" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 400, marginBottom: 8 }}>
          <input type="checkbox" checked={includeExamClasses} onChange={(e) => setIncludeExamClasses(e.target.checked)} />
          시험대비반 포함
        </label>
        <button type="button" onClick={search} disabled={loading} style={{ marginBottom: 8 }}>
          {loading ? "조회 중..." : "조회"}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {gaps && gaps.length === 0 && <p className="muted">이 기간에는 미입력 반이 없습니다.</p>}

      {gaps && gaps.length > 0 && (
        <>
          <p className="muted" style={{ marginTop: 8 }}>
            총 {gaps.length}건 — 항목을 누르면 아래 "오늘 수업 기록" 폼에 그 반/날짜가 채워집니다.
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              marginTop: 6,
              maxHeight: 320,
              overflowY: "auto",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 6,
            }}
          >
            {gaps.map((g) => (
              <button
                key={`${g.classId}|${g.date}`}
                type="button"
                className="secondary"
                onClick={() => onPick(g.classId, g.date)}
                style={{ textAlign: "left", fontSize: 13, padding: "6px 10px" }}
              >
                {g.date} ({g.weekday}) — {stripClassSuffix(g.className)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
