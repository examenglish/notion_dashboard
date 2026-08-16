"use client";

import { useEffect, useMemo, useState } from "react";

type StudentBrief = { id: string; name: string; school: string; grade: string | null; classIds: string[] };

const GRADE_ORDER = ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"];
function gradeSort(a: string, b: string) {
  const ia = GRADE_ORDER.indexOf(a);
  const ib = GRADE_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  return a.localeCompare(b, "ko");
}

// 반을 고르면 "이 반에 속한 학생"을 학생 한 명씩 편집창을 열지 않고도
// 한 화면에서 여러 명 체크해서 한 번에 반영할 수 있게 한다. 특히
// 시험대비반처럼 여러 학교/학년 학생을 대량으로 묶어 넣어야 할 때,
// 기존의 "학생 → 소속반 체크박스" 방식은 한 명씩 검색해 들어가야 해서
// 느렸던 것을 보완한다.
export default function ClassStudentAssignPanel({
  classId,
  className,
  onChanged,
}: {
  classId: string;
  className: string;
  onChanged: () => void;
}) {
  const [allStudents, setAllStudents] = useState<StudentBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [selectedSchool, setSelectedSchool] = useState("");
  const [selectedGrade, setSelectedGrade] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setDone(false);
    fetch("/api/students?q=")
      .then((r) => r.json())
      .then((list: StudentBrief[]) => {
        const arr = Array.isArray(list) ? list : [];
        setAllStudents(arr);
        setChecked(new Set(arr.filter((s) => s.classIds.includes(classId)).map((s) => s.id)));
      })
      .finally(() => setLoading(false));
    // classId가 바뀔 때마다 그 반의 현재 소속 학생으로 체크 상태를 다시 맞춘다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const schools = useMemo(() => {
    const set = new Set(allStudents.map((s) => s.school).filter(Boolean));
    return Array.from(set).sort();
  }, [allStudents]);

  const grades = useMemo(() => {
    if (!selectedSchool) return [];
    const set = new Set(
      allStudents.filter((s) => s.school === selectedSchool).map((s) => s.grade).filter((g): g is string => !!g)
    );
    return Array.from(set).sort(gradeSort);
  }, [allStudents, selectedSchool]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allStudents
      .filter((s) => (selectedSchool ? s.school === selectedSchool : true))
      .filter((s) => (selectedGrade ? s.grade === selectedGrade : true))
      .filter((s) => (q ? s.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [allStudents, selectedSchool, selectedGrade, query]);

  const originalIds = useMemo(
    () => new Set(allStudents.filter((s) => s.classIds.includes(classId)).map((s) => s.id)),
    [allStudents, classId]
  );
  const added = [...checked].filter((id) => !originalIds.has(id));
  const removed = [...originalIds].filter((id) => !checked.has(id));
  const dirty = added.length > 0 || removed.length > 0;

  function toggle(id: string) {
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setDone(false);
  }

  async function handleSave() {
    if (!dirty) return;
    if (!window.confirm(`${className}에 ${added.length}명 추가, ${removed.length}명 제외됩니다. 저장할까요?`)) return;
    setSaving(true);
    setError(null);
    try {
      const byId = new Map(allStudents.map((s) => [s.id, s]));
      const changedIds = [...added, ...removed];
      const results = await Promise.all(
        changedIds.map((id) => {
          const student = byId.get(id);
          if (!student) return Promise.resolve({ ok: true });
          const nextClassIds = checked.has(id)
            ? Array.from(new Set([...student.classIds, classId]))
            : student.classIds.filter((cid) => cid !== classId);
          return fetch(`/api/students/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ classIds: nextClassIds }),
          }).then((r) => r.json());
        })
      );
      const failed = results.filter((r: any) => r?.error);
      if (failed.length > 0) {
        setError(`${failed.length}건 저장에 실패했습니다. 다시 시도해주세요.`);
      } else {
        setDone(true);
        onChanged();
      }
      // 반영된 최신 소속 상태로 다시 맞춘다.
      fetch("/api/students?q=")
        .then((r) => r.json())
        .then((list: StudentBrief[]) => setAllStudents(Array.isArray(list) ? list : []));
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 15 }}>학생 일괄배정 — {className}</h2>
      <p className="muted" style={{ marginTop: -4 }}>
        체크한 학생이 이 반 소속이 됩니다. 학생을 한 명씩 검색해 들어가지 않고 여러 명을 한 번에 체크해서 저장하세요.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <input
          type="text"
          placeholder="이름으로 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: "1 1 160px" }}
        />
        <select
          value={selectedSchool}
          onChange={(e) => {
            setSelectedSchool(e.target.value);
            setSelectedGrade("");
          }}
        >
          <option value="">학교 전체</option>
          {schools.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={selectedGrade} onChange={(e) => setSelectedGrade(e.target.value)} disabled={!selectedSchool}>
          <option value="">학년 전체</option>
          {grades.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="muted">불러오는 중...</p>}
      {!loading && visible.length === 0 && <p className="muted">조건에 맞는 학생이 없습니다.</p>}

      {!loading && visible.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 4,
            marginTop: 10,
            maxHeight: 360,
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 8,
          }}
        >
          {visible.map((s) => (
            <label
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                margin: 0,
                padding: "3px 4px",
                borderRadius: 4,
                background: checked.has(s.id) ? "var(--primary-tint)" : undefined,
              }}
            >
              <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggle(s.id)} />
              {s.name}
              <span className="muted" style={{ fontSize: 11 }}>
                {s.school} {s.grade ?? ""}
              </span>
            </label>
          ))}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? "저장 중..." : `변경사항 저장${dirty ? ` (${added.length}명 추가 · ${removed.length}명 제외)` : ""}`}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          현재 체크됨: {checked.size}명
        </span>
      </div>
    </div>
  );
}
