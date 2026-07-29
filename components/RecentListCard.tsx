"use client";

import { useEffect, useState } from "react";

export default function RecentListCard<T>({
  title,
  items,
  renderItem,
  keyOf,
  pageSize = 10,
  emptyText = "표시할 항목이 없습니다.",
}: {
  title: string;
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  keyOf: (item: T) => string;
  pageSize?: number;
  emptyText?: string;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  // Snap back to a valid page if the underlying list shrinks/reloads.
  useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [pageCount, page]);

  const start = page * pageSize;
  const visible = items.slice(start, start + pageSize);

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

      {items.length > pageSize && (
        <div className="pager">
          <button
            type="button"
            className="secondary"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            이전
          </button>
          <span className="muted">
            {page + 1} / {pageCount} 페이지
          </span>
          <button
            type="button"
            className="secondary"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
