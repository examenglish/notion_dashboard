"use client";

import { useEffect, useState } from "react";
import { formatBriefingText } from "@/lib/briefingFormat";
import { stripClassSuffix } from "@/lib/format";

type RosterStudent = { id: string; name: string };
type PerStudentFlags = Record<string, { vocabFail: boolean; homeworkIncomplete: boolean; individualNotice?: string }>;
type ClassOption = { id: string; name: string };

type ExistingBriefing = { id: string; date: string | null; studentId: string | null; content: string };

function initialTexts(draft: {
  date: string;
  className: string;
  progress: string;
  homework: string;
  nextAssignment: string;
  notice: string;
  roster: RosterStudent[];
  perStudent: PerStudentFlags;
}): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of draft.roster) {
    const flags = draft.perStudent[s.id] ?? { vocabFail: false, homeworkIncomplete: false };
    map[s.id] = formatBriefingText({
      date: draft.date,
      className: draft.className,
      studentName: s.name,
      progress: draft.progress,
      homework: draft.homework,
      nextAssignment: draft.nextAssignment,
      notice: draft.notice,
      vocabFail: flags.vocabFail,
      homeworkIncomplete: flags.homeworkIncomplete,
      individualNotice: flags.individualNotice,
    });
  }
  return map;
}

export default function DailyBriefingPreviewModal({
  draft,
  classes,
  onClose,
  onSave,
}: {
  draft: {
    date: string;
    classId: string;
    className: string;
    progress: string;
    homework: string;
    nextAssignment: string;
    notice: string;
    roster: RosterStudent[];
    perStudent: PerStudentFlags;
  };
  classes: ClassOption[];
  onClose: () => void;
  onSave: (texts: Record<string, string>) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [viewDate, setViewDate] = useState(draft.date);
  const [viewClassId, setViewClassId] = useState(draft.classId);
  const [viewRoster, setViewRoster] = useState<RosterStudent[]>(draft.roster);
  const [existing, setExisting] = useState<ExistingBriefing[] | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editedTexts, setEditedTexts] = useState<Record<string, string>>(() => initialTexts(draft));

  const isDraftMode = viewDate === draft.date && viewClassId === draft.classId && !saved;
  const viewClassName = stripClassSuffix(classes.find((c) => c.id === viewClassId)?.name ?? draft.className);

  useEffect(() => {
    if (isDraftMode) {
      setViewRoster(draft.roster);
      setExisting(null);
      return;
    }
    setLoadingExisting(true);
    Promise.all([
      fetch(`/api/students?classId=${viewClassId}`).then((r) => r.json()),
      fetch("/api/briefings").then((r) => r.json()),
    ])
      .then(([roster, briefings]: [RosterStudent[], ExistingBriefing[]]) => {
        setViewRoster(roster);
        const rosterIds = new Set(roster.map((s) => s.id));
        setExisting(briefings.filter((b) => b.date === viewDate && b.studentId && rosterIds.has(b.studentId)));
      })
      .finally(() => setLoadingExisting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDate, viewClassId]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    const res = await onSave(editedTexts);
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.error ?? "저장에 실패했습니다.");
      return;
    }
    setSaved(true);
  }

  function copyText(id: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }

  function copyAll() {
    const combined = draft.roster
      .map((s) => editedTexts[s.id])
      .filter(Boolean)
      .join("\n\n-----\n\n");
    copyText("__all__", combined);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>데일리브리핑 미리보기</h2>
          <button type="button" className="secondary" onClick={onClose}>닫기</button>
        </div>

        <div className="modal-controls">
          <label>날짜</label>
          <input
            type="date"
            value={viewDate}
            onChange={(e) => {
              setSaved(false);
              setViewDate(e.target.value);
            }}
          />
          <label>반</label>
          <select
            value={viewClassId}
            onChange={(e) => {
              setSaved(false);
              setViewClassId(e.target.value);
            }}
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{stripClassSuffix(c.name)}</option>
            ))}
          </select>
        </div>

        {isDraftMode && (
          <>
            <p className="muted" style={{ marginTop: 8 }}>
              아직 저장 전인 오늘 입력 내용의 미리보기입니다. 내용을 직접 수정할 수 있고, 아래 "저장"을 눌러야 실제로 기록됩니다.
            </p>
            <button type="button" className="secondary" onClick={copyAll}>
              {copiedId === "__all__" ? "전체 복사됨" : `전체 복사 (${draft.roster.length}명)`}
            </button>
          </>
        )}
        {!isDraftMode && !saved && (
          <p className="muted" style={{ marginTop: 8 }}>
            {viewDate} · {viewClassName}에 이미 저장된 브리핑을 조회합니다 (조회 전용).
          </p>
        )}
        {saved && <p className="success-box" style={{ marginTop: 8 }}>저장됐습니다. 아래는 방금 저장된 내용입니다.</p>}

        <div className="modal-list">
          {isDraftMode &&
            draft.roster.map((s) => (
              <div key={s.id} className="modal-briefing-item">
                <div className="modal-briefing-top">
                  <strong>{s.name}</strong>
                  <button type="button" className="secondary" onClick={() => copyText(s.id, editedTexts[s.id] ?? "")}>
                    {copiedId === s.id ? "복사됨" : "복사"}
                  </button>
                </div>
                <textarea
                  className="modal-briefing-textarea"
                  value={editedTexts[s.id] ?? ""}
                  onChange={(e) => setEditedTexts((cur) => ({ ...cur, [s.id]: e.target.value }))}
                />
              </div>
            ))}

          {!isDraftMode && loadingExisting && <p className="muted">불러오는 중...</p>}
          {!isDraftMode && !loadingExisting && existing && existing.length === 0 && (
            <p className="muted">이 날짜/반에 저장된 브리핑이 없습니다.</p>
          )}
          {!isDraftMode &&
            !loadingExisting &&
            existing?.map((b) => (
              <div key={b.id} className="modal-briefing-item">
                <div className="modal-briefing-top">
                  <strong>{viewRoster.find((s) => s.id === b.studentId)?.name ?? "학생"}</strong>
                  <button type="button" className="secondary" onClick={() => copyText(b.id, b.content)}>
                    {copiedId === b.id ? "복사됨" : "복사"}
                  </button>
                </div>
                <pre className="modal-briefing-text">{b.content}</pre>
              </div>
            ))}
        </div>

        {saveError && <p className="error-text">{saveError}</p>}

        {isDraftMode && (
          <div style={{ marginTop: 16 }}>
            <button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
