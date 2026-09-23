"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import FileResults, { type FileHit } from "@/components/FileResults";
import ManualHelpLink from "@/components/ManualHelpLink";
import { SLASH_COMMAND_LIST } from "@/lib/slash-commands";

type Candidate = { id: string; label: string };
type CreatedTask = { id: string; typeLabel: string; studentName: string; ownerName: string | null; pool: boolean };
// 서버(lib/nl-input.ts PendingAction)가 준 그대로 보관했다가 다음 답변과 함께
// 돌려보낸다 — 화면은 question/missing[].candidates만 읽는다.
type Pending = { question: string; missing: { candidates?: Candidate[] }[]; [key: string]: unknown };
type Outcome = { route: string; label: string; status: "완료" | "확인필요" | "실패"; message: string; pending?: Pending; files?: FileHit[] };

// 직전 입력에서 확정된 반/날짜/교시 — 다음 입력에 이어 쓰도록 서버에 함께 보낸다.
type ClassContext = { classId: string; className: string; date: string; period: string };

function summarize(outcomes: Outcome[]): string {
  const done = outcomes.filter((o) => o.status === "완료").length;
  const check = outcomes.filter((o) => o.status === "확인필요").length;
  const failed = outcomes.filter((o) => o.status === "실패").length;
  return [`처리 완료 ${done}건`, check ? `확인 필요 ${check}건` : "", failed ? `실패 ${failed}건` : ""].filter(Boolean).join(" · ");
}

type AiResponse = {
  ok: boolean;
  mode?: "tasks" | "legacy" | "multi";
  message?: string;
  needsConfirm?: boolean;
  needsSelection?: boolean;
  candidates?: Candidate[];
  tasks?: CreatedTask[];
  warnings?: string[];
  outcomes?: Outcome[];
  context?: ClassContext | null;
  // 입력 이력 조회 결과의 번호↔기록 서명 토큰(서버 발급, 다음 입력에 그대로 돌려보냄)
  history?: string | null;
};

const ROLE_PLACEHOLDER: Record<string, string> = {
  원장: "학생 상황이나 업무를 말해주세요",
  강사: "학생 상황이나 업무를 말해주세요",
  조교: "업무 결과나 학생 상황을 입력하세요",
  행정: "연락 결과나 처리할 업무를 입력하세요",
};

const LANDING_COMMANDS = [
  { label: "/학생 관리", href: "/director/students" },
  { label: "/과제", href: "/director/input?tab=records" },
  { label: "/재시험", command: "재시" },
  { label: "/상담", command: "상담" },
  { label: "/출력", href: "/director/reports" },
] as const;

// 대시보드의 유일한 AI 입력창(섹션2 "구글 첫페이지" 요청에 따라 전면 배치) —
// 기존에 따로 있던 "업무 만들기"(AiTaskComposer)와 "학생기록 자연어 입력"
// (NaturalLanguageInput)을 하나로 합쳤다. 백엔드는 두 로직을 그대로
// 이어붙인 /api/ai-input 하나만 쓴다(각 로직 자체는 안 건드림).
export default function AiUnifiedInput({
  role,
  onSaved,
  fullScreen = false,
  figma = false,
}: {
  role: string;
  onSaved?: () => void;
  // true: 사이드바/상단바 없이 이 컴포넌트 혼자 화면 전체를 채우는 랜딩
  // (app/director/page.tsx). false: 다른 화면에 카드 형태로 얹는 경우용.
  fullScreen?: boolean;
  figma?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [createdTasks, setCreatedTasks] = useState<CreatedTask[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  // 정보가 부족해 되물은 요청들(대화형 보완). 맨 앞 것부터 답변을 받는다.
  const [pendingQueue, setPendingQueue] = useState<Pending[]>([]);
  const [classContext, setClassContext] = useState<ClassContext | null>(null);
  const [historyToken, setHistoryToken] = useState<string | null>(null);
  const currentPending = pendingQueue[0] ?? null;
  const pendingChoices = currentPending?.missing.find((m) => m.candidates && m.candidates.length > 0)?.candidates ?? null;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // "/"만 치면 그 뒤 글자로 필터링된 단축어 목록을 검색창 바로 아래에
  // 보여준다(노션 "/" 명령어 메뉴와 동일한 방식). 공백을 치는 순간(사람
  // 이름 등을 입력하기 시작하면) 사라진다.
  const slashQuery = /^\/[^\s]*$/.test(text) ? text.slice(1) : null;
  const slashMatches = slashQuery !== null ? SLASH_COMMAND_LIST.filter((c) => c.cmd.startsWith(slashQuery)) : [];

  function pickSlashCommand(cmd: string) {
    setText(`/${cmd} `);
    textareaRef.current?.focus();
  }

  async function submit(
    currentText: string,
    opts: { confirmNewStudent?: boolean; selectedStudentId?: string; forceNewStudent?: boolean; pending?: Pending; choiceId?: string } = {}
  ): Promise<AiResponse> {
    const res = await fetch("/api/ai-input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: currentText,
        ...opts,
        context: opts.pending ? undefined : classContext,
        history: opts.pending ? undefined : historyToken,
      }),
    });
    return res.json();
  }

  function finish(data: AiResponse, answeredPending = false) {
    if (data.mode === "tasks" && data.ok) {
      setCreatedTasks(data.tasks ?? []);
      setOutcomes(null);
      setWarnings(data.warnings ?? []);
      setMessage(null);
      setText("");
      setPendingText(null);
      setCandidates(null);
      onSaved?.();
      return;
    }
    if (data.mode === "multi") {
      // intent별로 완료/확인필요/실패가 섞여 나올 수 있어(2026-09-19 통합
      // 자연어 입력 — staff.md PART 8), 문장 하나가 실패해도 전체를 에러로
      // 뭉개지 않고 outcomes 목록을 그대로 보여준다.
      setCreatedTasks(null);
      const newPending = (data.outcomes ?? []).flatMap((o) => (o.pending ? [o.pending] : []));
      setPendingQueue((cur) => [...(answeredPending ? cur.slice(1) : []), ...newPending]);
      if (data.context) setClassContext(data.context);
      if (data.history) setHistoryToken(data.history);
      setOutcomes((data.outcomes ?? []).filter((o) => !o.pending));
      setMessage(null);
      setText("");
      setPendingText(null);
      setCandidates(null);
      onSaved?.();
      return;
    }
    setCreatedTasks(null);
    setOutcomes(null);
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
    setOutcomes(null);
    setCandidates(null);
    try {
      if (currentPending) {
        finish(await submit(currentText, { pending: currentPending }), true);
        return;
      }
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
    if (saving) return;
    if (currentPending) {
      setSaving(true);
      try {
        const label = pendingChoices?.find((c) => c.id === id)?.label ?? "";
        finish(await submit(label, { pending: currentPending, choiceId: id }), true);
      } catch {
        setMessage({ ok: false, text: "네트워크 오류가 발생했습니다." });
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!pendingText) return;
    setSaving(true);
    try {
      finish(await submit(pendingText, { selectedStudentId: id }));
    } catch {
      setMessage({ ok: false, text: "네트워크 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  }

  function renderContext() {
    if (!classContext) return null;
    return (
      <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
        반 문맥: {classContext.className}
        {classContext.period ? ` ${classContext.period}` : ""} ({classContext.date}) — 반 이름 없이 입력하면 이 반 기준으로 기록합니다(소속이 다르면 확인 질문).{" "}
        <button type="button" className="secondary" style={{ fontSize: 12, padding: "0 6px" }} onClick={() => setClassContext(null)}>
          해제
        </button>
      </p>
    );
  }

  function cancelPending() {
    setPendingQueue((cur) => cur.slice(1));
    setMessage({ ok: false, text: "해당 요청을 취소했습니다." });
  }

  // 되묻는 질문 + (있으면) 후보 버튼 — 후보 버튼은 기존 학생 후보 선택과 같은 모양.
  function renderPending(figmaStyle: boolean) {
    if (!currentPending) return null;
    return (
      <div
        className={figmaStyle ? "landing-result landing-result-error" : "error-text"}
        role="status"
        style={figmaStyle ? { whiteSpace: "pre-line" } : { whiteSpace: "pre-line", marginTop: 10, textAlign: "left", maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}
      >
        ❓ {currentPending.question}
        <div style={{ fontSize: 12, marginTop: 4 }}>입력창에 답변을 적어 주세요{pendingQueue.length > 1 ? ` (남은 확인 ${pendingQueue.length}건)` : ""}.</div>
        <div className={figmaStyle ? "landing-candidates" : undefined} style={figmaStyle ? undefined : { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {(pendingChoices ?? []).map((c) => (
            <button type="button" key={c.id} className={figmaStyle ? undefined : "secondary"} disabled={saving} onClick={() => pickCandidate(c.id)}>
              {c.label}
            </button>
          ))}
          <button type="button" className={figmaStyle ? undefined : "secondary"} disabled={saving} onClick={cancelPending}>
            취소
          </button>
        </div>
      </div>
    );
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

  if (figma) {
    return (
      <div className="landing-input-area">
        <div className="landing-search-wrap">
          <form className="landing-search" onSubmit={handleSubmit} role="search">
            <span className="landing-ai-icon"><Image src="/director/ai-icon.svg" alt="" width={19} height={19} /></span>
            <label htmlFor="director-ai-prompt" className="landing-sr-only">이그잼 AI에게 요청하기</label>
            <textarea
              ref={textareaRef}
              id="director-ai-prompt"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={currentPending ? "위 질문에 대한 답변을 입력하세요" : "무엇을 함께 해결할까요?   ‘/’를 입력하면 빠른 명령이 열립니다."}
              rows={1}
              disabled={saving}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (slashMatches.length > 0) pickSlashCommand(slashMatches[0].cmd);
                  else handleSubmit(event);
                }
                if (event.key === "Escape") setText("");
              }}
            />
            <button type="submit" className="landing-enter" disabled={saving || !text.trim()}>
              {saving ? "처리 중" : "Enter ↵"}
            </button>
          </form>
          {slashMatches.length > 0 && (
            <ul className="landing-command-menu" aria-label="빠른 명령 선택">
              {slashMatches.map((command) => (
                <li key={command.cmd}>
                  <button type="button" onClick={() => pickSlashCommand(command.cmd)} title={command.example}>
                    /{command.cmd} · {command.description}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="landing-quick-examples" aria-label="빠른 명령">
          <span>/ 빠른 명령</span>
          {LANDING_COMMANDS.map((command) => (
            <button
              type="button"
              key={command.label}
              onClick={() => "href" in command ? router.push(command.href) : pickSlashCommand(command.command)}
            >
              {command.label}
            </button>
          ))}
        </div>

        {message && <p className={`landing-result ${message.ok ? "landing-result-success" : "landing-result-error"}`} role="status">{message.text}</p>}
        {candidates && (
          <div className="landing-candidates" aria-label="학생 선택">
            {candidates.map((candidate) => (
              <button type="button" key={candidate.id} disabled={saving} onClick={() => pickCandidate(candidate.id)}>{candidate.label}</button>
            ))}
            <button type="button" disabled={saving} onClick={registerAsNew}>새로운 학생으로 등록</button>
          </div>
        )}
        {renderContext()}
        {renderPending(true)}
        {outcomes && outcomes.length > 0 && (
          <div className={`landing-result ${outcomes.every((outcome) => outcome.status === "완료") ? "landing-result-success" : "landing-result-error"}`} role="status">
            {summarize(outcomes)}
            <ul>
              {outcomes.map((outcome, index) => (
                <li key={index} style={{ whiteSpace: "pre-line" }}>
                  {outcome.message}
                  {outcome.files && <FileResults files={outcome.files} />}
                </li>
              ))}
            </ul>
          </div>
        )}
        {createdTasks && (
          <div className="landing-result landing-result-success" role="status">
            업무 {createdTasks.length}건을 등록했습니다.
            <ul>
              {createdTasks.map((task) => (
                <li key={task.id}>{task.typeLabel}{task.studentName ? ` · ${task.studentName}` : ""} — {task.ownerName ? `${task.ownerName} 배정` : task.pool ? "공용업무풀" : "미배정"}</li>
              ))}
            </ul>
            {warnings.length > 0 && <ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={fullScreen ? "ai-hero ai-hero-full" : "ai-hero"}>
      <Link href="/director/dashboard" className="ai-hero-dashboard-link">
        대시보드로 가기 →
      </Link>
      <div className="ai-hero-inner">
        {fullScreen && (
          <Link href="/director" className="ai-hero-logo">
            <Image src="/logo.png" alt="" width={843} height={157} priority className="ai-hero-logo-img" />
          </Link>
        )}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
          <h1 className="ai-hero-title">✨ 이그잼 AI</h1>
          <ManualHelpLink path="/director" />
        </div>
        <p className="ai-hero-sub">{placeholder}</p>

        <div className="ai-hero-form-wrap">
          <form onSubmit={handleSubmit} className="ai-hero-form">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={currentPending ? "위 질문에 대한 답변을 입력하세요" : placeholder}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && slashMatches.length === 0) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <button type="submit" disabled={saving || !text.trim()}>
              {saving ? "처리 중..." : "업무처리"}
            </button>
          </form>

          {slashQuery !== null && slashMatches.length > 0 && (
            <ul className="ai-slash-menu">
              {slashMatches.map((c) => (
                <li key={c.cmd}>
                  <button type="button" onClick={() => pickSlashCommand(c.cmd)}>
                    <span className="ai-slash-cmd">/{c.cmd}</span>
                    <span className="ai-slash-desc">{c.description}</span>
                    <span className="ai-slash-example">{c.example}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="ai-hero-hint">
          예: "민수 본문 암기 안 됨. 관계대명사 문제 뽑아서 오늘 다시 확인" — 여러 업무로 자동 분리되어 배정됩니다. "/"만
          입력하면 사용 가능한 단축어가 아래에 나타납니다.
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

        {renderContext()}
        {renderPending(false)}
        {outcomes && outcomes.length > 0 && (
          <div className={outcomes.every((o) => o.status === "완료") ? "success-box" : "error-text"} style={{ marginTop: 10, textAlign: "left", maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
            {summarize(outcomes)}
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {outcomes.map((o, i) => (
                <li key={i} style={{ whiteSpace: "pre-line" }}>
                  {o.status === "완료" ? "✅" : o.status === "확인필요" ? "❓" : "⚠️"} {o.message}
                  {o.files && <FileResults files={o.files} />}
                </li>
              ))}
            </ul>
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
