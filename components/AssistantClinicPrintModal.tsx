"use client";

import { useEffect, useMemo, useState } from "react";

type ClinicRow = {
  id: string;
  date: string | null;
  assistantName: string;
  studentNames: string[];
  content: string;
  nextPrep: string;
};

// ClassRosterPrintModal과 같은 인쇄 패턴(no-print 컨트롤 + print-area,
// window.print()로 "PDF로 저장")을 그대로 재사용한다. /api/clinic-records를
// 날짜 없이 호출하면 getRecentClinicRecords()가 전체 이력을 다 돌려주므로
// (최근 몇 건으로 잘리지 않음) "빠짐없이"가 보장된다.
export default function AssistantClinicPrintModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<ClinicRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 빈 문자열이면 전체 조교, 값이 있으면 그 조교 한 명만 골라서 출력한다.
  const [selectedAssistant, setSelectedAssistant] = useState("");

  useEffect(() => {
    fetch("/api/clinic-records")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setRows(data);
        else setError(data.error ?? "불러오지 못했습니다.");
      })
      .catch(() => setError("네트워크 오류가 발생했습니다."));
  }, []);

  // 조교별로 묶고, 각 조교 안에서는 날짜 오름차순(가장 이른 기록부터)으로
  // 정렬한다. 조교 relation이 비어있는 예외 데이터("-")는 정상 조교 목록을
  // 가리지 않도록 제외한다.
  const groups = useMemo(() => {
    if (!rows) return [];
    const byAssistant = new Map<string, ClinicRow[]>();
    for (const r of rows) {
      const key = r.assistantName;
      if (!key || key === "-") continue;
      if (!byAssistant.has(key)) byAssistant.set(key, []);
      byAssistant.get(key)!.push(r);
    }
    return Array.from(byAssistant.entries())
      .sort(([a], [b]) => a.localeCompare(b, "ko"))
      .map(([name, list]) => ({
        name,
        list: [...list].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
      }));
  }, [rows]);

  const printGroups = selectedAssistant ? groups.filter((g) => g.name === selectedAssistant) : groups;
  const printCount = printGroups.reduce((sum, g) => sum + g.list.length, 0);
  const totalCount = rows?.length ?? 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 980 }}>
        <div className="no-print">
          <div className="modal-header">
            <h2>조교 클리닉 기록 전체 출력</h2>
            <button type="button" className="secondary" onClick={onClose}>닫기</button>
          </div>

          {error && <p className="error-text">{error}</p>}
          {!rows && !error && <p className="muted" style={{ marginTop: 12 }}>불러오는 중...</p>}
          {rows && groups.length === 0 && (
            <p className="muted" style={{ marginTop: 12 }}>클리닉 기록이 없습니다.</p>
          )}
          {groups.length > 0 && (
            <>
              <div className="modal-controls" style={{ gridTemplateColumns: "auto 1fr", marginTop: 12 }}>
                <label htmlFor="clinicPrintAssistant">조교</label>
                <select
                  id="clinicPrintAssistant"
                  value={selectedAssistant}
                  onChange={(e) => setSelectedAssistant(e.target.value)}
                >
                  <option value="">전체 조교 ({groups.length}명)</option>
                  {groups.map((g) => (
                    <option key={g.name} value={g.name}>{g.name} ({g.list.length}건)</option>
                  ))}
                </select>
              </div>
              <p className="muted" style={{ marginTop: 12 }}>
                {selectedAssistant ? `${selectedAssistant} 조교 · 기록 ${printCount}건` : `조교 ${groups.length}명 · 전체 기록 ${totalCount}건`}
                {" "}(날짜 오름차순{!selectedAssistant ? ", 조교별로 새 페이지에서 시작" : ""}).
                인쇄 대화상자에서 "PDF로 저장"을 선택하면 다운로드됩니다.
              </p>
              <button type="button" style={{ marginTop: 10 }} onClick={() => window.print()}>
                인쇄 / PDF 저장
              </button>
            </>
          )}
        </div>

        {printGroups.length > 0 && (
          <div className="print-area" style={{ marginTop: 16 }}>
            {printGroups.map((g, gi) => (
              <div
                key={g.name}
                className={gi > 0 ? "clinic-print-section clinic-print-section-break" : "clinic-print-section"}
              >
                <div className="clinic-print-title">{g.name} 조교 · 클리닉 기록 ({g.list.length}건)</div>
                <table className="clinic-print-table">
                  <colgroup>
                    <col style={{ width: "9%" }} />
                    <col style={{ width: "14%" }} />
                    <col style={{ width: "42%" }} />
                    <col style={{ width: "35%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>학생</th>
                      <th>진행 내용</th>
                      <th>다음 준비사항</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.list.map((r) => (
                      <tr key={r.id}>
                        <td>{r.date ?? "-"}</td>
                        <td>{r.studentNames.join(", ")}</td>
                        <td>{r.content}</td>
                        <td>{r.nextPrep || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
