"use client";

import { useState } from "react";
import { todayKST } from "@/lib/date";

export type UnconfirmedScheduleItem = {
  id: string;
  type: string;
  studentName: string;
  className: string;
  date: string | null;
  time: string;
  memo: string;
  lessonContent?: string;
};

function ConfirmRow({ item, onConfirmed }: { item: UnconfirmedScheduleItem; onConfirmed: () => void }) {
  const [date, setDate] = useState(item.date ?? todayKST());
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  // 클릭한 순간 바로 처리 표시로 바꾸고, 실제 결과는 onConfirmed로 이어지는
  // 새로고침이 반영한다.
  const [clicked, setClicked] = useState(false);

  async function confirm() {
    if (!date || !time.trim()) return;
    setClicked(true);
    setSaving(true);
    try {
      await fetch(`/api/schedule-entry/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, time }),
      });
      onConfirmed();
    } finally {
      setSaving(false);
    }
  }

  if (clicked) {
    return (
      <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
        ✓ 확정 처리함{saving ? " (저장 중...)" : ""}
      </p>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 150 }} />
      <input
        type="text"
        placeholder="시간 예: 16:30"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        style={{ maxWidth: 110 }}
      />
      <button type="button" className="secondary" disabled={!date || !time.trim()} onClick={confirm}>
        확정
      </button>
    </div>
  );
}

function ConfirmListItem({ item, onConfirmed }: { item: UnconfirmedScheduleItem; onConfirmed: () => void }) {
  const [showLesson, setShowLesson] = useState(false);
  return (
    <li className="modal-briefing-item">
      <strong>{item.studentName}</strong> <span className="muted">{item.className}</span>
      {" · "}
      <span className="badge">{item.type}</span>
      {item.memo && (
        <>
          <br />
          <span className="muted">{item.memo}</span>
        </>
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
            <p className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13 }}>
              {item.lessonContent}
            </p>
          )}
        </>
      )}
      <ConfirmRow item={item} onConfirmed={onConfirmed} />
    </li>
  );
}

// 담당 강사·조교(또는 배정된 원장/행정)에게 배정된, 아직 학생/학부모와
// 실제 시간을 확정하지 못한 보강·재시 항목을 보여주는 팝업. 여기서 날짜·
// 시간을 입력해 저장하면 그 즉시 확정 처리되어(예정일·시간 갱신) 그 날의
// "오늘의 일정"에 뜬다.
export default function ScheduleConfirmModal({
  items,
  onClose,
  onChanged,
}: {
  items: UnconfirmedScheduleItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>보강·재시 일정 확정 필요 <span className="muted">({items.length})</span></h2>
          <button type="button" className="secondary" onClick={onClose}>닫기</button>
        </div>
        <p className="muted">
          학생·학부모와 협의한 실제 보강·재시 날짜/시간을 입력해 확정해 주세요. 확정하면 그 날짜의 "오늘의
          일정"에 표시됩니다.
        </p>

        {items.length === 0 ? (
          <p className="muted">확정할 항목이 없습니다.</p>
        ) : (
          <ul className="schedule-list" style={{ marginTop: 12 }}>
            {items.map((item) => (
              <ConfirmListItem key={item.id} item={item} onConfirmed={onChanged} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
