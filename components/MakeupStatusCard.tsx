"use client";

export type MakeupScheduleItem = {
  id: string;
  type: string;
  studentName: string;
  className: string;
  ownerName: string;
  date: string | null;
  time: string;
  memo: string;
  confirmed: boolean;
};

// 행정/원장에게는 전체 보강·재시 확정 현황(scope="all")을, 강사·조교에게는
// 본인 담당 건만(scope="mine") 보여준다 — 데이터 자체는 /api/makeup-status가
// 역할에 따라 이미 걸러서 내려준다.
export default function MakeupStatusCard({
  scope,
  items,
  onOpenConfirm,
}: {
  scope: "all" | "mine";
  items: MakeupScheduleItem[];
  onOpenConfirm: () => void;
}) {
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
        <button type="button" className="secondary" onClick={onOpenConfirm}>
          미확정 {unconfirmed.length}건 처리하기
        </button>
      )}
      <ul className="schedule-list" style={{ marginTop: 12 }}>
        {sorted.map((item) => (
          <li key={item.id} className="schedule-item-row">
            <div>
              <strong>{item.studentName}</strong> <span className="muted">{item.className}</span>
              {" · "}
              <span className="badge">{item.type}</span>
              {scope === "all" && <span className="muted"> · 담당: {item.ownerName}</span>}
              <br />
              {item.confirmed ? (
                <span className="badge badge-success">확정 · {item.date} {item.time}</span>
              ) : (
                <span className="badge badge-urgent">미확정{item.date ? ` (임시 ${item.date})` : ""}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
