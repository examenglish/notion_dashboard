"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ManualRecord = {
  id: string;
  title: string;
  category: string;
  targetRoles: string[];
  status: "DRAFT" | "REVIEW" | "PUBLISHED";
  sourceVideoUrl: string | null;
  summary: string;
};
type ManualStepRecord = {
  id: string;
  order: number;
  title: string;
  description: string;
  screenshot: string | null;
  videoTimestamp: string;
  warning: string;
  relatedPath: string;
};

const ROLE_OPTIONS = ["원장", "행정", "강사", "조교"];

function StepEditor({
  manualId,
  step,
  canEdit,
  onChanged,
}: {
  manualId: string;
  step: ManualStepRecord;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(step.title);
  const [description, setDescription] = useState(step.description);
  const [warning, setWarning] = useState(step.warning);
  const [relatedPath, setRelatedPath] = useState(step.relatedPath);
  const [screenshot, setScreenshot] = useState(step.screenshot ?? "");
  const [saving, setSaving] = useState(false);

  async function saveStep() {
    setSaving(true);
    try {
      await fetch(`/api/manuals/${manualId}/steps/${step.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, warning, relatedPath, screenshot }),
      });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function removeStep() {
    if (!window.confirm("이 단계를 삭제할까요?")) return;
    await fetch(`/api/manuals/${manualId}/steps/${step.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display: "flex", gap: 12 }}>
        {screenshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={screenshot} alt="" style={{ width: 160, height: "auto", borderRadius: 6, flexShrink: 0 }} />
        ) : (
          <div className="muted" style={{ width: 160, flexShrink: 0 }}>스크린샷 없음</div>
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="muted">{step.order}단계 · 영상 {step.videoTimestamp}</span>
          {canEdit ? (
            <>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              <input type="text" value={warning} onChange={(e) => setWarning(e.target.value)} placeholder="주의사항" />
              <input type="text" value={relatedPath} onChange={(e) => setRelatedPath(e.target.value)} placeholder="관련 경로" />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" disabled={saving} onClick={saveStep}>
                  저장
                </button>
                {screenshot && (
                  <button type="button" className="secondary" onClick={() => setScreenshot("")}>
                    스크린샷 제외(개인정보)
                  </button>
                )}
                <button type="button" className="secondary" onClick={removeStep}>
                  삭제
                </button>
              </div>
            </>
          ) : (
            <>
              <strong>{title}</strong>
              <p style={{ whiteSpace: "pre-wrap" }}>{description}</p>
              {warning && <p className="error-text">⚠ {warning}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ManualReviewClient({
  manual,
  steps,
  role,
}: {
  manual: ManualRecord;
  steps: ManualStepRecord[];
  role: string;
}) {
  const router = useRouter();
  const canEdit = role === "원장" || role === "행정" || role === "강사";
  const [title, setTitle] = useState(manual.title);
  const [category, setCategory] = useState(manual.category);
  const [targetRoles, setTargetRoles] = useState<string[]>(manual.targetRoles);
  const [summary, setSummary] = useState(manual.summary);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  function toggleRole(r: string) {
    setTargetRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  }

  async function saveMeta() {
    setSaving(true);
    try {
      await fetch(`/api/manuals/${manual.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category, targetRoles, summary }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setPublishing(true);
    try {
      await fetch(`/api/manuals/${manual.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PUBLISHED" }),
      });
      router.refresh();
    } finally {
      setPublishing(false);
    }
  }

  async function unpublish() {
    await fetch(`/api/manuals/${manual.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DRAFT" }),
    });
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>
            {manual.status !== "PUBLISHED" && <span className="badge badge-urgent">{manual.status}</span>}{" "}
            {manual.status === "PUBLISHED" && <span className="badge badge-success">PUBLISHED</span>} {title}
          </h2>
          {canEdit &&
            (manual.status === "PUBLISHED" ? (
              <button type="button" className="secondary" onClick={unpublish}>
                게시 취소
              </button>
            ) : (
              <button type="button" disabled={publishing} onClick={publish}>
                {publishing ? "게시 중..." : "게시하기"}
              </button>
            ))}
        </div>
        {manual.status !== "PUBLISHED" && (
          <p className="success-box" style={{ marginTop: 8 }}>
            개인정보 포함 가능 — 게시 전에 아래 단계별 스크린샷에 학생 이름/연락처/성적 등이 보이지 않는지 확인해주세요.
          </p>
        )}
        {canEdit && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <label>
              제목
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%" }} />
            </label>
            <label>
              카테고리
              <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} />
            </label>
            <div>
              대상 역할:{" "}
              {ROLE_OPTIONS.map((r) => (
                <label key={r} style={{ marginRight: 10 }}>
                  <input type="checkbox" checked={targetRoles.includes(r)} onChange={() => toggleRole(r)} /> {r}
                </label>
              ))}
            </div>
            <label>
              요약
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} style={{ width: "100%" }} />
            </label>
            <button type="button" disabled={saving} onClick={saveMeta} style={{ alignSelf: "flex-start" }}>
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {steps.map((s) => (
          <StepEditor key={s.id} manualId={manual.id} step={s} canEdit={canEdit} onChanged={() => router.refresh()} />
        ))}
      </div>
    </div>
  );
}
