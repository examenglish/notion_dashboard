"use client";

import { useEffect, useMemo, useState } from "react";
import { defaultLevelForGrade, effectiveLevel, formatLevel } from "@/lib/format";

type StudentRow = {
  id: string;
  name: string;
  school: string;
  grade: string | null;
  status: string | null;
  levelOverride: number | null;
};

const LEVEL_OPTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 1, 2, 3, 4, 5, 6];

type SortKey = "level" | "name";

function LevelSelect({ row, onSaved }: { row: StudentRow; onSaved: (levelOverride: number | null) => void }) {
  const [saving, setSaving] = useState(false);

  async function handleChange(value: string) {
    const levelOverride = value === "" ? null : Number(value);
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
    <select
      value={row.levelOverride ?? ""}
      disabled={saving}
      onChange={(e) => handleChange(e.target.value)}
      style={{ maxWidth: 220 }}
    >
      <option value="">학년 기본값 (Lv{defaultLevelForGrade(row.grade) ?? "-"})</option>
      {LEVEL_OPTIONS.map((lv) => (
        <option key={lv} value={lv}>
          Lv{lv} 직접 설정
        </option>
      ))}
    </select>
  );
}

// 학년별 기본 Lv(초1=0.1~초6=0.6, 중1=1~중3=3, 고1=4~고3=6)로 학생을
// 한눈에 파악하고, 학년보다 레벨이 높거나 낮은 학생만 드롭다운으로 Lv를
// 직접 override한다 — 원장 전용 화면(TopBar에서 원장에게만 노출).
export default function StudentLevelClient() {
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("level");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    fetch("/api/students")
      .then((r) => r.json())
      .then((list: StudentRow[]) => setStudents(list));
  }, []);

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

  const rows = useMemo(() => {
    if (!students) return [];
    const q = query.trim();
    let filtered = students.filter((s) => (includeInactive ? true : s.status !== "퇴원" && s.status !== "휴원"));
    if (q) filtered = filtered.filter((s) => s.name.includes(q) || s.school.includes(q));
    const withLevel = filtered.map((s) => ({ ...s, level: effectiveLevel(s.grade, s.levelOverride) }));
    withLevel.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "level") {
        cmp = (a.level ?? -1) - (b.level ?? -1);
      } else {
        cmp = a.name.localeCompare(b.name, "ko");
      }
      return sortAsc ? cmp : -cmp;
    });
    return withLevel;
  }, [students, query, includeInactive, sortKey, sortAsc]);

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
                  <th>학교</th>
                  <th>학년</th>
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
                    <td>{s.name}</td>
                    <td>{s.school || "-"}</td>
                    <td>{s.grade || "-"}</td>
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
    </div>
  );
}
