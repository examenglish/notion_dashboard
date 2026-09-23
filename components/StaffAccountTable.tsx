"use client";

import { useEffect, useState } from "react";

type Account = { id: string; name: string; role: string | null; loginId: string; active: boolean; mustChangePin: boolean };

// 원장 전용 직원 계정 관리 — 기존 비밀번호를 보여주지 않고 새 비밀번호로만 재설정한다.
// 권한은 서버(/api/staff/accounts, /api/staff/[id]/password, /api/staff/[id])가 다시 확인한다.
export default function StaffAccountTable() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<Account | null>(null);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    fetch("/api/staff/accounts")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "불러오지 못했습니다.");
        setAccounts(d.accounts ?? []);
      })
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function submitReset() {
    if (!resetFor) return;
    setBusy(resetFor.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(resetFor.id)}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPin, confirmPin }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(d.error ?? "재설정에 실패했습니다.");
        return;
      }
      setNotice(`${resetFor.name}님의 비밀번호를 재설정했습니다. 다음 로그인 때 본인이 새 비밀번호로 바꾸게 됩니다.`);
      setResetFor(null);
      setNewPin("");
      setConfirmPin("");
      load();
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(a: Account) {
    const next = !a.active;
    if (!window.confirm(next ? `${a.name}님 계정을 다시 활성화할까요?` : `${a.name}님 계정을 비활성화할까요?\n로그인과 새 배정에서 제외되고, 작성한 기록은 그대로 남습니다.`)) return;
    setBusy(a.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(a.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resigned: !next }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setNotice(d.error ?? "처리에 실패했습니다.");
      load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card" style={{ gridColumn: "1 / -1" }}>
      <h2>직원 계정</h2>
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="muted">{notice}</p>}
      {accounts === null && !error ? (
        <p className="muted">불러오는 중...</p>
      ) : (
        <div className="table-scroll">
          <table className="sortable-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>역할</th>
                <th>로그인 ID</th>
                <th>상태</th>
                <th>계정관리</th>
              </tr>
            </thead>
            <tbody>
              {(accounts ?? []).map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{a.role ?? "-"}</td>
                  <td>{a.loginId}</td>
                  <td>
                    {a.active ? <span className="badge badge-success">활성</span> : <span className="badge">비활성</span>}
                    {a.active && a.mustChangePin && <span className="muted" style={{ fontSize: 12 }}> · 비번 변경 대기</span>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="secondary" disabled={busy === a.id} onClick={() => { setResetFor(a); setNewPin(""); setConfirmPin(""); setNotice(null); }}>
                      비밀번호 재설정
                    </button>{" "}
                    <button type="button" className="secondary" disabled={busy === a.id} onClick={() => toggleActive(a)}>
                      {a.active ? "비활성화" : "활성화"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {resetFor && (
        <div style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600 }}>{resetFor.name} 비밀번호 재설정</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <input type="password" inputMode="numeric" autoComplete="new-password" placeholder="새 비밀번호(숫자 4~6자리)" value={newPin} onChange={(e) => setNewPin(e.target.value)} />
            <input type="password" inputMode="numeric" autoComplete="new-password" placeholder="새 비밀번호 확인" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} />
            <button type="button" disabled={busy === resetFor.id || !newPin || !confirmPin} onClick={submitReset}>
              변경
            </button>
            <button type="button" className="secondary" onClick={() => setResetFor(null)}>
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
