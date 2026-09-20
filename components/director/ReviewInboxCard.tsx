"use client";

import { useEffect, useState } from "react";
import { classifyFeedback, type TaskType } from "@/lib/tasks";
import TaskDetailModal from "@/components/TaskDetailModal";

type TaskRecord = {
  id: string;
  type: TaskType | null;
  typeLabel: string;
  studentName: string;
  ownerName: string;
  date: string | null;
  time: string;
  note: string;
  outcome: string;
  urgent: boolean;
};

// 원장 대시보드 "확인할 피드백"(섹션12) — NORMAL 완료는 절대 올라오지 않고
// REVIEW/URGENT만 보여준다. 원장/행정에게만 렌더링한다(role 체크는 호출부).
export default function ReviewInboxCard({ role }: { role: string }) {
  const [items, setItems] = useState<TaskRecord[]>([]);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  function reload() {
    fetch("/api/tasks?scope=review")
      .then((r) => r.json())
      .then((d) => setItems(d.tasks ?? []));
  }

  useEffect(() => {
    reload();
  }, []);

  if (items.length === 0) return null;

  const urgentCount = items.filter((t) => classifyFeedback({ outcome: t.outcome, urgentFlag: t.urgent }) === "URGENT").length;

  return (
    <div className="card" style={{ borderColor: urgentCount > 0 ? "var(--danger, #c0392b)" : undefined }}>
      <h2>확인할 피드백 {items.length}</h2>
      {urgentCount > 0 && <p className="muted">긴급 {urgentCount}</p>}
      <ul className="schedule-list">
        {items.slice(0, 5).map((t) => {
          const tier = classifyFeedback({ outcome: t.outcome, urgentFlag: t.urgent });
          return (
            <li key={t.id} className="schedule-item-row" style={{ cursor: "pointer" }} onClick={() => setOpenTaskId(t.id)}>
              <span className="badge">{t.typeLabel}</span> <strong>{t.studentName}</strong>{" "}
              <span className={tier === "URGENT" ? "badge badge-urgent" : "badge"}>{tier}</span>
              <br />
              <span className="muted">결과: {t.outcome} · 담당 {t.ownerName}</span>
            </li>
          );
        })}
      </ul>

      {openTaskId && (
        <TaskDetailModal
          taskId={openTaskId}
          role={role}
          onClose={() => setOpenTaskId(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}
