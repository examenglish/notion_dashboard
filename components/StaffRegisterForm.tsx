"use client";

import { useState } from "react";

function confirmSave(name: string, role: string) {
  return window.confirm(`${name} (${role}) 계정을 등록하시겠습니까?`);
}

// 원장/행정이 강사·조교 로그인 계정을 직접 만들 수 있게 하는 폼. 등록 즉시
// "비번변경필요"가 켜져서, 등록된 직원이 처음 로그인하면 자기 비밀번호로
// 바꾸도록 유도한다(관리자가 정한 초기 비밀번호를 계속 쓰지 않도록).
export default function StaffRegisterForm() {
  const [name, setName] = useState("");
  const [role, setRole] = useState<"강사" | "조교">("강사");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) {
      setError("이름을 입력해주세요.");
      return;
    }
    if (!/^\d{4,8}$/.test(pin)) {
      setError("비밀번호는 숫자 4~8자리로 입력해주세요.");
      return;
    }
    if (!confirmSave(name.trim(), role)) return;
    setSaving(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), role, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "등록에 실패했습니다.");
        return;
      }
      setDone(`${name.trim()} (${role}) 계정이 등록됐습니다. 첫 로그인 시 비밀번호 변경이 필요합니다.`);
      setName("");
      setPin("");
      setRole("강사");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>강사·조교 계정 등록 <span className="title-lab-tag">(실험실)</span></h2>
      <p className="muted">
        새 강사·조교의 로그인 계정을 만듭니다. 여기서 정한 비밀번호는 임시 비밀번호이며, 등록된 직원이 처음
        로그인하면 자기 비밀번호로 바꾸게 됩니다.
      </p>

      <label htmlFor="staffRegName">이름</label>
      <input
        id="staffRegName"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="예: 서도영T"
      />

      <label style={{ marginTop: 10 }}>역할</label>
      <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 400 }}>
          <input type="radio" checked={role === "강사"} onChange={() => setRole("강사")} />
          강사
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 400 }}>
          <input type="radio" checked={role === "조교"} onChange={() => setRole("조교")} />
          조교
        </label>
      </div>

      <label htmlFor="staffRegPin" style={{ marginTop: 10 }}>초기 비밀번호 (숫자 4~8자리)</label>
      <input
        id="staffRegPin"
        type="text"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
        placeholder="예: 123456"
        style={{ maxWidth: 160 }}
      />

      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-box" style={{ marginTop: 12 }}>{done}</p>}

      <div style={{ marginTop: 16 }}>
        <button type="button" disabled={saving} onClick={handleSave}>
          {saving ? "등록 중..." : "계정 등록"}
        </button>
      </div>
    </div>
  );
}
