"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkHours } from "@/lib/format";
import { classifyFeedback, type TaskType } from "@/lib/tasks";
import TaskDetailModal from "@/components/TaskDetailModal";
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

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function TaskRow({ task, onClick, badge }: { task: TaskRecord; onClick: () => void; badge?: string }) {
  return (
    <li className="schedule-item-row" onClick={onClick} style={{ cursor: "pointer" }}>
      <div>
        <span className="badge">{task.typeLabel}</span>{" "}
        {task.studentName && task.studentName !== "-" && <strong>{task.studentName}</strong>}
        {task.urgent && <span className="badge badge-urgent">긴급</span>}
        {badge && <span className="badge">{badge}</span>}
        <br />
        <span className="muted">
          {task.date ?? "날짜 미정"} {task.time} {task.ownerName ? `· 담당 ${task.ownerName}` : ""}
        </span>
        {task.note && <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>{task.note}</p>}
      </div>
    </li>
  );
}

export default function TaskBoardClient({
  today,
  role,
  staffId,
  staffName,
  workHours,
  myTasks: initialMyTasks,
  poolTasks: initialPoolTasks,
  checklist,
  reviewInbox: initialReviewInbox,
  isManager,
}: {
  today: string;
  role: string;
  staffId: string;
  staffName: string;
  workHours: WorkHours;
  myTasks: TaskRecord[];
  poolTasks: TaskRecord[];
  checklist: { label: string; count: number }[];
  reviewInbox: TaskRecord[];
  isManager: boolean;
}) {
  const [myTasks, setMyTasks] = useState(initialMyTasks);
  const [poolTasks, setPoolTasks] = useState(initialPoolTasks);
  const [reviewInbox, setReviewInbox] = useState(initialReviewInbox);
  const [completed, setCompleted] = useState<TaskRecord[] | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  function reloadAll() {
    fetch("/api/tasks?scope=mine")
      .then((r) => r.json())
      .then((d) => setMyTasks(d.tasks ?? []));
    fetch("/api/tasks?scope=pool")
      .then((r) => r.json())
      .then((d) => setPoolTasks(d.tasks ?? []));
    if (isManager) {
      fetch("/api/tasks?scope=review")
        .then((r) => r.json())
        .then((d) => setReviewInbox(d.tasks ?? []));
    }
    if (showCompleted) loadCompleted();
  }

  function loadCompleted() {
    fetch("/api/tasks?scope=completed")
      .then((r) => r.json())
      .then((d) => setCompleted(d.tasks ?? []));
  }

  async function claim(taskId: string) {
    setClaiming(taskId);
    try {
      const res = await fetch(`/api/tasks/${taskId}/claim`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) {
        alert(data.message ?? "가져오기에 실패했습니다.");
        return;
      }
      reloadAll();
    } finally {
      setClaiming(null);
    }
  }

  // 근무 상태(섹션7) — 클라이언트 현재 시각 기준. 근무시간표가 비어있으면
  // (강사/원장/행정 계정 관례와 동일) 항상 근무 중으로 표시한다.
  const workStatus = useMemo(() => {
    const weekday = WEEKDAYS[new Date().getDay()];
    const range = workHours[weekday];
    if (!range) {
      return Object.keys(workHours).length === 0
        ? { label: "근무시간 제한 없음", working: true }
        : { label: "오늘 근무 없음", working: false };
    }
    const now = new Date();
    const nowLabel = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const working = nowLabel >= range.start && nowLabel < range.end;
    return { label: `오늘 근무 ${range.start}~${range.end}`, working };
  }, [workHours]);

  const nowLabel = useMemo(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }, []);

  const overdue = myTasks.filter((t) => t.date && t.date < today);
  const urgent = myTasks.filter((t) => !overdue.includes(t) && t.urgent);
  const dueSoon = myTasks.filter(
    (t) => !overdue.includes(t) && !urgent.includes(t) && t.date === today && t.time && t.time <= addMinutes(nowLabel, 60) && t.time >= nowLabel
  );
  const restToday = myTasks.filter(
    (t) => !overdue.includes(t) && !urgent.includes(t) && !dueSoon.includes(t) && t.date === today
  );
  const other = myTasks.filter(
    (t) => !overdue.includes(t) && !urgent.includes(t) && !dueSoon.includes(t) && !restToday.includes(t)
  );
  const topPick = overdue[0] ?? urgent[0] ?? dueSoon[0] ?? restToday[0] ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>{staffName}</h2>
          <ManualHelpLink path="/director/tasks" />
        </div>
        <p className="muted">
          {workStatus.label} {workStatus.working && <span className="badge badge-success">● 현재 근무중</span>}
        </p>
      </div>

      {topPick && (
        <div className="card">
          <h2>지금 할 일</h2>
          <ul className="schedule-list">
            <TaskRow task={topPick} onClick={() => setOpenTaskId(topPick.id)} />
          </ul>
        </div>
      )}

      {isManager && reviewInbox.length > 0 && (
        <div className="card">
          <h2>확인할 피드백 {reviewInbox.length}</h2>
          <ul className="schedule-list">
            {reviewInbox.map((t) => {
              const tier = classifyFeedback({ outcome: t.outcome, urgentFlag: t.urgent });
              return <TaskRow key={t.id} task={t} onClick={() => setOpenTaskId(t.id)} badge={tier} />;
            })}
          </ul>
        </div>
      )}

      {(overdue.length > 0 || urgent.length > 0) && (
        <div className="card">
          <h2>긴급/지연 {overdue.length + urgent.length}</h2>
          <ul className="schedule-list">
            {[...overdue, ...urgent].map((t) => (
              <TaskRow key={t.id} task={t} onClick={() => setOpenTaskId(t.id)} />
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2>오늘 지시업무 {dueSoon.length + restToday.length}</h2>
        {dueSoon.length + restToday.length === 0 ? (
          <p className="muted">오늘 배정된 업무가 없습니다.</p>
        ) : (
          <ul className="schedule-list">
            {[...dueSoon, ...restToday].map((t) => (
              <TaskRow key={t.id} task={t} onClick={() => setOpenTaskId(t.id)} />
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>기본업무</h2>
        {checklist.length === 0 ? (
          <p className="muted">오늘 챙길 기본업무가 없습니다.</p>
        ) : (
          <ul className="schedule-list">
            {checklist.map((c) => (
              <li key={c.label} className="schedule-item-row">
                {c.label} <span className="badge">{c.count}</span>
              </li>
            ))}
          </ul>
        )}
        {other.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 12 }}>기타 배정 업무</h3>
            <ul className="schedule-list">
              {other.map((t) => (
                <TaskRow key={t.id} task={t} onClick={() => setOpenTaskId(t.id)} />
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="card">
        <h2>공용업무 {poolTasks.length}</h2>
        {poolTasks.length === 0 ? (
          <p className="muted">공용업무가 없습니다.</p>
        ) : (
          <ul className="schedule-list">
            {poolTasks.map((t) => (
              <li key={t.id} className="schedule-item-row">
                <div style={{ cursor: "pointer" }} onClick={() => setOpenTaskId(t.id)}>
                  <span className="badge">{t.typeLabel}</span> {t.note || t.title}
                  <br />
                  <span className="muted">{t.date} {t.time}</span>
                </div>
                <button type="button" disabled={claiming === t.id} onClick={() => claim(t.id)}>
                  {claiming === t.id ? "처리 중..." : "내가 할게요"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>완료</h2>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setShowCompleted((v) => !v);
            if (!showCompleted) loadCompleted();
          }}
        >
          {showCompleted ? "접기" : "오늘 완료한 업무 보기"}
        </button>
        {showCompleted && (
          <ul className="schedule-list" style={{ marginTop: 10 }}>
            {(completed ?? []).length === 0 ? (
              <p className="muted">오늘 완료한 업무가 없습니다.</p>
            ) : (
              (completed ?? []).map((t) => <TaskRow key={t.id} task={t} onClick={() => setOpenTaskId(t.id)} badge={t.outcome} />)
            )}
          </ul>
        )}
      </div>

      {openTaskId && (
        <TaskDetailModal
          taskId={openTaskId}
          role={role}
          onClose={() => setOpenTaskId(null)}
          onChanged={reloadAll}
        />
      )}
    </div>
  );
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor((total % (24 * 60)) / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
