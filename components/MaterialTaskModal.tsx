"use client";

import { useState } from "react";
import StaffPicker from "./StaffPicker";

export type MaterialTaskRecord = {
  id: string;
  title: string;
  requesterName: string;
  ownerName: string;
  content: string;
  progress: number;
  status: string;
  dueDate: string | null;
  fileLocation: string | null;
  files: { name: string; url: string }[];
};

// item=null이면 교사용 "작업요청" 등록 폼, item이 있으면 담당자용 수정 폼
// (작업률/상태/파일저장위치/원본파일 업로드) — 두 흐름이 필드 대부분을
// 공유해서 한 모달로 합쳤다.
export default function MaterialTaskModal({
  item,
  defaultDueDate,
  onClose,
  onSaved,
}: {
  item: MaterialTaskRecord | null;
  defaultDueDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCreate = !item;
  const [title, setTitle] = useState(item?.title ?? "");
  const [content, setContent] = useState(item?.content ?? "");
  const [dueDate, setDueDate] = useState(item?.dueDate ?? defaultDueDate);
  const [owner, setOwner] = useState(item?.ownerName && item.ownerName !== "-" ? item.ownerName : "");
  const [status, setStatus] = useState(item?.status ?? "요청됨");
  const [progress, setProgress] = useState(item?.progress ?? 0);
  const [fileLocation, setFileLocation] = useState(item?.fileLocation ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // create 모드는 페이지가 아직 없어서 파일을 바로 붙일 수 없다 — 선택
  // 즉시 Notion에 올려두기만 하고(draft), file_upload id를 들고 있다가
  // "요청 등록" 시 페이지 생성과 함께 붙인다.
  const [draftUploading, setDraftUploading] = useState(false);
  const [draftFile, setDraftFile] = useState<{ fileUploadId: string; filename: string } | null>(null);

  async function handleDraftFileChange(f: File | null) {
    if (!f) return;
    setError(null);
    setDraftUploading(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/material-tasks/upload-draft", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "파일 업로드에 실패했습니다.");
        return;
      }
      setDraftFile({ fileUploadId: data.fileUploadId, filename: data.filename });
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setDraftUploading(false);
    }
  }

  async function handleSave() {
    setError(null);
    if (!title.trim() || !content.trim() || !dueDate) {
      setError("제목, 작업내용, 마감일은 필수입니다.");
      return;
    }
    setSaving(true);
    try {
      let res: Response;
      if (isCreate) {
        res = await fetch("/api/material-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            content,
            dueDate,
            ownerName: owner || undefined,
            fileUploadId: draftFile?.fileUploadId,
            fileName: draftFile?.filename,
          }),
        });
      } else {
        res = await fetch(`/api/material-tasks/${item!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, dueDate, ownerName: owner, status, progress, fileLocation }),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      if (!isCreate && file) {
        const form = new FormData();
        form.append("file", file);
        const upRes = await fetch(`/api/material-tasks/${item!.id}/upload`, { method: "POST", body: form });
        if (!upRes.ok) {
          const data = await upRes.json().catch(() => ({}));
          setError(data.error ?? "파일 업로드에 실패했습니다.");
          return;
        }
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
          <h2>{isCreate ? "교재·시험자료 작업요청" : `${item!.title} 수정`}</h2>
          <button type="button" className="secondary" onClick={onClose}>닫기</button>
        </div>

        <label htmlFor="mtTitle">제목</label>
        <input id="mtTitle" type="text" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!isCreate} />

        {!isCreate && <p className="muted" style={{ marginTop: 4 }}>요청자: {item!.requesterName}</p>}

        <label htmlFor="mtContent">작업내용</label>
        <textarea id="mtContent" value={content} onChange={(e) => setContent(e.target.value)} />

        <label htmlFor="mtDueDate">마감일</label>
        <input id="mtDueDate" type="date" value={dueDate ?? ""} onChange={(e) => setDueDate(e.target.value)} />

        <StaffPicker value={owner} onChange={setOwner} label="담당자" />

        {isCreate && (
          <>
            <label htmlFor="mtDraftFile">참고파일 업로드 (선택, 최대 4MB)</label>
            <input
              id="mtDraftFile"
              type="file"
              disabled={draftUploading}
              onChange={(e) => handleDraftFileChange(e.target.files?.[0] ?? null)}
            />
            {draftUploading && <p className="muted" style={{ fontSize: 12 }}>업로드 중...</p>}
            {draftFile && !draftUploading && (
              <p className="muted" style={{ fontSize: 12 }}>업로드됨: {draftFile.filename}</p>
            )}
          </>
        )}

        {!isCreate && (
          <>
            <label htmlFor="mtStatus">상태</label>
            <select id="mtStatus" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="요청됨">요청됨</option>
              <option value="진행중">진행중</option>
              <option value="완료">완료</option>
            </select>

            <label htmlFor="mtProgress">작업률 ({progress}%)</label>
            <input
              id="mtProgress"
              type="range"
              min={0}
              max={100}
              step={5}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
            />

            <label htmlFor="mtFileLocation">파일저장위치 (링크)</label>
            <input
              id="mtFileLocation"
              type="text"
              placeholder="예: Google Drive 링크"
              value={fileLocation}
              onChange={(e) => setFileLocation(e.target.value)}
            />

            <label htmlFor="mtFile">원본파일 업로드 (최대 4MB, 새로 올리면 기존 파일 대체)</label>
            <input id="mtFile" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {item!.files.length > 0 && (
              <p className="muted" style={{ fontSize: 12 }}>
                현재 파일:{" "}
                <a href={item!.files[0].url} target="_blank" rel="noreferrer">
                  {item!.files[0].name}
                </a>
              </p>
            )}
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        <div style={{ marginTop: 16 }}>
          <button type="button" disabled={saving || draftUploading} onClick={handleSave}>
            {saving ? "저장 중..." : isCreate ? "요청 등록" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
