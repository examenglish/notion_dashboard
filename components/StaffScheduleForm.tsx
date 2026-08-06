"use client";

import { useEffect, useState } from "react";
import type { WorkHours } from "@/lib/format";

type StaffOption = { id: string; name: string; role: string | null; workHours: WorkHours };

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];

function confirmSave() {
  return window.confirm("저장하시겠습니까?");
}

// 조교마다 근무 요일이 다른 것은 물론, 같은 조교라도 요일별로 근무시간이
// 다를 수 있어(예: 월요일은 14~18시, 수요일은 16~20시) 요일 하나하나마다
// 따로 시작/종료 시간을 입력받는다. 여기서 등록해두면 보강/재시/클리닉을
// 배정할 때 그 날짜·시간에 실제로 일하지 않는 조교를 바로 알아볼 수 있다.
export default function StaffScheduleForm() {
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [staffId, setStaffId] = useState("");
  const [dayHours, setDayHours] = useState<WorkHours>({});
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
    setDayHours(s?.workHours ?? {});
    setDone(false);
    setError(null);
  }, [staffId, staff]);

  function toggleDay(day: string) {
    setDayHours((cur) => {
      if (cur[day]) {
        const next = { ...cur };
        delete next[day];
        return next;
      }
      return { ...cur, [day]: { start: "", end: "" } };
    });
  }

  function setDayField(day: string, field: "start" | "end", value: string) {
    setDayHours((cur) => ({ ...cur, [day]: { ...cur[day], [field]: value } }));
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
        body: JSON.stringify({ workHours: dayHours }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setStaff((cur) => cur.map((s) => (s.id === staffId ? { ...s, workHours: dayHours } : s)));
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
        요일별로 근무시간이 달라도 요일마다 따로 입력할 수 있습니다. 여기서 등록한 근무 요일/시간은
        보강·재시·클리닉 배정 화면에서 담당자를 고를 때 "근무시간 아님" 경고로 표시됩니다. 요일을 체크하지
        않으면 그 요일엔 근무하지 않는 것으로, 아무 요일도 등록하지 않으면 항상 가능한 것으로 취급합니다.
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
          <label style={{ marginTop: 12 }}>요일별 근무시간</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {DAYS.map((d) => {
              const enabled = !!dayHours[d];
              return (
                <div key={d} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, margin: 0, width: 48 }}>
                    <input type="checkbox" checked={enabled} onChange={() => toggleDay(d)} />
                    {d}
                  </label>
                  {enabled && (
                    <>
                      <input
                        type="text"
                        value={dayHours[d]?.start ?? ""}
                        onChange={(e) => setDayField(d, "start", e.target.value)}
                        placeholder="시작 예: 14:00"
                        style={{ maxWidth: 120 }}
                      />
                      <span className="muted">~</span>
                      <input
                        type="text"
                        value={dayHours[d]?.end ?? ""}
                        onChange={(e) => setDayField(d, "end", e.target.value)}
                        placeholder="종료 예: 18:00"
                        style={{ maxWidth: 120 }}
                      />
                    </>
                  )}
                </div>
              );
            })}
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
