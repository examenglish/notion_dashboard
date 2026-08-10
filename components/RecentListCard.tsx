"use client";

import { useEffect, useState } from "react";

// 랜딩페이지 스크롤을 줄이기 위해 카드 본문에는 최근 5건만 인라인으로
// 보여주고, 나머지(페이지네이션 포함 전체 목록)는 "더보기" 클릭 시 팝업으로만
// 노출한다 — TodayScheduleCard의 ScheduleSectionCard/SchedulePopup과 동일한
// 패턴. 필터 컨트롤은 카드에 한 번만 두고(팝업에도 같은 items가 이미
// 필터링되어 들어오므로 중복 렌더 불필요) 그 결과가 미리보기·팝업 둘 다에
// 반영되게 한다.
const PREVIEW_SIZE = 5;

export default function RecentListCard<T>({
  title,
  items,
  renderItem,
  keyOf,
  onItemClick,
  pageSize = 10,
  emptyText = "표시할 항목이 없습니다.",
  filters,
  totalCount,
}: {
  title: string;
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  keyOf: (item: T) => string;
  onItemClick?: (item: T) => void;
  pageSize?: number;
  emptyText?: string;
  // Search/filter controls rendered between the header and the list — the
  // list itself (and its "전체 N건" count) always reflects the already
  // filtered `items`, so the caller does the filtering and this component
  // stays a dumb paginated list either way.
  filters?: React.ReactNode;
  // When filters are active, showing how many that narrows down from is
  // more useful than just the filtered count. Optional — defaults to
  // items.length (no filtering).
  totalCount?: number;
}) {
  const [popupOpen, setPopupOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  // Snap back to a valid page if the underlying list shrinks/reloads.
  useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [pageCount, page]);

  const previewItems = items.slice(0, PREVIEW_SIZE);
  const start = page * pageSize;
  const popupItems = items.slice(start, start + pageSize);

  function renderRow(item: T) {
    return (
      <div
        key={keyOf(item)}
        className={onItemClick ? "recent-list-row clickable" : "recent-list-row"}
        onClick={onItemClick ? () => onItemClick(item) : undefined}
      >
        {renderItem(item)}
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2>{title}</h2>
        <span className="muted">
          {totalCount !== undefined && totalCount !== items.length
            ? `전체 ${totalCount}건 중 ${items.length}건`
            : `전체 ${items.length}건`}
        </span>
      </div>

      {filters && <div style={{ margin: "8px 0 12px" }}>{filters}</div>}

      {items.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <div className="recent-list">{previewItems.map(renderRow)}</div>
      )}

      {items.length > PREVIEW_SIZE && (
        <button type="button" className="secondary schedule-more-btn" onClick={() => setPopupOpen(true)}>
          더보기
        </button>
      )}

      {popupOpen && (
        <div className="modal-backdrop" onClick={() => setPopupOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {title} <span className="muted">(전체 {items.length}건)</span>
              </h2>
              <button type="button" className="secondary" onClick={() => setPopupOpen(false)}>
                닫기
              </button>
            </div>

            {items.length === 0 ? (
              <p className="muted">{emptyText}</p>
            ) : (
              <div className="recent-list">{popupItems.map(renderRow)}</div>
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
        </div>
      )}
    </div>
  );
}
