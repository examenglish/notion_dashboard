"use client";

import { useEffect, useState } from "react";
import { todayKST as todayStr } from "@/lib/date";
import { stripClassSuffix } from "@/lib/format";

type ClassOption = { id: string; name: string };
type RosterStudent = { id: string; name: string };
type Flags = { vocabFail: boolean; homeworkIncomplete: boolean; absent: boolean };

function confirmSave() {
  return window.confirm("저장하시겠습니까?");
}

// 조교·행정 전용 — 담당교사의 "오늘 수업 기록"처럼 진도/과제를 입력할 필요 없이
// 결석/단어통과여부만 빠르게 체크해서 바로 저장한다. 같은 반/날짜 기록이 이미
// 있으면(교사가 먼저 저장했든, 다른 조교가 먼저 체크했든) 그 값을 불러와
// 수정할 수 있고, 저장 즉시 학생별 누적 통계(출석률/단어통과율)에 반영된다.
// 담당교사가 나중에 "오늘 수업 기록"에서 같은 반/날짜를 열면 이 체크 내용이
// 그대로 남아있는 채로 진도만 채워 저장할 수 있다.
export default function AttendanceCheckForm() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [period, setPeriod] = useState("");
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [perStudent, setPerStudent] = useState<Record<string, Flags>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/classes")
      .then((r) => r.json())
      .then(setClasses);
  }, []);

  useEffect(() => {
    if (!classId || !date) {
      setRoster([]);
      return;
    }
    let cancelled = false;
    setLoadingRoster(true);
    setDone(false);
    const periodQuery = period ? `&period=${encodeURIComponent(period)}` : "";
    Promise.all([
      fetch(`/api/students?classId=${classId}`).then((r) => r.json()),
      fetch(`/api/class-record?classId=${classId}&date=${date}${periodQuery}`).then((r) => r.json()),
    ])
      .then(([list, data]: [RosterStudent[], { existing: any; plannedAbsentIds: string[] }]) => {
        if (cancelled) return;
        setRoster(list);
        const rec = data?.existing;
        const plannedAbsentIds = new Set<string>(data?.plannedAbsentIds ?? []);
        setPerStudent(
          Object.fromEntries(
            list.map((s) => [
              s.id,
              rec?.perStudent?.[s.id] ?? {
                vocabFail: false,
                homeworkIncomplete: false,
                absent: plannedAbsentIds.has(s.id),
              },
            ])
          )
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingRoster(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, date, period]);

  function toggleFlag(studentId: string, key: "vocabFail" | "absent") {
    setPerStudent((cur) => ({ ...cur, [studentId]: { ...cur[studentId], [key]: !cur[studentId]?.[key] } }));
  }

  async function handleSave() {
    if (!confirmSave()) return;
    setError(null);
    setDone(false);
    setSaving(true);
    try {
      const res = await fetch("/api/attendance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, date, period: period || undefined, perStudent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setDone(true);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={(e) => e.preventDefault()}>
      <h2>결석 · 단어테스트 체크 <span className="title-lab-tag">(실험실)</span></h2>
      <p className="muted" style={{ marginTop: 0 }}>
        진도 입력 없이 결석/단어통과여부만 바로 체크해 저장합니다. 저장하면 곧바로 학생별 통계에 반영되고, 담당교사가
        같은 반/날짜로 "오늘 수업 기록"을 열면 이 체크 내용을 그대로 불러와 이어서 진도를 입력할 수 있습니다.
      </p>

      <div className="field-row">
        <div>
          <label htmlFor="acDate">날짜</label>
          <input id="acDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="acClass">반</label>
          <select id="acClass" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">반 선택</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{stripClassSuffix(c.name)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="acPeriod">교시 (교시로 나뉜 반만)</label>
          <select id="acPeriod" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="">교시 구분 없음</option>
            <option value="1교시">1교시</option>
            <option value="2교시">2교시</option>
            <option value="3교시">3교시</option>
          </select>
        </div>
      </div>

      {loadingRoster && <p className="muted">명단 불러오는 중...</p>}
      {!loadingRoster && classId && roster.length === 0 && <p className="muted">이 반에 등록된 학생이 없습니다.</p>}
      {!loadingRoster &&
        roster.map((s) => (
          <div key={s.id} className="roster-check-row">
            <span>{s.name}</span>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
              <label>
                <input type="checkbox" checked={perStudent[s.id]?.absent ?? false} onChange={() => toggleFlag(s.id, "absent")} />
                결석
              </label>
              <label>
                <input type="checkbox" checked={perStudent[s.id]?.vocabFail ?? false} onChange={() => toggleFlag(s.id, "vocabFail")} />
                단어미통과
              </label>
            </div>
          </div>
        ))}

      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

      <div style={{ marginTop: 16 }}>
        <button type="button" onClick={handleSave} disabled={saving || !classId || roster.length === 0}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </form>
  );
}
