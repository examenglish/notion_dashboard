"use client";

import { useState } from "react";

export default function NaturalLanguageInput({ onSaved }: { onSaved?: () => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || saving) return;
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/nl-input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      setResult({ ok: !!data.ok, message: data.message ?? "처리 중 오류가 발생했습니다." });
      if (data.ok) {
        setText("");
        onSaved?.();
      }
    } catch {
      setResult({ ok: false, message: "네트워크 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>자연어 입력</h2>
      <p className="muted">
        예: &ldquo;김민준 학생 내일 감기몸살로 결석해요, 학부모가 전화주셨어요&rdquo; / &ldquo;황지환 8/5 보강, 이강사 담당&rdquo;
      </p>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="자유롭게 입력하세요"
          style={{ flex: 1, minHeight: 44 }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <button type="submit" disabled={saving || !text.trim()}>
          {saving ? "처리 중..." : "저장"}
        </button>
      </form>
      {result && (
        <p className={result.ok ? "success-box" : "error-text"} style={{ marginTop: 10 }}>
          {result.ok ? "✅ " : "⚠️ "}
          {result.message}
        </p>
      )}
    </div>
  );
}
