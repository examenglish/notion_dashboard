"use client";

import { useState } from "react";

const TYPE_OPTIONS = ["사전결석변경", "긴급상담요청", "신규생문의", "기타"];

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
  const [saving, setSaving] = useState(false);
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            행정실 {canEdit ? "수정" : "상세"} — {item.studentName}
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

        <p className="muted" style={{ marginTop: 8 }}>{item.done ? "처리완료" : "미처리"}</p>

        {error && <p className="error-text">{error}</p>}

        {canEdit && (
          <div style={{ marginTop: 16 }}>
            <button type="button" disabled={saving} onClick={handleSave}>
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
