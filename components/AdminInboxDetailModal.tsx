"use client";

import { useState } from "react";
import StaffPicker from "./StaffPicker";

const TYPE_OPTIONS = ["결석예정", "긴급상담요청", "신규생문의", "기타"];

export type AdminInboxRecord = {
  id: string;
  date: string | null;
  endDate: string | null;
  type: string | null;
  studentName: string;
  studentSchool?: string;
  studentGrade?: string | null;
  content: string;
  done: boolean;
  enteredBy?: string;
  owner?: string;
};

export default function AdminInboxDetailModal({
  item,
  canEdit,
  onClose,
  onSaved,
}: {
  item: AdminInboxRecord;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState(item.type ?? "기타");
  const [startDate, setStartDate] = useState(item.date ?? "");
  const [endDate, setEndDate] = useState(item.endDate ?? "");
  const [content, setContent] = useState(item.content);
  const [owner, setOwner] = useState(item.owner ?? "");
  const [done, setDone] = useState(item.done);
  const [saving, setSaving] = useState(false);
  const [togglingDone, setTogglingDone] = useState(false);
  const [savingOwner, setSavingOwner] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!window.confirm("수정 내용을 저장하시겠습니까?")) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin-inbox/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, content, startDate, endDate }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  // 담당자 지정과 처리완료 표시는 입력자 제한과 무관하게 누구나 할 수 있다 —
  // 실제 내용 수정(handleSave)과는 별도 경로라 canEdit과 상관없이 항상 노출.
  async function handleToggleDone() {
    const next = !done;
    setTogglingDone(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin-inbox/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "상태 변경에 실패했습니다.");
        return;
      }
      setDone(next);
      onSaved();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setTogglingDone(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("이 항목을 삭제하시겠습니까?")) return;
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin-inbox/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "삭제에 실패했습니다.");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaveOwner() {
    setSavingOwner(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin-inbox/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "담당자 저장에 실패했습니다.");
        return;
      }
      onSaved();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSavingOwner(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {item.studentName} 행정실 {canEdit ? "수정" : "상세"}
            {item.studentSchool && (
              <span className="muted"> {item.studentSchool}{item.studentGrade ? `(${item.studentGrade})` : ""}</span>
            )}
          </h2>
          <button type="button" className="secondary" onClick={onClose}>닫기</button>
        </div>

        {!canEdit && (
          <p className="muted" style={{ marginBottom: 10 }}>
            입력자: {item.enteredBy || "-"} · 본인이 입력한 항목만 수정할 수 있습니다.
          </p>
        )}

        <label htmlFor="editAdminType">유형</label>
        <select id="editAdminType" value={type} onChange={(e) => setType(e.target.value)} disabled={!canEdit}>
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <div className="field-row">
          <div>
            <label htmlFor="editAdminStart">날짜</label>
            <input
              id="editAdminStart"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div>
            <label htmlFor="editAdminEnd">종료일</label>
            <input
              id="editAdminEnd"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={!canEdit}
            />
          </div>
        </div>

        <label htmlFor="editAdminContent">내용</label>
        <textarea
          id="editAdminContent"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{ minHeight: 100 }}
          disabled={!canEdit}
        />

        <label htmlFor="editAdminOwner">담당자 (처리해야 할 사람)</label>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <StaffPicker value={owner} onChange={setOwner} label="" />
          </div>
          <button type="button" className="secondary" disabled={savingOwner} onClick={handleSaveOwner}>
            {savingOwner ? "저장 중..." : "담당자 저장"}
          </button>
        </div>

        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <span className={done ? "badge badge-success" : "badge"}>{done ? "처리완료" : "미처리"}</span>
          <button type="button" className="secondary" disabled={togglingDone} onClick={handleToggleDone}>
            {togglingDone ? "처리 중..." : done ? "미처리로 되돌리기" : "처리완료로 표시"}
          </button>
        </div>

        {error && <p className="error-text">{error}</p>}

        {canEdit && (
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button type="button" disabled={saving} onClick={handleSave}>
              {saving ? "저장 중..." : "저장"}
            </button>
            <button type="button" className="secondary" disabled={deleting} onClick={handleDelete}>
              {deleting ? "삭제 중..." : "삭제"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
