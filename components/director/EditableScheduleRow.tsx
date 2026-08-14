"use client";

import { useState } from "react";

export type InquiryItem = {
  id: string;
  studentName: string;
  content: string;
};

export type CounselingItem = {
  id: string;
  studentName: string;
  counselor: string;
  content: string;
  followUp: string;
};

// 원장이 항상 이 화면(원장 전용 /director)의 뷰어이므로, 서버(app/api/admin-inbox/[id],
// app/api/counseling/[id])가 "본인 입력분 또는 원장"만 허용하는 규칙상 여기서는
// 항상 통과한다 — 별도로 입력자 일치 여부를 클라이언트에서 검사할 필요는 없다.
export function InquiryEditRow({ item, onChanged }: { item: InquiryItem; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(item.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin-inbox/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setEditing(false);
      onChanged();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`${item.studentName}님의 행정실 문의를 삭제하시겠습니까?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin-inbox/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "삭제에 실패했습니다.");
        return;
      }
      onChanged();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b border-border py-1.5 text-[13px] last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{item.studentName} · 행정실 문의</span>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="bg-transparent p-0 text-[11px] font-medium text-primary hover:underline"
          >
            {editing ? "닫기" : "수정"}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={saving}
            className="bg-transparent p-0 text-[11px] font-medium text-destructive hover:underline"
          >
            삭제
          </button>
        </div>
      </div>
      {editing ? (
        <div className="mt-1 flex flex-col gap-1.5">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-input bg-background p-1.5 text-[12px] text-foreground"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
            {error && <p className="text-[11px] text-destructive">{error}</p>}
          </div>
        </div>
      ) : (
        <p className="truncate text-[11px] text-muted-foreground">{item.content || "-"}</p>
      )}
    </div>
  );
}

export function CounselingEditRow({ item, onChanged }: { item: CounselingItem; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(item.content);
  const [followUp, setFollowUp] = useState(item.followUp);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/counseling/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: content, followUp }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setEditing(false);
      onChanged();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`${item.studentName}님의 상담일지를 삭제하시겠습니까?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/counseling/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "삭제에 실패했습니다.");
        return;
      }
      onChanged();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b border-border py-1.5 text-[13px] last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">
          {item.studentName} · 상담일지{item.counselor ? ` (${item.counselor})` : ""}
        </span>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="bg-transparent p-0 text-[11px] font-medium text-primary hover:underline"
          >
            {editing ? "닫기" : "수정"}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={saving}
            className="bg-transparent p-0 text-[11px] font-medium text-destructive hover:underline"
          >
            삭제
          </button>
        </div>
      </div>
      {editing ? (
        <div className="mt-1 flex flex-col gap-1.5">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="상담내용"
            rows={2}
            className="w-full rounded-md border border-input bg-background p-1.5 text-[12px] text-foreground"
          />
          <textarea
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            placeholder="후속조치"
            rows={1}
            className="w-full rounded-md border border-input bg-background p-1.5 text-[12px] text-foreground"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
            {error && <p className="text-[11px] text-destructive">{error}</p>}
          </div>
        </div>
      ) : (
        <>
          <p className="truncate text-[11px] text-muted-foreground">{item.content || "-"}</p>
          {item.followUp && <p className="truncate text-[11px] text-muted-foreground">후속조치: {item.followUp}</p>}
        </>
      )}
    </div>
  );
}
