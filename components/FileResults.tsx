"use client";

import { useState } from "react";
import Link from "next/link";

// 파일 검색 결과 카드(읽기 전용) — lib/fileArchive.ts FileHit. Drive 원본은 DB에 등록된 drive_url로
// 새 탭에서 연다(EXAM AI 서버를 거치지 않음). 처음 10개만 보여주고 나머지는 "더 보기".
export type FileHit = {
  id: string;
  filename: string;
  uploadedAt: string | null;
  uploader: string;
  scope: "이 지점" | "공용";
  fromOtherBranch: boolean;
  branchLabel?: string;
  messageSnippet: string;
  driveUrl: string;
  relatedTask: { id: string; label: string } | null;
};

const PAGE = 10;
const KST_DATE = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export default function FileResults({ files }: { files: FileHit[] }) {
  const [shown, setShown] = useState(PAGE);
  if (files.length === 0) return null;
  return (
    <div>
      <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
        {files.slice(0, shown).map((f) => (
          <li key={f.id} style={{ padding: "8px 0", borderTop: "1px solid rgba(0,0,0,0.08)", whiteSpace: "normal" }}>
            <strong style={{ wordBreak: "break-all" }}>{f.filename}</strong>
            {f.scope === "공용" && <span className="badge" style={{ marginLeft: 6 }}>공용</span>}
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              {f.uploadedAt ? KST_DATE.format(new Date(f.uploadedAt)) : "-"}
              {f.branchLabel ? ` · ${f.branchLabel}` : ""} · {f.uploader}
            </div>
            {f.messageSnippet && <div style={{ fontSize: 12, opacity: 0.8 }}>“{f.messageSnippet}”</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              {f.driveUrl && (
                <a href={f.driveUrl} target="_blank" rel="noopener noreferrer">
                  <button type="button" className="secondary">파일 열기 ↗</button>
                </a>
              )}
              {f.relatedTask && (
                <Link href="/director/tasks" title={f.relatedTask.label}>
                  <button type="button" className="secondary">관련 업무 보기</button>
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      {files.length > shown && (
        <button type="button" className="secondary schedule-more-btn" onClick={() => setShown((n) => n + PAGE)}>
          더 보기 ({files.length - shown}건)
        </button>
      )}
    </div>
  );
}
