"use client";

import { useEffect, useState } from "react";
import { todayKST as todayStr } from "@/lib/date";
import { stripClassSuffix } from "@/lib/format";
import AbsenceReviewModal, { AbsenceReviewItem } from "./AbsenceReviewModal";

type ClassOption = { id: string; name: string; type?: string };
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
  const [reviewItems, setReviewItems] = useState<AbsenceReviewItem[] | null>(null);
  const [hasExisting, setHasExisting] = useState(false);
  const [includeExamClasses, setIncludeExamClasses] = useState(false);

  // 결석 체크 후 그 날짜(당일 포함)의 결석 검토 팝업을 바로 띄운다 —
  // 담당교사가 이미 지정된 건은 서버가 걸러서 내려주므로, 항목이 남아있으면
  // 실제로 처리(지각 정정/보강 취소/담당자 지정)가 필요한 경우다. 행정/원장이
  // 아니면 서버가 빈 목록을 내려줘 자연히 아무 일도 일어나지 않는다.
  function maybeOpenReview() {
    const hasAbsent = Object.values(perStudent).some((f) => f.absent);
    if (!hasAbsent) return;
    fetch(`/api/absence-review?date=${encodeURIComponent(date)}`)
      .then((r) => r.json())
      .then((data: { items: AbsenceReviewItem[] }) => {
        if (data.items?.length > 0) setReviewItems(data.items);
      });
  }

  useEffect(() => {
    fetch("/api/classes")
      .then((r) => r.json())
      .then(setClasses);
  }, []);

  // 시험대비반은 기본적으로 목록에서 숨기되(체크박스로 펼쳐볼 수 있음), 이미
  // 골라둔 반이 시험대비반이면 체크를 나중에 꺼도 선택값이 안 사라지게 한다.
  const visibleClasses = classes.filter((c) => includeExamClasses || c.type !== "시험대비" || c.id === classId);

  useEffect(() => {
    if (!classId || !date) {
      setRoster([]);
      setHasExisting(false);
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
        setHasExisting(!!rec);
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
    // 교시를 잘못 고르면(또는 안 고르면) 다른 교시(또는 담당교사/다른 조교)가
    // 이미 체크해둔 기록을 불러와 덮어쓸 수 있다 — 이미 기록이 있을 때는
    // 교시를 짚어주고 한 번 더 확인받는다.
    if (hasExisting) {
      const periodLabel = period || "교시 구분 없음";
      if (!window.confirm(`${date} (${periodLabel})에 이미 체크된 기록이 있습니다.\n저장하면 그 기록의 결석/단어테스트 체크를 덮어씁니다 — 교시를 잘못 고른 건 아닌지 확인해주세요.\n계속할까요?`)) {
        return;
      }
    } else if (!confirmSave()) {
      return;
    }
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
      maybeOpenReview();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
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
            {visibleClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.type === "시험대비" ? `[시험대비] ${stripClassSuffix(c.name)}` : stripClassSuffix(c.name)}
              </option>
            ))}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 400, marginTop: 4 }}>
            <input type="checkbox" checked={includeExamClasses} onChange={(e) => setIncludeExamClasses(e.target.checked)} />
            시험대비반 포함
          </label>
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

      {!loadingRoster && hasExisting && (
        <p className="muted" style={{ color: "#b45309" }}>
          이미 저장된 <strong>{period || "교시 구분 없음"}</strong> 체크 기록을 불러왔습니다 — 저장하면 그 기록을
          덮어씁니다. 다른 교시를 체크하려면 위 "교시"를 먼저 맞게 골라주세요.
        </p>
      )}

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
    {reviewItems && (
      <AbsenceReviewModal
        items={reviewItems}
        onClose={() => setReviewItems(null)}
        onChanged={() => {
          fetch(`/api/absence-review?date=${encodeURIComponent(date)}`)
            .then((r) => r.json())
            .then((data: { items: AbsenceReviewItem[] }) => setReviewItems(data.items ?? []));
        }}
      />
    )}
    </>
  );
}
