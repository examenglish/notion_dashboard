"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 보강·재시 한 줄의 [시간 변경] [완료] — 기존 /api/schedule-entry/[id] PATCH(대시보드 확정 현황 카드와 같은 API)만 쓴다.
export default function ScheduleRowActions({ id, date, time, done }: { id: string; date: string | null; time: string; done: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState(date ?? "");
  const [t, setT] = useState(time);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function patch(body: Record<string, string>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/schedule-entry/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMsg(data.error ?? "저장하지 못했습니다.");
        return;
      }
      setMsg(ok);
      setEditing(false);
      router.refresh();
    } catch {
      setMsg("네트워크 오류로 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return null;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {editing ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <input type="date" value={d} onChange={(e) => setD(e.target.value)} className="h-8 rounded-md border border-input px-2 text-xs" aria-label="날짜" />
          <input value={t} onChange={(e) => setT(e.target.value)} placeholder="13:30" className="h-8 w-20 rounded-md border border-input px-2 text-xs" aria-label="시간" />
          <button type="button" disabled={busy || !d} onClick={() => patch({ date: d, time: t }, "✓ 시간을 바꿨습니다")} className="h-8 rounded-md px-2.5 text-xs">
            저장
          </button>
          <button type="button" className="secondary h-8 rounded-md px-2.5 text-xs" onClick={() => setEditing(false)}>
            취소
          </button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button type="button" className="secondary h-8 rounded-md px-2.5 text-xs" onClick={() => setEditing(true)}>
            시간 변경
          </button>
          <button type="button" disabled={busy} className="h-8 rounded-md px-2.5 text-xs" onClick={() => patch({}, "✓ 완료 처리됨")}>
            완료
          </button>
        </div>
      )}
      {msg && (
        <span role="status" className="text-[11px] text-muted-foreground">
          {msg}
        </span>
      )}
    </div>
  );
}
