"use client";

import { useEffect, useState } from "react";

type StaffOption = { id: string; name: string; role: string | null; workDays: string[]; workStart: string; workEnd: string };

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];

function confirmSave() {
  return window.confirm("저장하시겠습니까?");
}

// 조교마다 근무 요일/시간이 달라서, 보강/재시/클리닉을 배정할 때 그 시간에
// 실제로 일하지 않는 조교에게 배정되면 아무도 처리하지 못한 채 그냥
// 누락된다. 여기서 미리 근무표를 등록해두면 배정 화면에서 시간이 안 맞는
// 조교를 바로 알아볼 수 있다.
export default function StaffScheduleForm() {
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [staffId, setStaffId] = useState("");
  const [workDays, setWorkDays] = useState<string[]>([]);
  const [workStart, setWorkStart] = useState("");
  const [workEnd, setWorkEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/staff")
      .then((r) => r.json())
      .then((list: StaffOption[]) => {
        setStaff(list);
        const firstAssistant = list.find((s) => s.role === "조교");
        if (firstAssistant) setStaffId(firstAssistant.id);
      });
  }, []);

  useEffect(() => {
    const s = staff.find((x) => x.id === staffId);
    setWorkDays(s?.workDays ?? []);
    setWorkStart(s?.workStart ?? "");
    setWorkEnd(s?.workEnd ?? "");
    setDone(false);
    setError(null);
  }, [staffId, staff]);

  function toggleDay(day: string) {
    setWorkDays((cur) => (cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day]));
  }

  async function handleSave() {
    if (!confirmSave()) return;
    setSaving(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch(`/api/staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workDays, workStart, workEnd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setStaff((cur) => cur.map((s) => (s.id === staffId ? { ...s, workDays, workStart, workEnd } : s)));
      setDone(true);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>조교 근무 요일/시간 <span className="title-lab-tag">(실험실)</span></h2>
      <p className="muted">
        여기서 등록한 근무 요일/시간은 보강·재시·클리닉 배정 화면에서 담당자를 고를 때
        "근무시간 아님" 경고로 표시됩니다. 비워두면 항상 가능한 것으로 취급합니다.
      </p>

      <label>직원 선택</label>
      <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.role ?? "-"})
          </option>
        ))}
      </select>

      {staffId && (
        <>
          <label style={{ marginTop: 12 }}>근무 요일</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {DAYS.map((d) => (
              <label key={d} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, margin: 0 }}>
                <input type="checkbox" checked={workDays.includes(d)} onChange={() => toggleDay(d)} />
                {d}
              </label>
            ))}
          </div>

          <div className="field-row" style={{ marginTop: 12 }}>
            <div>
              <label htmlFor="workStart">근무 시작</label>
              <input id="workStart" type="text" value={workStart} onChange={(e) => setWorkStart(e.target.value)} placeholder="예: 14:00" />
            </div>
            <div>
              <label htmlFor="workEnd">근무 종료</label>
              <input id="workEnd" type="text" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} placeholder="예: 22:00" />
            </div>
          </div>

          {error && <p className="error-text">{error}</p>}
          {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

          <div style={{ marginTop: 16 }}>
            <button type="button" disabled={saving} onClick={handleSave}>
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
