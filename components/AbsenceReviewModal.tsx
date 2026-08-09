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
  const [clicked, setClicked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    if (!owner) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/schedule-entry/${item.makeupRequestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerName: owner }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 실패했는데도 "처리함"으로 표시해버리면, 팝업을 다시 열었을 때
        // 여전히 "담당강사 미지정"으로 남아 있어도 사용자는 왜 그런지 알
        // 방법이 없었다 — 이제 실패는 실패로 보여주고 폼을 그대로 남겨
        // 다시 시도할 수 있게 한다.
        setError(data.error ?? "담당자 지정에 실패했습니다.");
        return;
      }
      setClicked(true);
      onAssigned();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (clicked) {
    return (
      <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
        ✓ 담당자 지정 처리함
      </p>
    );
  }

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <StaffPicker value={owner} onChange={setOwner} label="" />
        </div>
        <button type="button" className="secondary" disabled={!owner || saving} onClick={assign}>
          {saving ? "저장 중..." : "담당자 지정"}
        </button>
      </div>
      {error && (
        <p className="error-text" style={{ marginTop: 4, fontSize: 12 }}>
          {error}
        </p>
      )}
    </div>
  );
}

// 결석 체크 직후(당일 포함) 또는 대시보드 진입 시(행정/원장) 뜨는 "결석자
// 검토" 팝업. 조회 시점에 이미 서버가 보강요청을 자동 생성해둔 상태로 items가
// 내려오고, 담당교사가 이미 지정된 건은 서버에서 걸러져 내려오지 않으므로,
// 여기서는 (1) 사실 결석이 아니라 지각이었던 경우 정정, (2) 잘못/불필요하게
// 자동 생성된 보강요청 취소, (3) 담당교사가 자동 매칭되지 않은 건에 담당자를
// 직접 지정하는 세 가지만 다룬다. items는 날짜가 섞여 있을 수 있어(오늘+어제,
// 또는 결석 체크 직후엔 그 날짜 하나) 항목별로 날짜를 표시한다.
export default function AbsenceReviewModal({
  items,
  onClose,
  onChanged,
}: {
  items: AbsenceReviewItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  // 요청이 끝나길 기다리지 않고 버튼을 누른 즉시 "클릭했음"을 보여주기 위한
  // 표시 전용 상태 — 실제 처리 결과(성공/실패)는 onChanged로 이어지는
  // 새로고침이 반영한다. 팝업을 새로 열면(재조회) 초기화된다.
  const [clickedIds, setClickedIds] = useState<Set<string>>(new Set());

  function markClicked(id: string) {
    setClickedIds((cur) => new Set(cur).add(id));
  }

  async function correctToLate(item: AbsenceReviewItem) {
    if (!window.confirm(`${item.studentName} 학생을 결석이 아닌 지각으로 정정할까요? 자동 생성된 보강요청도 함께 취소됩니다.`)) return;
    markClicked(item.dailyRecordId);
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
    markClicked(item.dailyRecordId);
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
          <h2>결석자 검토 <span className="muted">({items.length})</span></h2>
          <button type="button" className="secondary" onClick={onClose}>닫기</button>
        </div>
        <p className="muted">
          결석자별로 보강요청이 자동 등록되어 담당 강사·조교의 "오늘의 일정 &gt; 보강"에 표시됩니다. 결석이 아니라
          지각이었다면 정정해 주세요.
        </p>

        {items.length === 0 ? (
          <p className="muted">결석자가 없습니다.</p>
        ) : (
          <ul className="schedule-list" style={{ marginTop: 12 }}>
            {items.map((item) => {
              const clicked = clickedIds.has(item.dailyRecordId);
              return (
                <li key={item.dailyRecordId} className="modal-briefing-item" style={clicked ? { opacity: 0.6 } : undefined}>
                  <div className="schedule-item-row">
                    <div>
                      <strong>{item.studentName}</strong> <span className="muted">{schoolGrade(item.school, item.grade)}</span>
                      {" · "}
                      <span className="muted">{item.className}</span>
                      {" · "}
                      <span className="muted">{formatDateLabel(item.date)}</span>
                      <br />
                      <span className="badge badge-success">보강요청 등록됨</span>
                      {!item.ownerAssigned && (
                        <span className="badge" style={{ marginLeft: 6 }}>담당강사 미지정</span>
                      )}
                      {clicked && (
                        <span className="badge badge-success" style={{ marginLeft: 6 }}>
                          ✓ 클릭함{busyId === item.dailyRecordId ? " (처리 중...)" : ""}
                        </span>
                      )}
                    </div>
                    {!clicked && (
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button type="button" className="secondary" onClick={() => correctToLate(item)}>
                          지각으로 정정
                        </button>
                        <button type="button" className="secondary" onClick={() => cancelMakeup(item)}>
                          보강 취소
                        </button>
                      </div>
                    )}
                  </div>
                  {!clicked && !item.ownerAssigned && <OwnerAssignRow item={item} onAssigned={onChanged} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
