"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

type Candidate = { id: string; label: string };
type NlResponse = {
  ok: boolean;
  message?: string;
  needsConfirm?: boolean;
  needsSelection?: boolean;
  candidates?: Candidate[];
};

const QUICK_COMMANDS = [
  { label: "/학생 관리", href: "/director/students" },
  { label: "/과제", href: "/director/input?tab=records" },
  { label: "/재시험", prefix: "/재시 " },
  { label: "/상담", prefix: "/상담 " },
  { label: "/출력", href: "/director/reports" },
] as const;

export default function DirectorLandingInput({ canUseAI, canAccessReports }: { canUseAI: boolean; canAccessReports: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  async function send(currentText: string, options: { confirmNewStudent?: boolean; selectedStudentId?: string; forceNewStudent?: boolean } = {}): Promise<NlResponse> {
    const response = await fetch("/api/nl-input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: currentText, ...options }),
    });
    return response.json();
  }

  function finish(data: NlResponse) {
    setResult({ ok: !!data.ok, message: data.message ?? "처리 중 오류가 발생했습니다." });
    if (data.ok) {
      setText("");
      setPendingText(null);
      setCandidates(null);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentText = text.trim();
    if (!currentText || currentText === "/" || saving) return;
    if (!canUseAI) {
      setResult({ ok: false, message: "AI 입력을 사용하려면 로그인해 주세요." });
      return;
    }
    setSaving(true);
    setResult(null);
    setCandidates(null);
    try {
      let data = await send(currentText);
      if (!data.ok && data.needsConfirm && data.message && window.confirm(data.message)) {
        data = await send(currentText, { confirmNewStudent: true });
      } else if (!data.ok && data.needsSelection) {
        setPendingText(currentText);
        setCandidates(data.candidates ?? []);
        setResult({ ok: false, message: data.message ?? "학생을 선택해 주세요." });
        return;
      }
      finish(data);
    } catch {
      setResult({ ok: false, message: "네트워크 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  }

  async function resolveCandidate(options: { selectedStudentId?: string; forceNewStudent?: boolean }) {
    if (!pendingText || saving) return;
    setSaving(true);
    try {
      finish(await send(pendingText, options));
    } catch {
      setResult({ ok: false, message: "네트워크 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  }

  function chooseCommand(command: (typeof QUICK_COMMANDS)[number]) {
    setResult(null);
    if ("href" in command) {
      const href = command.label === "/출력" && !canAccessReports ? "/director/dashboard" : command.href;
      router.push(href);
    } else {
      setText(command.prefix);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="landing-input-area">
      <form className="landing-search" onSubmit={submit} role="search">
        <span className="landing-ai-icon"><Image src="/director/ai-icon.svg" alt="" width={19} height={19} /></span>
        <label htmlFor="director-ai-prompt" className="landing-sr-only">이그잼 AI에게 요청하기</label>
        <input
          ref={inputRef}
          id="director-ai-prompt"
          type="search"
          value={text}
          onChange={(event) => { setText(event.target.value); setResult(null); }}
          onKeyDown={(event) => { if (event.key === "Escape") setText(""); }}
          placeholder="무엇을 함께 해결할까요?   ‘/’를 입력하면 빠른 명령이 열립니다."
          autoComplete="off"
          disabled={saving}
        />
        <button type="submit" className="landing-enter" disabled={saving || !text.trim() || text.trim() === "/"}>
          {saving ? "처리 중" : "Enter ↵"}
        </button>
      </form>

      {text.trim() === "/" && (
        <div className="landing-command-menu" aria-label="빠른 명령 선택">
          {QUICK_COMMANDS.map((command) => (
            <button type="button" key={command.label} onClick={() => chooseCommand(command)}>{command.label}</button>
          ))}
        </div>
      )}

      <div className="landing-quick-examples" aria-label="빠른 명령">
        <span>/ 빠른 명령</span>
        {QUICK_COMMANDS.map((command) => (
          <button type="button" key={command.label} onClick={() => chooseCommand(command)}>{command.label}</button>
        ))}
      </div>

      {result && <p className={`landing-result ${result.ok ? "landing-result-success" : "landing-result-error"}`} role="status">{result.message}</p>}
      {candidates && (
        <div className="landing-candidates" aria-label="학생 선택">
          {candidates.map((candidate) => (
            <button type="button" key={candidate.id} disabled={saving} onClick={() => resolveCandidate({ selectedStudentId: candidate.id })}>{candidate.label}</button>
          ))}
          <button type="button" disabled={saving} onClick={() => resolveCandidate({ forceNewStudent: true })}>새로운 학생으로 등록</button>
        </div>
      )}
    </div>
  );
}
