"use client";

import { useEffect, useState } from "react";
import StaffPicker from "./StaffPicker";

function confirmResign(name: string) {
  return window.confirm(
    `${name}님을 퇴사 처리하시겠습니까?\n\n로그인과 새 배정 목록에서 제외되며, 그동안 작성한 기록은 지워지지 않고 그대로 남습니다.`
  );
}

// 원장/행정이 강사·조교의 퇴사를 처리하는 폼. Notion 페이지를 지우는 게
// 아니라 "퇴사" 체크박스만 켜서, 로그인과 새 배정 목록에서만 제외되고
// 과거에 작성한 클리닉/수업 기록은 그대로 남는다(lib/notion.ts의
// setStaffResigned 주석 참고).
export default function StaffResignForm() {
  const [name, setName] = useState("");
  const [allStaff, setAllStaff] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/staff")
      .then((r) => r.json())
      .then((list: { id: string; name: string }[]) => setAllStaff(list))
      .catch(() => setAllStaff([]));
  }, []);

  async function handleResign() {
    const staff = allStaff.find((s) => s.name === name.trim());
    if (!staff) {
      setError("이름이 목록에 없습니다. 검색 결과에서 선택해주세요.");
      return;
    }
    if (!confirmResign(staff.name)) return;
    setSaving(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/staff/${staff.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resigned: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "처리에 실패했습니다.");
        return;
      }
      setDone(`${staff.name}님을 퇴사 처리했습니다. 작성한 기록은 그대로 유지됩니다.`);
      setName("");
      setAllStaff((cur) => cur.filter((s) => s.id !== staff.id));
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>강사·조교 퇴사 처리 <span className="title-lab-tag">(실험실)</span></h2>
      <p className="muted">
        로그인 계정을 막고 새 배정 목록에서 제외합니다. 그동안 작성한 클리닉/수업 기록은 지워지지 않고 그대로 남습니다.
      </p>

      <StaffPicker value={name} onChange={setName} label="퇴사 처리할 직원" />

      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-box" style={{ marginTop: 12 }}>{done}</p>}

      <div style={{ marginTop: 16 }}>
        <button type="button" disabled={saving || !name.trim()} onClick={handleResign}>
          {saving ? "처리 중..." : "퇴사 처리"}
        </button>
      </div>
    </div>
  );
}
