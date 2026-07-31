"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ChangePinPage() {
  const router = useRouter();
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPin !== confirmPin) {
      setError("두 번호가 서로 다릅니다. 다시 확인해주세요.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/change-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "변경에 실패했습니다.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-box" onSubmit={handleSubmit}>
        <h1>비밀번호 변경</h1>
        <p className="muted">
          임시 비밀번호(1111)로 로그인하셨습니다. 계속 사용하시려면 본인만의 새 비밀번호로 바꿔주세요.
        </p>

        <label htmlFor="newPin">새 PIN (4~6자리 숫자)</label>
        <input
          id="newPin"
          type="password"
          inputMode="numeric"
          pattern="\d{4,6}"
          maxLength={6}
          value={newPin}
          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
          required
        />

        <label htmlFor="confirmPin">새 PIN 확인</label>
        <input
          id="confirmPin"
          type="password"
          inputMode="numeric"
          pattern="\d{4,6}"
          maxLength={6}
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
          required
        />

        {error && <p className="error-text">{error}</p>}

        <div style={{ marginTop: 20 }}>
          <button type="submit" disabled={loading || newPin.length < 4} style={{ width: "100%" }}>
            {loading ? "변경 중..." : "비밀번호 변경"}
          </button>
        </div>
      </form>
    </div>
  );
}
