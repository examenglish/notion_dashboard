"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TaskDetailModal from "@/components/TaskDetailModal";

export type HomeTask = { id: string; title: string; sub: string; when: string; tone: string };

// 첫 화면 "지금 할 일" — 누르면 업무 보드로 가지 않고 그 자리에서 기존 업무 상세(결과 선택·메모·완료)를 연다.
// 완료하면 "✓ 완료 처리됨"을 보여주고 목록을 새로 받아 다음 업무가 맨 위로 온다.
export default function HomeTaskList({ tasks, more, role }: { tasks: HomeTask[]; more: number; role: string }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      {notice && (
        <p role="status" className="home-notice">
          {notice}
        </p>
      )}
      <ol className="home-task-list">
        {tasks.map((t, i) => (
          <li key={t.id}>
            <button type="button" className="home-task" onClick={() => setOpenId(t.id)}>
              <span className="home-task-order">{i === 0 ? "먼저" : i === 1 ? "다음" : ""}</span>
              <span className="home-task-body">
                <span className="home-task-title">{t.title}</span>
                <span className="home-task-sub">{t.sub}</span>
              </span>
              <span className={`home-task-when ${t.tone}`}>{t.when}</span>
            </button>
          </li>
        ))}
        {more > 0 && (
          <li>
            <Link href="/director/tasks" className="home-more">
              남은 업무 {more}건 더 보기
            </Link>
          </li>
        )}
      </ol>
      {openId && (
        <TaskDetailModal
          taskId={openId}
          role={role}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            setNotice("✓ 완료 처리됨 — 다음 업무가 맨 위에 있습니다.");
            setOpenId(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
