"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

export default function Popup({
  title,
  countLabel,
  onClose,
  children,
}: {
  title: string;
  countLabel?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border border-border bg-card shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {countLabel && <p className="text-xs text-muted-foreground">{countLabel}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded bg-transparent p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2">{children}</div>
      </div>
    </div>
  );
}
