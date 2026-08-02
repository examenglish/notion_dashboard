"use client";

import { useState } from "react";

type Candidate = { id: string; label: string };

type NlResponse = {
  ok: boolean;
  message?: string;
  needsConfirm?: boolean;
  needsSelection?: boolean;
  candidates?: Candidate[];
};

export default function NaturalLanguageInput({ onSaved }: { onSaved?: () => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  async function submit(
    currentText: string,
    opts: { confirmNewStudent?: boolean; selectedStudentId?: string; forceNewStudent?: boolean } = {}
  ): Promise<NlResponse> {
    const res = await fetch("/api/nl-input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: currentText, ...opts }),
    });
    return res.json();
  }

  function finish(data: NlResponse) {
    setResult({ ok: !!data.ok, message: data.message ?? "처리 중 오류가 발생했습니다." });
    if (data.ok) {
      setText("");
      setPendingText(null);
      setCandidates(null);
      onSaved?.();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || saving) return;
    const currentText = text;
    setSaving(true);
    setResult(null);
    setCandidates(null);
    try {
      let data = await submit(currentText);
      if (!data.ok && data.needsConfirm && data.message && window.confirm(data.message)) {
        data = await submit(currentText, { confirmNewStudent: true });
      } else if (!data.ok && data.needsSelection) {
        setPendingText(currentText);
        setCandidates(data.candidates ?? []);
        setResult({ ok: false, message: data.message ?? "누구인가요?" });
        return;
      }
      finish(data);
    } catch {
      setResult({ ok: false, message: "네트워크 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  }

  async function pickCandidate(id: string) {
    if (!pendingText || saving) return;
    setSaving(true);
    try {
      const data = await submit(pendingText, { selectedStudentId: id });
      finish(data);
    } catch {
      setResult({ ok: false, message: "네트워크 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  }

  async function registerAsNew() {
    if (!pendingText || saving) return;
    setSaving(true);
    try {
      const data = await submit(pendingText, { forceNewStudent: true });
      finish(data);
    } catch {
      setResult({ ok: false, message: "네트워크 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>이그잼 AI</h2>
      <p className="muted">
        예: &ldquo;김민준 학생 내일 감기몸살로 결석해요, 학부모가 전화주셨어요&rdquo; / &ldquo;황지환 8/5 보강, 이강사 담당&rdquo;
        <br />
        나만 보는 할일: &ldquo;/to do list 문법책 재고 주문하기&rdquo;
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
        <p className={result.ok ? "success-box" : "error-text"} style={{ marginTop: 10, fontSize: "0.8em" }}>
          {result.ok ? "✅ " : "⚠️ "}
          {result.message}
        </p>
      )}
      {candidates && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              className="secondary"
              disabled={saving}
              onClick={() => pickCandidate(c.id)}
              style={{ textAlign: "left" }}
            >
              {c.label}
            </button>
          ))}
          <button type="button" className="secondary" disabled={saving} onClick={registerAsNew}>
            새로운 학생으로 등록
          </button>
        </div>
      )}
    </div>
  );
}
