"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import StaffPicker from "./StaffPicker";

type ProgressEntry = { id: string; date: string | null; progress: string; homework: string; attendance: string | null; homeworkDone: boolean };
type MakeupEntry = { id: string; date: string | null; time: string; owner: string; done: boolean };
type ActionEntry = { id: string; date: string | null; content: string; owner: string };
type CounselingEntry = { id: string; date: string | null; counselor: string; content: string; followUp: string; enteredBy?: string };
type InquiryEntry = { id: string; date: string | null; type: string | null; content: string; done: boolean; enteredBy?: string };
type ClinicEntry = { id: string; date: string | null; assistant: string; content: string; nextPrep: string; source: "record" | "task" };
type ReviewEntry = { id: string; date: string | null; content: string; done: boolean };
type CategoryBreakdown = { label: string; done: number; total: number };
type ExamPrepSummary = {
  level: "중등" | "고등";
  examTitle: string;
  examRange: string;
  examDate: string | null;
  teachers: string[];
  progress: number;
  weakPoints: string;
  updatedAt: string | null;
  categories: CategoryBreakdown[];
};

type History = {
  progress: ProgressEntry[];
  makeup: MakeupEntry[];
  actions: ActionEntry[];
  counseling: CounselingEntry[];
  inquiries: InquiryEntry[];
  clinic: ClinicEntry[];
  review: ReviewEntry[];
  examPrep: ExamPrepSummary | null;
};

function categoryColor(done: number, total: number): string {
  if (total === 0) return "#94a3b8";
  const ratio = done / total;
  if (ratio >= 0.8) return "#22c55e";
  if (ratio >= 0.4) return "#f59e0b";
  return "#e5484d";
}

type StudentBasic = { name: string; school: string; grade: string | null; memo: string };

type EditState =
  | { kind: "makeup"; id: string; date: string; time: string; owner: string }
  | { kind: "actions"; id: string; date: string; content: string; owner: string }
  | { kind: "review"; id: string; date: string; content: string }
  | { kind: "counseling"; id: string; date: string; counselor: string; content: string; followUp: string }
  | { kind: "inquiries"; id: string; date: string; content: string }
  | { kind: "clinic"; id: string; content: string; nextPrep: string; source: "record" | "task" };

const DELETE_ENDPOINT: Record<EditState["kind"] | "progress", (id: string) => string> = {
  progress: (id) => `/api/daily-record/${id}`,
  makeup: (id) => `/api/schedule-entry/${id}`,
  actions: (id) => `/api/schedule-entry/${id}`,
  review: (id) => `/api/schedule-entry/${id}`,
  counseling: (id) => `/api/counseling/${id}`,
  inquiries: (id) => `/api/admin-inbox/${id}`,
  // "클리닉 기록"은 두 군데서 온다 — DB⑮조교클리닉기록(source: "record")과
  // DB⑱할일관리의 유형="클리닉" 항목(source: "task")이라 삭제 endpoint가 다르다.
  // 기본값은 record 쪽이고, task 쪽은 삭제 호출 시 명시적으로 override한다.
  clinic: (id) => `/api/clinic-records/${id}`,
};

export default function StudentHistoryModal({
  studentId,
  student,
  staffName,
  staffRole,
  trendData,
  scoreData,
  onClose,
  onChanged,
}: {
  studentId: string;
  student: StudentBasic;
  staffName: string | null;
  staffRole: string | null;
  trendData: { date: string; 출석: number; 과제: number }[];
  scoreData: { date: string; 점수: number; 시험명: string }[];
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [memo, setMemo] = useState(student.memo);
  const [savingMemo, setSavingMemo] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canDelete = staffRole === "원장";
  const canEditEntered = (enteredBy?: string) => !enteredBy || enteredBy === staffName || staffRole === "원장";

  function loadHistory() {
    setLoading(true);
    fetch(`/api/students/${studentId}/history`)
      .then((r) => r.json())
      .then((data) => setHistory(data && !data.error ? data : null))
      .catch(() => setHistory(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  useEffect(() => {
    setMemo(student.memo);
  }, [student.memo]);

  async function saveMemo() {
    setSavingMemo(true);
    setError(null);
    try {
      const res = await fetch(`/api/students/${studentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "개인메모 저장에 실패했습니다.");
        return;
      }
      onChanged?.();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSavingMemo(false);
    }
  }

  async function handleDelete(kind: EditState["kind"] | "progress", id: string, endpointOverride?: string) {
    if (!window.confirm("이 기록을 삭제하시겠습니까?")) return;
    setBusyDeleteId(id);
    setError(null);
    try {
      const res = await fetch(endpointOverride ?? DELETE_ENDPOINT[kind](id), { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "삭제에 실패했습니다.");
        return;
      }
      loadHistory();
      onChanged?.();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setBusyDeleteId(null);
    }
  }

  async function handleSaveEdit() {
    if (!edit) return;
    setSaving(true);
    setError(null);
    try {
      let res: Response;
      if (edit.kind === "makeup") {
        res = await fetch(`/api/schedule-entry/${edit.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: edit.date, time: edit.time, ownerName: edit.owner }),
        });
      } else if (edit.kind === "actions") {
        res = await fetch(`/api/schedule-entry/${edit.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: edit.date, title: edit.content, ownerName: edit.owner }),
        });
      } else if (edit.kind === "review") {
        res = await fetch(`/api/schedule-entry/${edit.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: edit.date, note: edit.content }),
        });
      } else if (edit.kind === "counseling") {
        res = await fetch(`/api/counseling/${edit.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: edit.date, counselor: edit.counselor, summary: edit.content, followUp: edit.followUp }),
        });
      } else if (edit.kind === "inquiries") {
        res = await fetch(`/api/admin-inbox/${edit.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDate: edit.date, content: edit.content }),
        });
      } else if (edit.source === "task") {
        // DB⑱할일관리 유형="클리닉" 항목 — 메모 필드 하나만 있고 별도
        // "다음준비사항" 개념이 없으므로 note로만 저장한다.
        res = await fetch(`/api/schedule-entry/${edit.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: edit.content }),
        });
      } else {
        res = await fetch(`/api/clinic-records/${edit.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: edit.content, nextPrep: edit.nextPrep }),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "수정에 실패했습니다.");
        return;
      }
      setEdit(null);
      loadHistory();
      onChanged?.();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function ActionButtons({
    kind,
    id,
    canEdit,
    onEditClick,
    deleteEndpoint,
  }: {
    kind: EditState["kind"] | "progress";
    id: string;
    canEdit: boolean;
    onEditClick?: () => void;
    deleteEndpoint?: string;
  }) {
    return (
      <span className="no-print" style={{ display: "inline-flex", gap: 6, marginLeft: 8 }}>
        {onEditClick && canEdit && (
          <button type="button" className="secondary" style={{ padding: "2px 8px", fontSize: 12 }} onClick={onEditClick}>
            수정
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className="secondary"
            style={{ padding: "2px 8px", fontSize: 12 }}
            disabled={busyDeleteId === id}
            onClick={() => handleDelete(kind, id, deleteEndpoint)}
          >
            {busyDeleteId === id ? "삭제 중..." : "삭제"}
          </button>
        )}
      </span>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="print-area">
          <div className="modal-header">
            <h2>
              {student.name} 전체기록 <span className="muted">{student.school} {student.grade}</span>
            </h2>
            <div className="no-print" style={{ display: "flex", gap: 8 }}>
              <button type="button" className="secondary" onClick={() => window.print()}>인쇄</button>
              <button type="button" className="secondary" onClick={onClose}>닫기</button>
            </div>
          </div>

          <h3 style={{ marginTop: 16 }} className="no-print">개인메모</h3>
          <div className="no-print">
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="이 학생에 대한 개인메모를 남겨주세요 (이 화면에서만 보입니다)"
              style={{ minHeight: 70 }}
            />
            <button type="button" className="secondary" disabled={savingMemo} onClick={saveMemo} style={{ marginTop: 6 }}>
              {savingMemo ? "저장 중..." : "메모 저장"}
            </button>
          </div>

          {error && <p className="error-text no-print">{error}</p>}

          <h3 style={{ marginTop: 16 }}>출결/과제 추이</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis domain={[0, 1]} ticks={[0, 1]} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="출석" stroke="#2f6fed" strokeWidth={2} />
              <Line type="monotone" dataKey="과제" stroke="#22c55e" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>

          <h3 style={{ marginTop: 16 }}>성적 추이</h3>
          {scoreData.length === 0 ? (
            <p className="muted">등록된 시험 성적이 없습니다.</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={scoreData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="점수" stroke="#f59e0b" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}

          {loading && <p className="muted" style={{ marginTop: 16 }}>불러오는 중...</p>}
          {!loading && !history && <p className="muted" style={{ marginTop: 16 }}>기록을 불러오지 못했습니다.</p>}
          {!loading && history && (
            <>
              <h3 style={{ marginTop: 16 }}>시험대비 현황</h3>
              {!history.examPrep ? (
                <p className="muted">등록된 시험대비 시트가 없습니다.</p>
              ) : (
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="badge">{history.examPrep.level}</span>
                    <strong>{history.examPrep.examTitle || "시험명 미입력"}</strong>
                    {history.examPrep.examRange && <span className="muted">({history.examPrep.examRange})</span>}
                    <span className="badge">진행률 {history.examPrep.progress}%</span>
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                    담당교사: {history.examPrep.teachers.length > 0 ? history.examPrep.teachers.join(", ") : "-"}
                    {history.examPrep.examDate && ` · 시험일: ${history.examPrep.examDate}`}
                    {history.examPrep.updatedAt && ` · 최근 저장: ${history.examPrep.updatedAt}`}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                    {history.examPrep.categories.map((c) => (
                      <span
                        key={c.label}
                        className="badge"
                        style={{ background: categoryColor(c.done, c.total), color: "#fff", fontSize: 11 }}
                      >
                        {c.label} {c.done}/{c.total}
                      </span>
                    ))}
                  </div>
                  {history.examPrep.weakPoints && (
                    <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                      취약부분: {history.examPrep.weakPoints}
                    </div>
                  )}
                </div>
              )}

              <h3 style={{ marginTop: 20 }}>진도 / 과제 기록</h3>
              {history.progress.length === 0 ? (
                <p className="muted">기록이 없습니다.</p>
              ) : (
                <ul className="history-log">
                  {history.progress.map((r) => (
                    <li key={r.id}>
                      <strong>{r.date ?? "-"}</strong>
                      {" · "}
                      {r.attendance ?? "-"}
                      {" · "}
                      진도: {r.progress || "-"}
                      {" · "}
                      과제: {r.homework || "-"} ({r.homeworkDone ? "완료" : "미완료"})
                      <ActionButtons kind="progress" id={r.id} canEdit={false} />
                    </li>
                  ))}
                </ul>
              )}

              <h3 style={{ marginTop: 20 }}>보강 이력</h3>
              {history.makeup.length === 0 ? (
                <p className="muted">보강 이력이 없습니다.</p>
              ) : (
                <ul className="history-log">
                  {history.makeup.map((m) =>
                    edit?.kind === "makeup" && edit.id === m.id ? (
                      <li key={m.id}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <input type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} />
                          <input
                            type="text"
                            value={edit.time}
                            placeholder="시간"
                            onChange={(e) => setEdit({ ...edit, time: e.target.value })}
                            style={{ width: 100 }}
                          />
                          <div style={{ width: 160 }}>
                            <StaffPicker value={edit.owner} onChange={(v) => setEdit({ ...edit, owner: v })} label="" />
                          </div>
                          <button type="button" disabled={saving} onClick={handleSaveEdit}>저장</button>
                          <button type="button" className="secondary" onClick={() => setEdit(null)}>취소</button>
                        </div>
                      </li>
                    ) : (
                      <li key={m.id}>
                        <strong>{m.date ?? "-"}</strong>
                        {" · "}
                        {m.time || "시간 미정"}
                        {" · "}
                        보강자: {m.owner}
                        {" · "}
                        {m.done ? "완료" : "예정"}
                        <ActionButtons
                          kind="makeup"
                          id={m.id}
                          canEdit
                          onEditClick={() => setEdit({ kind: "makeup", id: m.id, date: m.date ?? "", time: m.time, owner: m.owner === "-" ? "" : m.owner })}
                        />
                      </li>
                    )
                  )}
                </ul>
              )}

              <h3 style={{ marginTop: 20 }}>조치사항 이력</h3>
              {history.actions.length === 0 ? (
                <p className="muted">조치사항 이력이 없습니다.</p>
              ) : (
                <ul className="history-log">
                  {history.actions.map((a) =>
                    edit?.kind === "actions" && edit.id === a.id ? (
                      <li key={a.id}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
                          <input type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} />
                          <div style={{ width: 160 }}>
                            <StaffPicker value={edit.owner} onChange={(v) => setEdit({ ...edit, owner: v })} label="" />
                          </div>
                        </div>
                        <textarea value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} style={{ minHeight: 60 }} />
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button type="button" disabled={saving} onClick={handleSaveEdit}>저장</button>
                          <button type="button" className="secondary" onClick={() => setEdit(null)}>취소</button>
                        </div>
                      </li>
                    ) : (
                      <li key={a.id}>
                        <strong>{a.date ?? "-"}</strong>
                        {" · "}
                        담당자: {a.owner}
                        <ActionButtons
                          kind="actions"
                          id={a.id}
                          canEdit
                          onEditClick={() => setEdit({ kind: "actions", id: a.id, date: a.date ?? "", content: a.content, owner: a.owner === "-" ? "" : a.owner })}
                        />
                        <br />
                        {a.content || "-"}
                      </li>
                    )
                  )}
                </ul>
              )}

              <h3 style={{ marginTop: 20 }}>상담 기록</h3>
              {history.counseling.length === 0 ? (
                <p className="muted">상담 기록이 없습니다.</p>
              ) : (
                <ul className="history-log">
                  {history.counseling.map((c) =>
                    edit?.kind === "counseling" && edit.id === c.id ? (
                      <li key={c.id}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
                          <input type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} />
                          <div style={{ width: 160 }}>
                            <StaffPicker value={edit.counselor} onChange={(v) => setEdit({ ...edit, counselor: v })} label="" />
                          </div>
                        </div>
                        <textarea
                          value={edit.content}
                          onChange={(e) => setEdit({ ...edit, content: e.target.value })}
                          placeholder="상담내용"
                          style={{ minHeight: 60 }}
                        />
                        <textarea
                          value={edit.followUp}
                          onChange={(e) => setEdit({ ...edit, followUp: e.target.value })}
                          placeholder="후속조치"
                          style={{ minHeight: 40, marginTop: 4 }}
                        />
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button type="button" disabled={saving} onClick={handleSaveEdit}>저장</button>
                          <button type="button" className="secondary" onClick={() => setEdit(null)}>취소</button>
                        </div>
                      </li>
                    ) : (
                      <li key={c.id}>
                        <strong>{c.date ?? "-"}</strong>
                        {" · "}
                        상담자: {c.counselor || "-"}
                        <ActionButtons
                          kind="counseling"
                          id={c.id}
                          canEdit={canEditEntered(c.enteredBy)}
                          onEditClick={() => setEdit({ kind: "counseling", id: c.id, date: c.date ?? "", counselor: c.counselor, content: c.content, followUp: c.followUp })}
                        />
                        <br />
                        {c.content || "-"}
                        {c.followUp && <div className="muted">후속조치: {c.followUp}</div>}
                      </li>
                    )
                  )}
                </ul>
              )}

              <h3 style={{ marginTop: 20 }}>문의/행정 처리 이력</h3>
              {history.inquiries.length === 0 ? (
                <p className="muted">문의/행정 처리 이력이 없습니다.</p>
              ) : (
                <ul className="history-log">
                  {history.inquiries.map((q) =>
                    edit?.kind === "inquiries" && edit.id === q.id ? (
                      <li key={q.id}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
                          <input type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} />
                        </div>
                        <textarea value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} style={{ minHeight: 60 }} />
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button type="button" disabled={saving} onClick={handleSaveEdit}>저장</button>
                          <button type="button" className="secondary" onClick={() => setEdit(null)}>취소</button>
                        </div>
                      </li>
                    ) : (
                      <li key={q.id}>
                        <strong>{q.date ?? "-"}</strong>
                        {" · "}
                        {q.type ?? "-"}
                        {" · "}
                        {q.done ? "처리완료" : "미처리"}
                        <ActionButtons
                          kind="inquiries"
                          id={q.id}
                          canEdit={canEditEntered(q.enteredBy)}
                          onEditClick={() => setEdit({ kind: "inquiries", id: q.id, date: q.date ?? "", content: q.content })}
                        />
                        <br />
                        {q.content || "-"}
                      </li>
                    )
                  )}
                </ul>
              )}

              <h3 style={{ marginTop: 20 }}>클리닉 기록</h3>
              {history.clinic.length === 0 ? (
                <p className="muted">클리닉 기록이 없습니다.</p>
              ) : (
                <ul className="history-log">
                  {history.clinic.map((c) =>
                    edit?.kind === "clinic" && edit.id === c.id ? (
                      <li key={c.id}>
                        <textarea
                          value={edit.content}
                          onChange={(e) => setEdit({ ...edit, content: e.target.value })}
                          placeholder="진행내용"
                          style={{ minHeight: 60 }}
                        />
                        {edit.source === "record" && (
                          <textarea
                            value={edit.nextPrep}
                            onChange={(e) => setEdit({ ...edit, nextPrep: e.target.value })}
                            placeholder="다음준비사항"
                            style={{ minHeight: 40, marginTop: 4 }}
                          />
                        )}
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button type="button" disabled={saving} onClick={handleSaveEdit}>저장</button>
                          <button type="button" className="secondary" onClick={() => setEdit(null)}>취소</button>
                        </div>
                      </li>
                    ) : (
                      <li key={c.id}>
                        <strong>{c.date ?? "-"}</strong>
                        {" · "}
                        담당 조교: {c.assistant || "-"}
                        {c.source === "task" && <span className="muted"> · 오늘의 일정에서 지시된 클리닉</span>}
                        <ActionButtons
                          kind="clinic"
                          id={c.id}
                          canEdit
                          onEditClick={() => setEdit({ kind: "clinic", id: c.id, content: c.content, nextPrep: c.nextPrep, source: c.source })}
                          deleteEndpoint={c.source === "task" ? `/api/schedule-entry/${c.id}` : undefined}
                        />
                        <br />
                        {c.content || "-"}
                        {c.nextPrep && <div className="muted">다음 준비사항: {c.nextPrep}</div>}
                      </li>
                    )
                  )}
                </ul>
              )}

              <h3 style={{ marginTop: 20 }}>복습 이력</h3>
              {history.review.length === 0 ? (
                <p className="muted">자동 예약된 복습 이력이 없습니다.</p>
              ) : (
                <ul className="history-log">
                  {history.review.map((r) =>
                    edit?.kind === "review" && edit.id === r.id ? (
                      <li key={r.id}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
                          <input type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} />
                        </div>
                        <textarea value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} style={{ minHeight: 60 }} />
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button type="button" disabled={saving} onClick={handleSaveEdit}>저장</button>
                          <button type="button" className="secondary" onClick={() => setEdit(null)}>취소</button>
                        </div>
                      </li>
                    ) : (
                      <li key={r.id}>
                        <strong>{r.date ?? "-"}</strong>
                        {" · "}
                        {r.done ? "완료" : "예정"}
                        <ActionButtons
                          kind="review"
                          id={r.id}
                          canEdit
                          onEditClick={() => setEdit({ kind: "review", id: r.id, date: r.date ?? "", content: r.content })}
                        />
                        <br />
                        {r.content || "-"}
                      </li>
                    )
                  )}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
