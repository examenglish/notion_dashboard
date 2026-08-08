"use client";

import { useEffect, useState } from "react";
import { todayKST } from "@/lib/date";
import ScheduleConfirmModal from "./ScheduleConfirmModal";

export type MakeupScheduleItem = {
  id: string;
  type: string;
  studentName: string;
  className: string;
  ownerName: string;
  date: string | null;
  time: string;
  memo: string;
  lessonContent: string;
  confirmed: boolean;
};

// 확정된 건도 시간이 바뀌는 경우가 있어(학생/학부모와 재조율 등) 카드에서
// 바로 수정할 수 있게 한다 — 미확정 건도 같은 폼으로 즉시 확정할 수 있어,
// 굳이 팝업을 열지 않고도 한두 건은 여기서 바로 처리 가능하다.
function MakeupRow({
  item,
  showOwner,
  canDelete,
  onChanged,
}: {
  item: MakeupScheduleItem;
  showOwner: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(item.date ?? todayKST());
  const [time, setTime] = useState(item.time);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLesson, setShowLesson] = useState(false);

  function startEdit() {
    setDate(item.date ?? todayKST());
    setTime(item.time);
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (!date || !time.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/schedule-entry/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, time }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setEditing(false);
      onChanged();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`${item.studentName} 학생의 ${item.type} 항목을 삭제하시겠습니까?`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/schedule-entry/${item.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "삭제에 실패했습니다.");
        return;
      }
      onChanged();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <li className="schedule-item-row">
      <div>
        <strong>{item.studentName}</strong> <span className="muted">{item.className}</span>
        {" · "}
        <span className="badge">{item.type}</span>
        {showOwner && <span className="muted"> · 담당: {item.ownerName}</span>}
        <br />
        {editing ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 150 }} />
            <input
              type="text"
              placeholder="시간 예: 16:30"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              style={{ maxWidth: 110 }}
            />
            <button type="button" disabled={saving || !date || !time.trim()} onClick={save}>
              {saving ? "저장 중..." : "저장"}
            </button>
            <button type="button" className="secondary" disabled={saving} onClick={() => setEditing(false)}>
              취소
            </button>
          </div>
        ) : item.confirmed ? (
          <span className="badge badge-success">확정 · {item.date} {item.time}</span>
        ) : (
          <span className="badge badge-urgent">미확정{item.date ? ` (임시 ${item.date})` : ""}</span>
        )}
        {item.lessonContent && (
          <>
            {" "}
            <button
              type="button"
              className="secondary"
              style={{ fontSize: 12, padding: "2px 8px" }}
              onClick={() => setShowLesson((v) => !v)}
            >
              {showLesson ? "결석 당일 수업내용 접기" : "결석 당일 수업내용 보기"}
            </button>
            {showLesson && (
              <p
                className="muted"
                style={{ marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13 }}
              >
                {item.lessonContent}
              </p>
            )}
          </>
        )}
        {error && (
          <p className="error-text" style={{ marginTop: 4, fontSize: 12 }}>
            {error}
          </p>
        )}
      </div>
      {!editing && (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" className="secondary" onClick={startEdit}>
            {item.confirmed ? "수정" : "지금 확정"}
          </button>
          {canDelete && (
            <button type="button" className="secondary" disabled={deleting} onClick={remove}>
              {deleting ? "삭제 중..." : "삭제"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// 자체적으로 /api/makeup-status를 불러오는 독립 카드 — 대시보드와 입력
// 페이지 어디에 두든 같은 데이터/같은 확정 방식(PATCH /api/schedule-entry)을
// 그대로 쓰므로 두 화면이 항상 동기화된다. 행정/원장에게는 전체 현황
// (scope="all")을, 강사·조교에게는 본인 담당 건만(scope="mine") 보여주는데,
// 이 구분도 서버가 역할에 따라 이미 걸러서 내려준 결과를 그대로 반영한 것.
export default function MakeupStatusCard({
  role,
  onChanged,
}: {
  role?: string | null;
  onChanged?: () => void;
} = {}) {
  // 삭제는 서버(app/api/schedule-entry/[id]/route.ts DELETE)도 원장·행정만
  // 허용한다 — 여기서도 같은 기준으로 버튼을 보여준다.
  const canDelete = role === "원장" || role === "행정";
  const [scope, setScope] = useState<"all" | "mine">("mine");
  const [items, setItems] = useState<MakeupScheduleItem[]>([]);
  const [confirmModalItems, setConfirmModalItems] = useState<MakeupScheduleItem[] | null>(null);

  function reload() {
    fetch("/api/makeup-status")
      .then((r) => r.json())
      .then((data: { scope: "all" | "mine"; items: MakeupScheduleItem[] }) => {
        setScope(data.scope);
        setItems(data.items ?? []);
      });
  }

  useEffect(() => {
    reload();
  }, []);

  function handleChanged() {
    reload();
    onChanged?.();
  }

  if (items.length === 0) return null;

  const unconfirmed = items.filter((i) => !i.confirmed);
  const confirmed = items.filter((i) => i.confirmed);
  const sorted = [...unconfirmed, ...confirmed];

  return (
    <div className="card">
      <h2>{scope === "all" ? "보강·재시 확정 현황 (전체)" : "내 보강·재시 확정 현황"}</h2>
      <p className="muted">
        확정 {confirmed.length}건 · 미확정 {unconfirmed.length}건
      </p>
      {unconfirmed.length > 0 && (
        <button type="button" className="secondary" onClick={() => setConfirmModalItems(unconfirmed)}>
          미확정 {unconfirmed.length}건 처리하기
        </button>
      )}
      <ul className="schedule-list" style={{ marginTop: 12 }}>
        {sorted.map((item) => (
          <MakeupRow key={item.id} item={item} showOwner={scope === "all"} canDelete={canDelete} onChanged={handleChanged} />
        ))}
      </ul>

      {confirmModalItems && (
        <ScheduleConfirmModal
          items={confirmModalItems}
          onClose={() => setConfirmModalItems(null)}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}
