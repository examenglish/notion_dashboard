"use client";

import { useState } from "react";
import StaffPicker from "./StaffPicker";

export type CounselingRecord = {
  id: string;
  date: string | null;
  studentId: string | null;
  studentName: string;
  counselor: string;
  transcript: string;
  content: string;
  followUp: string;
};

export default function CounselingEditModal({
  item,
  onClose,
  onSaved,
}: {
  item: CounselingRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [counselor, setCounselor] = useState(item.counselor);
  const [date, setDate] = useState(item.date ?? "");
  const [transcript, setTranscript] = useState(item.transcript);
  const [summary, setSummary] = useState(item.content);
  const [followUp, setFollowUp] = useState(item.followUp);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!window.confirm("수정 내용을 저장하시겠습니까?")) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/counseling/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counselor, date, transcript, summary, followUp }),
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
          <h2>상담일지 수정 — {item.studentName}</h2>
          <button type="button" className="secondary" onClick={onClose}>닫기</button>
        </div>

        <div className="field-row">
          <StaffPicker value={counselor} onChange={setCounselor} label="상담자" />
          <div>
            <label htmlFor="editCounselingDate">날짜</label>
            <input
              id="editCounselingDate"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>

        <label htmlFor="editTranscript">전사내용 (원본)</label>
        <textarea
          id="editTranscript"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          style={{ minHeight: 120 }}
        />

        <label htmlFor="editSummary">상담내용 (요약)</label>
        <textarea id="editSummary" value={summary} onChange={(e) => setSummary(e.target.value)} />

        <label htmlFor="editFollowUp">후속조치</label>
        <textarea id="editFollowUp" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />

        {error && <p className="error-text">{error}</p>}

        <div style={{ marginTop: 16 }}>
          <button type="button" disabled={saving} onClick={handleSave}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
