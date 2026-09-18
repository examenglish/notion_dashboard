"use client";

import { useState } from "react";
import ManualHelpLink from "@/components/ManualHelpLink";

type Candidate = { id: string; label: string };
type CreatedTask = { id: string; typeLabel: string; studentName: string; ownerName: string | null; pool: boolean };

type AiResponse = {
  ok: boolean;
  mode?: "tasks" | "legacy";
  message?: string;
  needsConfirm?: boolean;
  needsSelection?: boolean;
  candidates?: Candidate[];
  tasks?: CreatedTask[];
  warnings?: string[];
};

const ROLE_PLACEHOLDER: Record<string, string> = {
  원장: "학생 상황이나 업무를 말해주세요",
  강사: "학생 상황이나 업무를 말해주세요",
  조교: "업무 결과나 학생 상황을 입력하세요",
  행정: "연락 결과나 처리할 업무를 입력하세요",
};

// 대시보드의 유일한 AI 입력창(섹션2 "구글 첫페이지" 요청에 따라 전면 배치) —
// 기존에 따로 있던 "업무 만들기"(AiTaskComposer)와 "학생기록 자연어 입력"
// (NaturalLanguageInput)을 하나로 합쳤다. 백엔드는 두 로직을 그대로
// 이어붙인 /api/ai-input 하나만 쓴다(각 로직 자체는 안 건드림).
export default function AiUnifiedInput({ role, onSaved }: { role: string; onSaved?: () => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [createdTasks, setCreatedTasks] = useState<CreatedTask[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  async function submit(currentText: string, opts: { confirmNewStudent?: boolean; selectedStudentId?: string; forceNewStudent?: boolean } = {}): Promise<AiResponse> {
    const res = await fetch("/api/ai-input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: currentText, ...opts }),
    });
    return res.json();
  }

  function finish(data: AiResponse) {
    if (data.mode === "tasks" && data.ok) {
      setCreatedTasks(data.tasks ?? []);
      setWarnings(data.warnings ?? []);
      setMessage(null);
      setText("");
      setPendingText(null);
      setCandidates(null);
      onSaved?.();
      return;
    }
    setCreatedTasks(null);
    setMessage({ ok: !!data.ok, text: data.message ?? "처리 중 오류가 발생했습니다." });
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
    setMessage(null);
    setCreatedTasks(null);
    setCandidates(null);
    try {
      let data = await submit(currentText);
      if (!data.ok && data.needsConfirm && data.message && window.confirm(data.message)) {
        data = await submit(currentText, { confirmNewStudent: true });
      } else if (!data.ok && data.needsSelection) {
        setPendingText(currentText);
        setCandidates(data.candidates ?? []);
        setMessage({ ok: false, text: data.message ?? "누구인가요?" });
        return;
      }
      finish(data);
    } catch {
      setMessage({ ok: false, text: "네트워크 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  }

  async function pickCandidate(id: string) {
    if (!pendingText || saving) return;
    setSaving(true);
    try {
      finish(await submit(pendingText, { selectedStudentId: id }));
    } catch {
      setMessage({ ok: false, text: "네트워크 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  }

  async function registerAsNew() {
    if (!pendingText || saving) return;
    setSaving(true);
    try {
      finish(await submit(pendingText, { forceNewStudent: true }));
    } catch {
      setMessage({ ok: false, text: "네트워크 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  }

  const placeholder = ROLE_PLACEHOLDER[role] ?? "무엇을 처리할까요?";

  return (
    <div className="ai-hero">
      <a href="#dashboard-content" className="ai-hero-dashboard-link">
        대시보드로 가기 ↓
      </a>
      <div className="ai-hero-inner">
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
          <h1 className="ai-hero-title">✨ 이그잼 AI</h1>
          <ManualHelpLink path="/director" />
        </div>
        <p className="ai-hero-sub">{placeholder}</p>

        <form onSubmit={handleSubmit} className="ai-hero-form">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />
          <button type="submit" disabled={saving || !text.trim()}>
            {saving ? "처리 중..." : "업무처리"}
          </button>
        </form>
        <p className="ai-hero-hint">
          예: "민수 본문 암기 안 됨. 관계대명사 문제 뽑아서 오늘 다시 확인" — 여러 업무로 자동 분리되어 배정됩니다. /보강,
          /재시, /상담, /행정실 같은 슬래시 명령은 기존과 동일하게 동작합니다.
        </p>

        {message && (
          <p className={message.ok ? "success-box" : "error-text"} style={{ marginTop: 10 }}>
            {message.ok ? "✅ " : "⚠️ "}
            {message.text}
          </p>
        )}

        {candidates && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
            {candidates.map((c) => (
              <button key={c.id} type="button" className="secondary" disabled={saving} onClick={() => pickCandidate(c.id)} style={{ textAlign: "left" }}>
                {c.label}
              </button>
            ))}
            <button type="button" className="secondary" disabled={saving} onClick={registerAsNew}>
              새로운 학생으로 등록
            </button>
          </div>
        )}

        {createdTasks && (
          <div className="success-box" style={{ marginTop: 10, textAlign: "left", maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
            ✅ 업무 {createdTasks.length}건을 등록했습니다.
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {createdTasks.map((t) => (
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
    </div>
  );
}
