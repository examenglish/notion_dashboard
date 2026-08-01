"use client";

import { useEffect, useMemo, useState } from "react";
import StudentPicker from "./StudentPicker";
import { todayKST } from "@/lib/date";
import {
  type ExamPrepData,
  type ExamPrepSheet,
  type LessonItem,
  type NamedItem,
  type SchoolLevel,
  defaultDataFor,
  newLesson,
  newNamedItem,
  computeProgress,
} from "@/lib/examPrep";

type OverviewRow = {
  studentId: string;
  studentName: string;
  school: string;
  grade: string | null;
  level: SchoolLevel;
  examTitle: string;
  examRange: string;
  examDate: string | null;
  teacher: string;
  progress: number;
  weakPoints: string;
  updatedAt: string | null;
  latestExam: { date: string; score: number | null; subject: string | null; examName: string } | null;
};

type ExamScore = { date: string | null; examName: string; subject: string | null; score: number | null };

function ProgressBar({ value }: { value: number }) {
  const color = value >= 80 ? "#22c55e" : value >= 40 ? "#f59e0b" : "#e5484d";
  return (
    <div style={{ background: "var(--border)", borderRadius: 6, height: 8, overflow: "hidden", minWidth: 70 }}>
      <div style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color, height: "100%" }} />
    </div>
  );
}

// 자주틀리는문제/기출문제/워크북 단계/기출모의고사/학교프린트/단어암기범위 등,
// "이름 + 완료여부 + (선택)부가정보 + 메모" 형태를 공유하는 모든 리스트에서
// 재사용하는 편집기.
function NamedItemList({
  items,
  onChange,
  addLabel,
  detailPlaceholder,
}: {
  items: NamedItem[];
  onChange: (items: NamedItem[]) => void;
  addLabel: string;
  detailPlaceholder?: string;
}) {
  function update(i: number, patch: Partial<NamedItem>) {
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  const doneCount = items.filter((i) => i.done).length;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {items.length > 0 ? `${doneCount}/${items.length} 완료` : "등록된 항목이 없습니다."}
        </span>
        <button
          type="button"
          className="secondary"
          onClick={() => onChange([...items, newNamedItem()])}
          style={{ padding: "4px 10px", fontSize: 12 }}
        >
          + {addLabel}
        </button>
      </div>
      {items.map((item, i) => (
        <div key={item.id} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
          <input type="checkbox" checked={item.done} onChange={(e) => update(i, { done: e.target.checked })} />
          <input
            type="text"
            placeholder="항목명"
            value={item.label}
            onChange={(e) => update(i, { label: e.target.value })}
            style={{ flex: "1 1 130px" }}
          />
          {detailPlaceholder !== undefined && (
            <input
              type="text"
              placeholder={detailPlaceholder}
              value={item.detail}
              onChange={(e) => update(i, { detail: e.target.value })}
              style={{ flex: "1 1 130px" }}
            />
          )}
          <input
            type="text"
            placeholder="메모"
            value={item.memo}
            onChange={(e) => update(i, { memo: e.target.value })}
            style={{ flex: "1 1 110px" }}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => remove(i)}
            style={{ padding: "4px 8px", fontSize: 12 }}
          >
            삭제
          </button>
        </div>
      ))}
    </div>
  );
}

function LessonList({ lessons, onChange }: { lessons: LessonItem[]; onChange: (l: LessonItem[]) => void }) {
  function update(i: number, patch: Partial<LessonItem>) {
    onChange(lessons.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function remove(i: number) {
    onChange(lessons.filter((_, idx) => idx !== i));
  }
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {lessons.length > 0 ? `Lesson ${lessons.length}개` : "등록된 Lesson이 없습니다."}
        </span>
        <button
          type="button"
          className="secondary"
          onClick={() => onChange([...lessons, newLesson()])}
          style={{ padding: "4px 10px", fontSize: 12 }}
        >
          + Lesson 추가
        </button>
      </div>
      {lessons.map((l, i) => (
        <div key={l.id} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Lesson명 (예: 1과)"
            value={l.name}
            onChange={(e) => update(i, { name: e.target.value })}
            style={{ flex: "1 1 100px" }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={l.bodyMemorized}
              onChange={(e) => update(i, { bodyMemorized: e.target.checked })}
            />
            본문암기
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={l.dialogueMemorized}
              onChange={(e) => update(i, { dialogueMemorized: e.target.checked })}
            />
            대화문암기
          </label>
          <select
            value={l.achievement}
            onChange={(e) => update(i, { achievement: e.target.value })}
            style={{ flex: "0 0 90px" }}
          >
            <option value="">성취도</option>
            <option value="상">상</option>
            <option value="중">중</option>
            <option value="하">하</option>
          </select>
          <input
            type="text"
            placeholder="진도사항 메모"
            value={l.progress}
            onChange={(e) => update(i, { progress: e.target.value })}
            style={{ flex: "2 1 160px" }}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => remove(i)}
            style={{ padding: "4px 8px", fontSize: 12 }}
          >
            삭제
          </button>
        </div>
      ))}
    </div>
  );
}

function ScoreEntryForm({ studentId, onSaved }: { studentId: string; onSaved: () => void }) {
  const [examName, setExamName] = useState("");
  const [subject, setSubject] = useState("영어");
  const [score, setScore] = useState("");
  const [date, setDate] = useState(todayKST());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    setError(null);
    const n = Number(score);
    if (!examName.trim() || score === "" || Number.isNaN(n)) {
      setError("시험명과 점수를 입력해주세요.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/exam-prep/${studentId}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examName, subject, score: n, date }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setExamName("");
      setScore("");
      onSaved();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
      <input
        type="text"
        placeholder="시험명 (예: 2학기 중간고사)"
        value={examName}
        onChange={(e) => setExamName(e.target.value)}
        style={{ flex: "1 1 160px" }}
      />
      <input
        type="text"
        placeholder="과목"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        style={{ flex: "0 1 80px" }}
      />
      <input
        type="number"
        placeholder="점수"
        value={score}
        onChange={(e) => setScore(e.target.value)}
        style={{ flex: "0 1 80px" }}
      />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: "0 1 150px" }} />
      <button type="button" disabled={saving} onClick={handleAdd} style={{ padding: "8px 14px" }}>
        {saving ? "저장 중..." : "시험결과 저장"}
      </button>
      {error && <p className="error-text" style={{ margin: 0, flexBasis: "100%" }}>{error}</p>}
    </div>
  );
}

function ExamPrepEditor({
  studentId,
  onSaved,
}: {
  studentId: string;
  onSaved: () => void;
}) {
  const [sheet, setSheet] = useState<ExamPrepSheet | null>(null);
  const [scores, setScores] = useState<ExamScore[]>([]);
  const [loading, setLoading] = useState(true);

  const [level, setLevel] = useState<SchoolLevel>("중등");
  const [examTitle, setExamTitle] = useState("");
  const [examRange, setExamRange] = useState("");
  const [examDate, setExamDate] = useState("");
  const [teacher, setTeacher] = useState("");
  const [weakPoints, setWeakPoints] = useState("");
  const [data, setData] = useState<ExamPrepData>(defaultDataFor("중등"));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setLoading(true);
    setSavedFlash(false);
    Promise.all([
      fetch(`/api/exam-prep/${studentId}`).then((r) => r.json()),
      fetch(`/api/students/${studentId}`).then((r) => r.json()),
    ])
      .then(([sheetData, studentData]: [ExamPrepSheet, { examScores: ExamScore[] }]) => {
        setSheet(sheetData);
        setLevel(sheetData.level);
        setExamTitle(sheetData.examTitle);
        setExamRange(sheetData.examRange);
        setExamDate(sheetData.examDate ?? "");
        setTeacher(sheetData.teacher);
        setWeakPoints(sheetData.weakPoints);
        setData(sheetData.data);
        setScores(studentData.examScores ?? []);
      })
      .finally(() => setLoading(false));
  }, [studentId]);

  function switchLevel(next: SchoolLevel) {
    if (next === level) return;
    if (data.level !== "중등" && data.level !== "고등") return;
    const hasContent = data.level === "중등" ? data.middle.lessons.length > 0 : data.high.mockExams.length > 0;
    if (hasContent && !window.confirm("학교급을 변경하면 입력해둔 세부 항목이 초기화됩니다. 계속할까요?")) return;
    setLevel(next);
    setData(defaultDataFor(next));
  }

  function reloadScores() {
    fetch(`/api/students/${studentId}`)
      .then((r) => r.json())
      .then((d) => setScores(d.examScores ?? []));
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/exam-prep/${studentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sheet?.id ?? null,
          level,
          examTitle,
          examRange,
          examDate: examDate || null,
          teacher,
          weakPoints,
          data,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "저장에 실패했습니다.");
        return;
      }
      const result = await res.json();
      setSheet((prev) => (prev ? { ...prev, id: result.id, progress: result.progress } : prev));
      setSavedFlash(true);
      onSaved();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const liveProgress = useMemo(() => computeProgress(data), [data]);

  if (loading) return <p className="muted">불러오는 중...</p>;
  if (!sheet) return null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div>
          <strong>{sheet.studentName}</strong>{" "}
          <span className="muted">
            {sheet.school} · {sheet.grade}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12 }}>학교급</span>
          <select value={level} onChange={(e) => switchLevel(e.target.value as SchoolLevel)} style={{ padding: "4px 8px" }}>
            <option value="중등">중등</option>
            <option value="고등">고등</option>
          </select>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
        <ProgressBar value={liveProgress} />
        <span className="badge">진행률 {liveProgress}%</span>
        {sheet.updatedAt && <span className="muted" style={{ fontSize: 12 }}>최근 저장: {sheet.updatedAt}</span>}
      </div>

      <div className="field-row">
        <div>
          <label>시험명</label>
          <input type="text" placeholder="예: 2026 2학기 중간고사" value={examTitle} onChange={(e) => setExamTitle(e.target.value)} />
        </div>
        <div>
          <label>시험일</label>
          <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div>
          <label>시험범위</label>
          <input type="text" placeholder="예: 1~3과, 모의고사 18-24" value={examRange} onChange={(e) => setExamRange(e.target.value)} />
        </div>
        <div>
          <label>담당교사</label>
          <input type="text" value={teacher} onChange={(e) => setTeacher(e.target.value)} />
        </div>
      </div>

      <label>취약부분 (원장/교사 메모)</label>
      <textarea
        placeholder="학생이 특히 약한 부분을 적어두면 현황판에서 바로 확인할 수 있습니다."
        value={weakPoints}
        onChange={(e) => setWeakPoints(e.target.value)}
        style={{ minHeight: 50 }}
      />

      <hr style={{ margin: "14px 0", border: "none", borderTop: "1px solid var(--border)" }} />

      {level === "중등" && data.level === "중등" && (
        <>
          <div className="field-row">
            <div>
              <label>교과서</label>
              <input
                type="text"
                value={data.middle.textbook}
                onChange={(e) => setData({ level: "중등", middle: { ...data.middle, textbook: e.target.value } })}
              />
            </div>
            <div>
              <label>부교재</label>
              <input
                type="text"
                value={data.middle.supplementary}
                onChange={(e) => setData({ level: "중등", middle: { ...data.middle, supplementary: e.target.value } })}
              />
            </div>
          </div>
          <label>학교 프린트</label>
          <input
            type="text"
            value={data.middle.schoolPrint}
            onChange={(e) => setData({ level: "중등", middle: { ...data.middle, schoolPrint: e.target.value } })}
          />

          <p style={{ marginTop: 16, marginBottom: 4, fontWeight: 600 }}>Lesson별 암기여부 · 진도 · 성취도</p>
          <LessonList
            lessons={data.middle.lessons}
            onChange={(lessons) => setData({ level: "중등", middle: { ...data.middle, lessons } })}
          />

          <p style={{ marginTop: 8, marginBottom: 4, fontWeight: 600 }}>
            자주 틀리는 문제 · 기출문제 · 추가문제 · 백발백중 · 적중백
          </p>
          <NamedItemList
            items={data.middle.practiceItems}
            onChange={(practiceItems) => setData({ level: "중등", middle: { ...data.middle, practiceItems } })}
            addLabel="항목 추가"
          />
        </>
      )}

      {level === "고등" && data.level === "고등" && (
        <>
          <div className="field-row">
            <div>
              <label>교과서</label>
              <input
                type="text"
                value={data.high.textbook}
                onChange={(e) => setData({ level: "고등", high: { ...data.high, textbook: e.target.value } })}
              />
            </div>
            <div>
              <label>부교재</label>
              <input
                type="text"
                value={data.high.supplementary}
                onChange={(e) => setData({ level: "고등", high: { ...data.high, supplementary: e.target.value } })}
              />
            </div>
          </div>

          <label>본문분석 및 진도</label>
          <textarea
            value={data.high.textAnalysisProgress}
            onChange={(e) => setData({ level: "고등", high: { ...data.high, textAnalysisProgress: e.target.value } })}
            style={{ minHeight: 50 }}
          />

          <p style={{ marginTop: 16, marginBottom: 4, fontWeight: 600 }}>기출모의고사 (범위 문항)</p>
          <NamedItemList
            items={data.high.mockExams}
            onChange={(mockExams) => setData({ level: "고등", high: { ...data.high, mockExams } })}
            addLabel="모의고사 추가"
            detailPlaceholder="문항범위 (예: 18-24)"
          />

          <p style={{ marginBottom: 4, fontWeight: 600 }}>기출모의고사2</p>
          <NamedItemList
            items={data.high.mockExams2}
            onChange={(mockExams2) => setData({ level: "고등", high: { ...data.high, mockExams2 } })}
            addLabel="모의고사 추가"
            detailPlaceholder="문항범위 (예: 29-32)"
          />

          <p style={{ marginBottom: 4, fontWeight: 600 }}>학교 프린트 (출처)</p>
          <NamedItemList
            items={data.high.schoolPrints}
            onChange={(schoolPrints) => setData({ level: "고등", high: { ...data.high, schoolPrints } })}
            addLabel="프린트 추가"
            detailPlaceholder="출처"
          />

          <p style={{ marginBottom: 4, fontWeight: 600 }}>해당범위 단어암기</p>
          <NamedItemList
            items={data.high.vocabItems}
            onChange={(vocabItems) => setData({ level: "고등", high: { ...data.high, vocabItems } })}
            addLabel="범위 추가"
            detailPlaceholder="범위 (예: Lesson 1-3)"
          />

          <p style={{ marginBottom: 4, fontWeight: 600 }}>
            워크북 (영어빈칸 · 동사형 · 어법 · 순서배열 · 영작 · 주제문 · 제목 · 요약문)
          </p>
          <NamedItemList
            items={data.high.workbook}
            onChange={(workbook) => setData({ level: "고등", high: { ...data.high, workbook } })}
            addLabel="단계 추가"
          />

          <p style={{ marginBottom: 4, fontWeight: 600 }}>변형문제</p>
          <NamedItemList
            items={data.high.transformedProblems}
            onChange={(transformedProblems) => setData({ level: "고등", high: { ...data.high, transformedProblems } })}
            addLabel="항목 추가"
          />
        </>
      )}

      {error && <p className="error-text">{error}</p>}
      {savedFlash && !error && <p className="success-box" style={{ marginTop: 8 }}>저장되었습니다.</p>}

      <div style={{ marginTop: 12 }}>
        <button type="button" disabled={saving} onClick={handleSave}>
          {saving ? "저장 중..." : "시험대비 시트 저장"}
        </button>
      </div>

      <hr style={{ margin: "18px 0", border: "none", borderTop: "1px solid var(--border)" }} />

      <p style={{ marginBottom: 4, fontWeight: 600 }}>시험결과 입력</p>
      <ScoreEntryForm studentId={studentId} onSaved={reloadScores} />
      {scores.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {scores
            .slice()
            .reverse()
            .slice(0, 5)
            .map((s, i) => (
              <div key={i} className="muted" style={{ fontSize: 13 }}>
                {s.date} · {s.examName} {s.subject ? `(${s.subject})` : ""} — {s.score ?? "-"}점
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export default function ExamPrepClient() {
  const [overview, setOverview] = useState<OverviewRow[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [studentId, setStudentId] = useState("");
  const [levelFilter, setLevelFilter] = useState<"" | SchoolLevel>("");
  const [query, setQuery] = useState("");

  function reloadOverview() {
    fetch("/api/exam-prep")
      .then((r) => r.json())
      .then(setOverview)
      .finally(() => setLoadingOverview(false));
  }

  useEffect(() => {
    reloadOverview();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return overview
      .filter((r) => (levelFilter ? r.level === levelFilter : true))
      .filter((r) => (q ? r.studentName.toLowerCase().includes(q) : true))
      .sort((a, b) => a.progress - b.progress);
  }, [overview, levelFilter, query]);

  return (
    <div className="page">
      <div className="card">
        <h2>학생별 시험대비</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          학생을 검색해 시험대비 시트를 작성/저장하세요. 아래 현황판에서 진행률이 낮은 순으로 취약 학생을 바로 확인할 수 있습니다.
        </p>
        <StudentPicker studentId={studentId} onChange={setStudentId} label="학생 검색" />
      </div>

      {studentId && (
        <div className="card">
          <ExamPrepEditor key={studentId} studentId={studentId} onSaved={reloadOverview} />
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>현황판 · 진도표</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="이름으로 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: "1 1 160px" }}
            />
            <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as "" | SchoolLevel)}>
              <option value="">전체</option>
              <option value="중등">중등</option>
              <option value="고등">고등</option>
            </select>
          </div>
        </div>

        {loadingOverview && <p className="muted">불러오는 중...</p>}
        {!loadingOverview && filtered.length === 0 && (
          <p className="muted">등록된 시험대비 시트가 없습니다. 위에서 학생을 선택해 작성해보세요.</p>
        )}
        {!loadingOverview && filtered.length > 0 && (
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table className="sortable-table">
              <thead>
                <tr>
                  <th>학생</th>
                  <th>학교급</th>
                  <th>시험명 / 범위</th>
                  <th>진행률</th>
                  <th>최근 시험성적</th>
                  <th>취약부분</th>
                  <th>갱신일</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.studentId} onClick={() => setStudentId(r.studentId)}>
                    <td>
                      <strong>{r.studentName}</strong>
                      <div className="muted">{r.school} {r.grade}</div>
                    </td>
                    <td>
                      <span className="badge">{r.level}</span>
                    </td>
                    <td>
                      {r.examTitle || "-"}
                      {r.examRange && <div className="muted" style={{ fontSize: 12 }}>{r.examRange}</div>}
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <ProgressBar value={r.progress} />
                        <span style={{ fontSize: 12 }}>{r.progress}%</span>
                      </div>
                    </td>
                    <td>
                      {r.latestExam
                        ? `${r.latestExam.subject ?? ""} ${r.latestExam.score ?? "-"}점 (${r.latestExam.date})`
                        : "-"}
                    </td>
                    <td style={{ maxWidth: 200 }}>{r.weakPoints || "-"}</td>
                    <td>{r.updatedAt ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
