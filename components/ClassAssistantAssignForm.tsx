"use client";

import { useEffect, useState } from "react";
import { stripClassSuffix } from "@/lib/format";

// assistantIds는 재직 조교만(서버 listClasses가 거름). needsReassign은 비활성 조교만
// 남아 재직 담당자가 없는 반.
type ClassOption = { id: string; name: string; assistantIds: string[]; needsReassign?: boolean };
type StaffOption = { id: string; name: string; role: string | null };

function confirmSave() {
  return window.confirm("저장하시겠습니까?");
}

// 원장/행정이 반별로 담당 조교를 지정해두면, 조교는 클리닉 기록을 작성할 때
// 학생을 한 명씩 검색하는 대신 "내 담당반" 명단을 한 번에 불러올 수 있다.
export default function ClassAssistantAssignForm() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [classId, setClassId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/classes")
      .then((r) => r.json())
      .then((list: ClassOption[]) => {
        setClasses(list);
        if (list.length > 0) setClassId(list[0].id);
      });
    fetch("/api/staff")
      .then((r) => r.json())
      .then(setStaff);
  }, []);

  useEffect(() => {
    const cls = classes.find((c) => c.id === classId);
    setSelected(cls?.assistantIds ?? []);
    setDone(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const assistants = staff.filter((s) => s.role === "조교");

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function handleSave() {
    if (!confirmSave()) return;
    setSaving(true);
    setDone(false);
    setError(null);
    try {
      const res = await fetch(`/api/classes/${classId}/assistants`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assistantIds: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setClasses((cur) => cur.map((c) => (c.id === classId ? { ...c, assistantIds: selected, needsReassign: false } : c)));
      setDone(true);
    } finally {
      setSaving(false);
    }
  }

  // 내부 id를 화면에 그대로 내보내지 않는다(직원 목록을 아직 못 불러온 순간 등).
  const assistantName = (id: string) => staff.find((s) => s.id === id)?.name ?? "…";

  return (
    <div className="card">
      <h2>반별 담당 조교 배정 <span className="title-lab-tag">(실험실)</span></h2>
      <p className="muted">조교가 클리닉 기록 작성 시 반 전체 명단을 한 번에 불러올 수 있도록 반별 담당 조교를 지정합니다.</p>

      {classes.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ marginTop: 0 }}>현재 배정 현황 (클릭하면 아래에서 바로 수정)</label>
          <div className="table-scroll" style={{ maxHeight: 260 }}>
            <table>
              <thead>
                <tr>
                  <th>반</th>
                  <th>담당 조교</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setClassId(c.id)}
                    style={{ cursor: "pointer", background: c.id === classId ? "#eaf0ff" : undefined }}
                  >
                    <td>{stripClassSuffix(c.name)}</td>
                    <td>
                      {c.assistantIds.length > 0 ? (
                        c.assistantIds.map(assistantName).join(", ")
                      ) : c.needsReassign ? (
                        <span className="error-text">미배정 (재배정 필요)</span>
                      ) : (
                        <span className="muted">미배정</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <label htmlFor="assignClass">반</label>
      <select id="assignClass" value={classId} onChange={(e) => setClassId(e.target.value)}>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {stripClassSuffix(c.name)}
          </option>
        ))}
      </select>

      <label style={{ marginTop: 12 }}>담당 조교 (복수 선택 가능)</label>
      {assistants.length === 0 ? (
        <p className="muted">등록된 조교가 없습니다.</p>
      ) : (
        <div className="class-checkbox-grid">
          {assistants.map((a) => (
            <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, margin: 0 }}>
              <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} />
              {a.name}
            </label>
          ))}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

      <div style={{ marginTop: 16 }}>
        <button type="button" disabled={saving || !classId} onClick={handleSave}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
