"use client";

import { useState } from "react";

export default function RecentListCard<T>({
  title,
  items,
  renderItem,
  keyOf,
  initialCount = 10,
  emptyText = "표시할 항목이 없습니다.",
}: {
  title: string;
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  keyOf: (item: T) => string;
  initialCount?: number;
  emptyText?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, initialCount);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2>{title}</h2>
        <span className="muted">전체 {items.length}건</span>
      </div>

      {items.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <div className="recent-list">
          {visible.map((item) => (
            <div key={keyOf(item)} className="recent-list-row">
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}

      {items.length > initialCount && (
        <button
          type="button"
          className="secondary"
          style={{ marginTop: 12 }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "접기" : `전체보기 (${items.length}건)`}
        </button>
      )}
    </div>
  );
}
