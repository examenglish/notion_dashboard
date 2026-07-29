"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type StaffOption = { id: string; name: string };

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/staff")
      .then((r) => r.json())
      .then((list: StaffOption[]) => {
        setStaff(list);
        if (list.length > 0) setName(list[0].name);
      })
      .catch(() => setError("직원 목록을 불러오지 못했습니다."));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "로그인에 실패했습니다.");
        return;
      }
      router.push(params.get("next") ?? "/dashboard");
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
        <h1>이그잼영어학원</h1>
        <p className="muted">직원 로그인</p>

        <label htmlFor="name">이름</label>
        <select id="name" value={name} onChange={(e) => setName(e.target.value)}>
          {staff.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>

        <label htmlFor="pin">PIN (4~6자리)</label>
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          pattern="\d{4,6}"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          required
        />

        {error && <p className="error-text">{error}</p>}

        <div style={{ marginTop: 20 }}>
          <button type="submit" disabled={loading || !name} style={{ width: "100%" }}>
            {loading ? "확인 중..." : "로그인"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
