"use client";

import { useEffect, useState } from "react";
import { outcomeOptionsFor, type TaskType } from "@/lib/tasks";
import ManualHelpLink from "@/components/ManualHelpLink";

type TaskRecord = {
  id: string;
  type: TaskType | null;
  typeLabel: string;
  title: string;
  studentName: string;
  ownerName: string;
  date: string | null;
  time: string;
  note: string;
  priority: string | null;
  done: boolean;
  outcome: string;
  urgent: boolean;
  directorAck: boolean;
  pool: boolean;
  parentTaskId: string | null;
};

// 업무 상세 — 결과보고(섹션10) + 지시→처리→결과→재지시 히스토리(섹션13).
// TaskBoardClient(내 업무)와 원장 확인함 양쪽에서 같은 모달을 재사용한다.
export default function TaskDetailModal({
  taskId,
  role,
  onClose,
  onChanged,
}: {
  taskId: string;
  role: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [thread, setThread] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [outcome, setOutcome] = useState("");
  const [memo, setMemo] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followupText, setFollowupText] = useState("");
  const [followupSaving, setFollowupSaving] = useState(false);
  const [followupMessage, setFollowupMessage] = useState<string | null>(null);

  const canManage = role === "원장" || role === "행정";
  const canFollowup = role === "원장" || role === "행정" || role === "강사";

  function load() {
    setLoading(true);
    fetch(`/api/tasks/${taskId}`)
      .then((r) => r.json())
      .then((data) => {
        setTask(data.task ?? null);
        setThread(data.thread ?? []);
        setOutcome("");
        setMemo("");
        setUrgent(false);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function submitOutcome() {
    if (!outcome) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, memo, urgent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.message ?? "저장에 실패했습니다.");
        return;
      }
      load();
      onChanged();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function acknowledge() {
    await fetch(`/api/tasks/${taskId}/acknowledge`, { method: "POST" });
    load();
    onChanged();
  }

  async function submitFollowup() {
    if (!followupText.trim()) return;
    setFollowupSaving(true);
    setFollowupMessage(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: followupText.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) {
        setFollowupMessage(data.message ?? "재지시 처리에 실패했습니다.");
        return;
      }
      setFollowupText("");
      setFollowupMessage(`후속 업무 ${data.tasks?.length ?? 0}건을 등록했습니다.`);
      load();
      onChanged();
    } catch {
      setFollowupMessage("네트워크 오류가 발생했습니다.");
    } finally {
      setFollowupSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>업무 상세</h2>
          <button type="button" className="secondary" onClick={onClose}>
            닫기
          </button>
        </div>

        {loading || !task ? (
          <p className="muted">불러오는 중...</p>
        ) : (
          <>
            <p>
              <span className="badge">{task.typeLabel}</span>{" "}
              {task.studentName && task.studentName !== "-" && <strong>{task.studentName}</strong>}{" "}
              {task.urgent && <span className="badge badge-urgent">긴급</span>}
              {task.pool && !task.ownerName && <span className="badge">공용업무풀</span>}
            </p>
            <p className="muted" style={{ marginTop: 4 }}>
              담당: {task.ownerName || "미배정"} · {task.date ?? "-"} {task.time}
            </p>
            {task.note && <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{task.note}</p>}

            {task.done ? (
              <div style={{ marginTop: 12 }}>
                <p>
                  <strong>결과: {task.outcome || "-"}</strong>
                </p>
                {canManage && !task.directorAck && (
                  <button type="button" style={{ marginTop: 8 }} onClick={acknowledge}>
                    확인 처리
                  </button>
                )}
                {task.directorAck && <span className="badge badge-success">원장 확인 완료</span>}
              </div>
            ) : (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <ManualHelpLink path="/director/tasks/result" />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {outcomeOptionsFor(task.type ?? "GENERAL_TASK").map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      className={outcome === opt ? "" : "secondary"}
                      onClick={() => setOutcome(opt)}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                <textarea placeholder="메모 (선택)" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
                <label style={{ fontSize: 13 }}>
                  <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> 긴급으로 표시
                </label>
                {error && <p className="error-text">{error}</p>}
                <button type="button" disabled={!outcome || saving} onClick={submitOutcome}>
                  {saving ? "저장 중..." : "결과 저장"}
                </button>
              </div>
            )}

            {thread.length > 1 && (
              <div style={{ marginTop: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600 }}>지시 · 처리 이력</h3>
                <ul className="schedule-list">
                  {thread.map((t) => (
                    <li key={t.id} className="schedule-item-row">
                      <span className="badge">{t.typeLabel}</span> {t.date} {t.time} · {t.done ? `완료(${t.outcome})` : "진행중"}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {canFollowup && (
              <div style={{ marginTop: 16, borderTop: "1px solid var(--border, #e5e5e5)", paddingTop: 12 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>재지시</h3>
                <textarea
                  placeholder="예: 내일 5시에 다시 시키고 김선생님이 10분 설명"
                  value={followupText}
                  onChange={(e) => setFollowupText(e.target.value)}
                  rows={2}
                />
                {followupMessage && <p className="muted" style={{ marginTop: 4 }}>{followupMessage}</p>}
                <button type="button" style={{ marginTop: 6 }} disabled={!followupText.trim() || followupSaving} onClick={submitFollowup}>
                  {followupSaving ? "처리 중..." : "재지시 등록"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
