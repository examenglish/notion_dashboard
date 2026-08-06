"use client";

import { useState } from "react";
import StaffPicker from "./StaffPicker";
import { formatDateLabel } from "@/lib/date";

export type AbsenceReviewItem = {
  dailyRecordId: string;
  studentId: string;
  studentName: string;
  school: string;
  grade: string | null;
  classId: string | undefined;
  className: string;
  date: string;
  makeupRequestId: string;
  ownerAssigned: boolean;
};

function schoolGrade(school: string, grade: string | null) {
  const s = school || "학교미상";
  return grade ? `${s}(${grade})` : s;
}

function OwnerAssignRow({ item, onAssigned }: { item: AbsenceReviewItem; onAssigned: () => void }) {
  const [owner, setOwner] = useState("");
  const [saving, setSaving] = useState(false);

  async function assign() {
    if (!owner) return;
    setSaving(true);
    try {
      await fetch(`/api/schedule-entry/${item.makeupRequestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerName: owner }),
      });
      onAssigned();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <StaffPicker value={owner} onChange={setOwner} label="" />
      </div>
      <button type="button" className="secondary" disabled={!owner || saving} onClick={assign}>
        {saving ? "지정 중..." : "담당자 지정"}
      </button>
    </div>
  );
}

// 대시보드 진입 시(행정/원장) 뜨는 "어제 결석자 검토" 팝업. 조회 시점에 이미
// 서버가 보강요청을 자동 생성해둔 상태로 items가 내려오므로, 여기서는
// (1) 사실 결석이 아니라 지각이었던 경우 정정, (2) 잘못/불필요하게 자동
// 생성된 보강요청 취소, (3) 담당교사가 자동 매칭되지 않은 건에 담당자를
// 직접 지정하는 세 가지만 다룬다.
export default function AbsenceReviewModal({
  date,
  items,
  onClose,
  onChanged,
}: {
  date: string;
  items: AbsenceReviewItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function correctToLate(item: AbsenceReviewItem) {
    if (!window.confirm(`${item.studentName} 학생을 결석이 아닌 지각으로 정정할까요? 자동 생성된 보강요청도 함께 취소됩니다.`)) return;
    setBusyId(item.dailyRecordId);
    try {
      await fetch("/api/absence-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "correctToLate",
          dailyRecordId: item.dailyRecordId,
          studentId: item.studentId,
          date: item.date,
        }),
      });
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function cancelMakeup(item: AbsenceReviewItem) {
    if (!window.confirm(`${item.studentName} 학생의 보강요청을 취소할까요?`)) return;
    setBusyId(item.dailyRecordId);
    try {
      await fetch("/api/absence-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancelMakeup", makeupRequestId: item.makeupRequestId }),
      });
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>어제({formatDateLabel(date)}) 결석자 검토 <span className="muted">({items.length})</span></h2>
          <button type="button" className="secondary" onClick={onClose}>닫기</button>
        </div>
        <p className="muted">
          결석자별로 보강요청이 자동 등록되어 담당 강사·조교의 "오늘의 일정 &gt; 보강"에 표시됩니다. 결석이 아니라
          지각이었다면 정정해 주세요.
        </p>

        {items.length === 0 ? (
          <p className="muted">어제 결석자가 없습니다.</p>
        ) : (
          <ul className="schedule-list" style={{ marginTop: 12 }}>
            {items.map((item) => (
              <li key={item.dailyRecordId} className="modal-briefing-item">
                <div className="schedule-item-row">
                  <div>
                    <strong>{item.studentName}</strong> <span className="muted">{schoolGrade(item.school, item.grade)}</span>
                    {" · "}
                    <span className="muted">{item.className}</span>
                    <br />
                    <span className="badge badge-success">보강요청 등록됨</span>
                    {!item.ownerAssigned && (
                      <span className="badge" style={{ marginLeft: 6 }}>담당강사 미지정</span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button type="button" className="secondary" disabled={busyId === item.dailyRecordId} onClick={() => correctToLate(item)}>
                      지각으로 정정
                    </button>
                    <button type="button" className="secondary" disabled={busyId === item.dailyRecordId} onClick={() => cancelMakeup(item)}>
                      보강 취소
                    </button>
                  </div>
                </div>
                {!item.ownerAssigned && <OwnerAssignRow item={item} onAssigned={onChanged} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
