"use client";

import { useEffect, useMemo, useState } from "react";
import { defaultLevelForGrade, effectiveLevel, formatLevel, stripClassSuffix } from "@/lib/format";
import StudentEditModal from "./StudentEditModal";

type StudentRow = {
  id: string;
  name: string;
  school: string;
  grade: string | null;
  status: string | null;
  levelOverride: number | null;
  classNames: string[];
};

const LEVEL_OPTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 1, 2, 3, 4, 5, 6];
const GRADE_ORDER = ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"];

type SortKey = "level" | "name" | "school" | "class";

// 드롭다운을 바꾸는 즉시 저장하지 않는다 — 훑어보다가 실수로 바뀌는 걸
// 막기 위해, 선택만 로컬에 담아두고 "저장" 버튼을 눌러야 실제로 반영된다.
function LevelSelect({ row, onSaved }: { row: StudentRow; onSaved: (levelOverride: number | null) => void }) {
  const [draft, setDraft] = useState<string>(row.levelOverride === null ? "" : String(row.levelOverride));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(row.levelOverride === null ? "" : String(row.levelOverride));
  }, [row.levelOverride]);

  const dirty = draft !== (row.levelOverride === null ? "" : String(row.levelOverride));

  async function handleSave() {
    if (!window.confirm("Lv를 저장하시겠습니까?")) return;
    const levelOverride = draft === "" ? null : Number(draft);
    setSaving(true);
    try {
      await fetch(`/api/students/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levelOverride }),
      });
      onSaved(levelOverride);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <select value={draft} disabled={saving} onChange={(e) => setDraft(e.target.value)} style={{ maxWidth: 200 }}>
        <option value="">학년 기본값 (Lv{defaultLevelForGrade(row.grade) ?? "-"})</option>
        {LEVEL_OPTIONS.map((lv) => (
          <option key={lv} value={lv}>
            Lv{lv} 직접 설정
          </option>
        ))}
      </select>
      <button type="button" className="secondary" disabled={!dirty || saving} onClick={handleSave}>
        {saving ? "저장 중..." : "저장"}
      </button>
    </div>
  );
}

// 학년별 기본 Lv(초1=0.1~초6=0.6, 중1=1~중3=3, 고1=4~고3=6)로 학생을
// 한눈에 파악하고, 학년보다 레벨이 높거나 낮은 학생만 드롭다운으로 Lv를
// 직접 override한다 — 원장 전용 화면(TopBar에서 원장에게만 노출).
export default function StudentLevelClient() {
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("level");
  const [sortAsc, setSortAsc] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  function reload() {
    fetch("/api/students")
      .then((r) => r.json())
      .then((list: StudentRow[]) => setStudents(list));
  }

  useEffect(reload, []);

  function updateRow(id: string, levelOverride: number | null) {
    setStudents((cur) => (cur ? cur.map((s) => (s.id === id ? { ...s, levelOverride } : s)) : cur));
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((a) => !a);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  // 학년/반 드롭다운에 실제로 존재하는 값만 보여준다 — 등록된 적 없는
  // 학년/반까지 목록에 끼워넣지 않기 위함.
  const gradeOptions = useMemo(() => {
    if (!students) return [];
    const present = new Set(students.map((s) => s.grade).filter((g): g is string => !!g));
    return GRADE_ORDER.filter((g) => present.has(g));
  }, [students]);

  const classOptions = useMemo(() => {
    if (!students) return [];
    const names = new Set<string>();
    for (const s of students) for (const c of s.classNames) names.add(stripClassSuffix(c));
    return Array.from(names).sort((a, b) => a.localeCompare(b, "ko"));
  }, [students]);

  const rows = useMemo(() => {
    if (!students) return [];
    const q = query.trim();
    let filtered = students.filter((s) => (includeInactive ? true : s.status !== "퇴원" && s.status !== "휴원"));
    if (q) filtered = filtered.filter((s) => s.name.includes(q) || s.school.includes(q));
    if (gradeFilter) filtered = filtered.filter((s) => s.grade === gradeFilter);
    if (classFilter) filtered = filtered.filter((s) => s.classNames.some((c) => stripClassSuffix(c) === classFilter));
    const withLevel = filtered.map((s) => ({
      ...s,
      level: effectiveLevel(s.grade, s.levelOverride),
      classLabel: s.classNames.map(stripClassSuffix).join(", ") || "-",
    }));
    withLevel.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "level") cmp = (a.level ?? -1) - (b.level ?? -1);
      else if (sortKey === "school") cmp = a.school.localeCompare(b.school, "ko");
      else if (sortKey === "class") cmp = a.classLabel.localeCompare(b.classLabel, "ko");
      else cmp = a.name.localeCompare(b.name, "ko");
      return sortAsc ? cmp : -cmp;
    });
    return withLevel;
  }, [students, query, gradeFilter, classFilter, includeInactive, sortKey, sortAsc]);

  return (
    <div className="page">
      <div className="card">
        <h2>학생레벨(Lv) 현황</h2>
        <p className="muted">
          학년별 기본 Lv는 초1=Lv0.1 ~ 초6=Lv0.6, 중1=Lv1 ~ 중3=Lv3, 고1=Lv4 ~ 고3=Lv6입니다. 같은 학년이라도
          실제 레벨이 높거나 낮은 학생은 드롭다운에서 직접 Lv를 지정할 수 있고, "학년 기본값"을 다시 선택하면
          override가 지워집니다.
        </p>

        <div className="field-row">
          <div>
            <label htmlFor="levelSearch">이름/학교 검색</label>
            <input
              id="levelSearch"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이름 또는 학교"
            />
          </div>
          <div>
            <label htmlFor="levelGradeFilter">학년</label>
            <select id="levelGradeFilter" value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}>
              <option value="">전체 학년</option>
              {gradeOptions.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-row" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="levelClassFilter">반</label>
            <select id="levelClassFilter" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
              <option value="">전체 반</option>
              {classOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 28 }}>
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              휴원·퇴원 포함
            </label>
          </div>
        </div>

        {students === null ? (
          <p className="muted">불러오는 중...</p>
        ) : rows.length === 0 ? (
          <p className="muted">해당하는 학생이 없습니다.</p>
        ) : (
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table className="sortable-table">
              <thead>
                <tr>
                  <th className={sortKey === "name" ? "active" : ""} onClick={() => toggleSort("name")}>
                    이름 {sortKey === "name" ? (sortAsc ? "▲" : "▼") : ""}
                  </th>
                  <th className={sortKey === "school" ? "active" : ""} onClick={() => toggleSort("school")}>
                    학교 {sortKey === "school" ? (sortAsc ? "▲" : "▼") : ""}
                  </th>
                  <th>학년</th>
                  <th className={sortKey === "class" ? "active" : ""} onClick={() => toggleSort("class")}>
                    반 {sortKey === "class" ? (sortAsc ? "▲" : "▼") : ""}
                  </th>
                  <th>상태</th>
                  <th className={sortKey === "level" ? "active" : ""} onClick={() => toggleSort("level")}>
                    Lv {sortKey === "level" ? (sortAsc ? "▲" : "▼") : ""}
                  </th>
                  <th>Lv 설정</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setEditingId(s.id);
                        }}
                      >
                        {s.name}
                      </a>
                    </td>
                    <td>{s.school || "-"}</td>
                    <td>{s.grade || "-"}</td>
                    <td>{s.classLabel}</td>
                    <td>{s.status || "-"}</td>
                    <td>
                      <strong>{formatLevel(s.level)}</strong>
                      {s.levelOverride !== null && <span className="badge" style={{ marginLeft: 6 }}>직접설정</span>}
                    </td>
                    <td>
                      <LevelSelect row={s} onSaved={(lv) => updateRow(s.id, lv)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingId && (
        <StudentEditModal studentId={editingId} onClose={() => setEditingId(null)} onSaved={reload} />
      )}
    </div>
  );
}
