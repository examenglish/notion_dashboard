"use client";

import { useState } from "react";
import ManualHelpLink from "@/components/ManualHelpLink";

type CreatedTask = { id: string; typeLabel: string; studentName: string; ownerName: string | null; pool: boolean };

// 대시보드 최상단 대형 AI 입력창(섹션2/3) — 문장 하나를 여러 업무로 쪼개서
// 자동배정까지 끝낸다. 기존 NaturalLanguageInput(학생기록 단건 입력)과는
// 완전히 별도 컴포넌트/엔드포인트(/api/tasks/from-text)라 기존 입력창의
// 동작에는 전혀 영향이 없다.
export default function AiTaskComposer({ onCreated }: { onCreated?: () => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedTask[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || saving) return;
    setSaving(true);
    setMessage(null);
    setCreated(null);
    setWarnings([]);
    try {
      const res = await fetch("/api/tasks/from-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMessage(data.message ?? "업무를 만들지 못했습니다.");
        return;
      }
      setCreated(data.tasks ?? []);
      setWarnings(data.warnings ?? []);
      setText("");
      onCreated?.();
    } catch {
      setMessage("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ borderWidth: 2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>✨ 이그잼 AI</h2>
        <ManualHelpLink path="/director" />
      </div>
      <p className="muted">
        <strong>무엇을 처리할까요?</strong>
      </p>
      <p className="muted" style={{ fontSize: "0.78em", marginTop: -6 }}>
        예: "민수 본문 암기 안 됨. 관계대명사 문제 뽑아서 오늘 다시 확인" — 한 문장에 여러 업무가 섞여 있어도 자동으로
        나눠서 근무 중인 담당자에게 배정합니다.
      </p>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="학생 상황이나 업무를 말해주세요"
          style={{ flex: 1, minHeight: 56 }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <button type="submit" disabled={saving || !text.trim()}>
          {saving ? "처리 중..." : "업무 만들기"}
        </button>
      </form>
      {message && (
        <p className="error-text" style={{ marginTop: 10, fontSize: "0.8em" }}>
          ⚠️ {message}
        </p>
      )}
      {created && (
        <div className="success-box" style={{ marginTop: 10, fontSize: "0.85em" }}>
          ✅ 업무 {created.length}건을 등록했습니다.
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {created.map((t) => (
              <li key={t.id}>
                {t.typeLabel}
                {t.studentName ? ` · ${t.studentName}` : ""} — {t.ownerName ? `${t.ownerName} 배정` : t.pool ? "공용업무풀" : "미배정"}
              </li>
            ))}
          </ul>
          {warnings.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--danger, #c0392b)" }}>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
