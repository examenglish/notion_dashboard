"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import StudentPicker from "./StudentPicker";
import TeacherMultiSelect from "./TeacherMultiSelect";
import { todayKST } from "@/lib/date";
import {
  type CategoryBreakdown,
  type ExamPrepData,
  type ExamPrepSheet,
  type ExamPrepTemplate,
  type MiddleData,
  type NamedItem,
  type PracticeCategory,
  type SchoolLevel,
  type TextSource,
  type TextCategory,
  type HighData,
  TEXT_CATEGORIES,
  MIDDLE_TEXT_CATEGORIES,
  MIDDLE_PRACTICE_CATEGORIES,
  defaultDataFor,
  newNamedItem,
  newTextSource,
  newMiddleTextSource,
  parseNumberRange,
  computeProgress,
  computeCategoryBreakdown,
} from "@/lib/examPrep";

// 같은 학교/학년 템플릿에서 가져온 교과서·부교재 이름을, 그 카테고리가
// 아직 하나도 없을 때만 새 TextSource로 추가한다 — 이미 있는 텍스트의
// 워크북/단어암기 진행 상황을 덮어쓰지 않기 위해 "없으면 추가"만 한다.
// 고등(newTextSource)/중등(newMiddleTextSource) 둘 다 이 배열 기반
// 구조를 공유하므로 factory만 바꿔 재사용한다.
function addAutoTextSources(
  sources: TextSource[],
  tpl: { textbook: string; supplementary: string },
  makeSource: (category: TextCategory, label: string) => TextSource
): TextSource[] {
  let next = sources;
  if (tpl.textbook && !next.some((t) => t.category === "교과서")) {
    next = [...next, makeSource("교과서", tpl.textbook)];
  }
  if (tpl.supplementary && !next.some((t) => t.category === "부교재")) {
    next = [...next, makeSource("부교재", tpl.supplementary)];
  }
  return next;
}

export type OverviewRow = {
  studentId: string;
  studentName: string;
  school: string;
  grade: string | null;
  level: SchoolLevel;
  examTitle: string;
  examRange: string;
  examDate: string | null;
  teachers: string[];
  progress: number;
  weakPoints: string;
  updatedAt: string | null;
  latestExam: { date: string; score: number | null; subject: string | null; examName: string } | null;
  categories: CategoryBreakdown[];
};

type ExamScore = { date: string | null; examName: string; subject: string | null; score: number | null };

function categoryColor(done: number, total: number): string {
  if (total === 0) return "#94a3b8";
  const ratio = done / total;
  if (ratio >= 0.8) return "#22c55e";
  if (ratio >= 0.4) return "#f59e0b";
  return "#e5484d";
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div style={{ background: "var(--border)", borderRadius: 6, height: 8, overflow: "hidden", minWidth: 70 }}>
      <div
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          background: categoryColor(value, 100),
          height: "100%",
        }}
      />
    </div>
  );
}

// 진행률 하나만으로는 어느 영역이 약한지 안 보여서, Lesson암기/연습문제 또는
// 기출모의고사/워크북 등 그룹별 완료 개수를 색상 배지로 따로 노출한다.
export function CategoryChips({ categories }: { categories: CategoryBreakdown[] }) {
  if (categories.length === 0) return <span className="muted" style={{ fontSize: 12 }}>-</span>;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {categories.map((c) => (
        <span
          key={c.label}
          className="badge"
          style={{ background: categoryColor(c.done, c.total), color: "#fff", fontSize: 11 }}
        >
          {c.label} {c.done}/{c.total}
        </span>
      ))}
    </div>
  );
}

// 자주틀리는문제/기출문제/워크북 단계/기출모의고사/학교프린트/단어암기범위 등,
// "이름 + 완료여부 + (선택)부가정보 + 메모" 형태를 공유하는 모든 리스트에서
// 재사용하는 편집기. labelDatalist를 주면 항목명 입력에 자동완성 후보를 단다
// (동일 학교/학년에서 이미 쓰인 이름으로 표기를 통일하기 위함).
function NamedItemList({
  items,
  onChange,
  addLabel,
  detailPlaceholder,
  labelDatalist,
}: {
  items: NamedItem[];
  onChange: (items: NamedItem[]) => void;
  addLabel: string;
  detailPlaceholder?: string;
  labelDatalist?: { id: string; options: string[] };
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
      {labelDatalist && (
        <datalist id={labelDatalist.id}>
          {labelDatalist.options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
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
            list={labelDatalist?.id}
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

// 텍스트(교과서/부교재/모의고사/학교프린트) 하나가 반드시 거쳐야 하는
// 워크북 9단계 — 라벨은 고정이라(WORKBOOK_STEP_LABELS) 이름 편집 없이
// 체크박스만 토글하는 컴팩트한 칩 형태로 보여준다.
function WorkbookSteps({ steps, onChange }: { steps: NamedItem[]; onChange: (steps: NamedItem[]) => void }) {
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = steps.length > 0 && doneCount === steps.length;
  return (
    <div>
      <span className="muted" style={{ fontSize: 11 }}>
        워크북 {doneCount}/{steps.length}
      </span>
      <button
        type="button"
        className="secondary"
        onClick={() => onChange(steps.map((s) => ({ ...s, done: !allDone })))}
        title="대부분 끝났으면 전체를 누른 뒤 안 한 것만 다시 체크 해제하면 더 빠릅니다"
        style={{ marginLeft: 6, padding: "1px 8px", fontSize: 11 }}
      >
        {allDone ? "전체 해제" : "전체"}
      </button>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
        {steps.map((s, i) => (
          <label
            key={s.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              fontSize: 12,
              border: "1px solid var(--border)",
              borderRadius: 999,
              padding: "2px 8px",
              background: s.done ? "var(--success-tint)" : "#fff",
              color: s.done ? "var(--success)" : "var(--text)",
            }}
          >
            <input
              type="checkbox"
              checked={s.done}
              onChange={() => onChange(steps.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it)))}
              style={{ margin: 0 }}
            />
            {s.label}
          </label>
        ))}
      </div>
    </div>
  );
}

// 텍스트 하나(교과서 1권, 모의고사 1회차 등) — 이름/범위와 워크북 9단계,
// 그 범위의 단어암기 체크리스트를 함께 관리한다.
function TextSourceEditor({
  source,
  onChange,
  onRemove,
  labelDatalistId,
  middleFields,
  onBroadcast,
}: {
  source: TextSource;
  onChange: (next: TextSource) => void;
  onRemove: () => void;
  labelDatalistId?: string;
  // 중등 교과서/부교재의 과(Lesson) 전용 — 본문암기/대화문암기/성취도를
  // 추가로 보여준다(고등에서는 안 씀).
  middleFields?: boolean;
  // 같은 학교·학년의 다른 학생 중 이 단원을 이미 가진 학생들에게, 지금
  // 워크북 체크 상태를 한 번 복사한다(상시 동기화 아님 — 학생마다 실제
  // 진도가 다르므로).
  onBroadcast?: () => void;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginTop: 8 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder={middleFields ? "과 이름 (예: 1과)" : "텍스트 이름"}
          value={source.label}
          onChange={(e) => onChange({ ...source, label: e.target.value })}
          list={labelDatalistId}
          style={{ flex: "1 1 140px" }}
        />
        <input
          type="text"
          placeholder={middleFields ? "교재명 · 범위" : "범위 · 출처"}
          value={source.detail}
          onChange={(e) => onChange({ ...source, detail: e.target.value })}
          style={{ flex: "1 1 120px" }}
        />
        {onBroadcast && (
          <button
            type="button"
            className="secondary"
            onClick={onBroadcast}
            disabled={!source.label.trim()}
            title="같은 학교·학년에서 이 단원을 이미 가진, 내가 담당교사로 등록된 다른 학생들에게만 지금 체크 상태를 한 번 적용합니다"
            style={{ padding: "4px 8px", fontSize: 12 }}
          >
            전체 적용
          </button>
        )}
        <button type="button" className="secondary" onClick={onRemove} style={{ padding: "4px 8px", fontSize: 12 }}>
          삭제
        </button>
      </div>

      {middleFields && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={!!source.bodyMemorized}
              onChange={(e) => onChange({ ...source, bodyMemorized: e.target.checked })}
            />
            본문암기
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={!!source.dialogueMemorized}
              onChange={(e) => onChange({ ...source, dialogueMemorized: e.target.checked })}
            />
            대화문암기
          </label>
          <select
            value={source.achievement ?? ""}
            onChange={(e) => onChange({ ...source, achievement: e.target.value })}
            style={{ flex: "0 0 90px" }}
          >
            <option value="">성취도</option>
            <option value="상">상</option>
            <option value="중">중</option>
            <option value="하">하</option>
          </select>
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <WorkbookSteps steps={source.steps} onChange={(steps) => onChange({ ...source, steps })} />
      </div>

      <div style={{ marginTop: 8 }}>
        <span className="muted" style={{ fontSize: 11 }}>
          단어암기
        </span>
        <NamedItemList
          items={source.vocab}
          onChange={(vocab) => onChange({ ...source, vocab })}
          addLabel="범위 추가"
          detailPlaceholder="범위 (예: 1-20)"
        />
      </div>

      <input
        type="text"
        placeholder="메모"
        value={source.memo}
        onChange={(e) => onChange({ ...source, memo: e.target.value })}
        style={{ marginTop: 6, width: "100%" }}
      />
    </div>
  );
}

// 카테고리(교과서/부교재/모의고사/학교프린트) 하나에 속한 텍스트 여러 건을
// 묶어 보여주고, 새 텍스트를 추가할 수 있게 한다.
function TextSourceGroup({
  category,
  sources,
  onChange,
  labelDatalistId,
  middleFields,
  onBroadcastSource,
}: {
  category: TextCategory;
  sources: TextSource[];
  onChange: (sources: TextSource[]) => void;
  labelDatalistId?: string;
  middleFields?: boolean;
  onBroadcastSource?: (source: TextSource) => void;
}) {
  function update(id: string, next: TextSource) {
    onChange(sources.map((s) => (s.id === id ? next : s)));
  }
  function remove(id: string) {
    onChange(sources.filter((s) => s.id !== id));
  }
  const addLabel = middleFields ? "과 추가" : `${category} 추가`;

  // 모의고사 독해는 "18-45" 범위로만 나올 때가 있어, 번호 하나하나(21번,
  // 22번 ...)를 워크북 진도가 독립적인 항목으로 한 번에 만들어준다.
  const [rangeName, setRangeName] = useState("");
  const [rangeText, setRangeText] = useState("");
  function addRange() {
    const labels = parseNumberRange(rangeText);
    if (labels.length === 0) return;
    const existing = new Set(sources.map((s) => s.label));
    const toAdd = labels.filter((l) => !existing.has(l));
    if (toAdd.length === 0) {
      window.alert("이미 모두 등록된 번호입니다.");
      return;
    }
    const factory = middleFields ? newMiddleTextSource : newTextSource;
    const added = toAdd.map((label) => ({ ...factory(category, label), detail: rangeName }));
    onChange([...sources, ...added]);
    setRangeText("");
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ margin: 0, fontWeight: 600 }}>{category}</p>
        <button
          type="button"
          className="secondary"
          onClick={() => onChange([...sources, middleFields ? newMiddleTextSource(category) : newTextSource(category)])}
          style={{ padding: "4px 10px", fontSize: 12 }}
        >
          + {addLabel}
        </button>
      </div>
      {category === "모의고사" && (
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="text"
            placeholder="회차명 (예: 2025년 6월 모의고사)"
            value={rangeName}
            onChange={(e) => setRangeName(e.target.value)}
            style={{ flex: "1 1 160px" }}
          />
          <input
            type="text"
            placeholder="번호 범위 (예: 18-45 또는 21, 24, 33-36)"
            value={rangeText}
            onChange={(e) => setRangeText(e.target.value)}
            style={{ flex: "1 1 200px" }}
          />
          <button type="button" className="secondary" onClick={addRange} style={{ padding: "4px 10px", fontSize: 12 }}>
            번호 범위로 추가
          </button>
        </div>
      )}
      {sources.length === 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          등록된 {category}가 없습니다.
        </p>
      )}
      {sources.map((s) => (
        <TextSourceEditor
          key={s.id}
          source={s}
          onChange={(next) => update(s.id, next)}
          onRemove={() => remove(s.id)}
          labelDatalistId={labelDatalistId}
          middleFields={middleFields}
          onBroadcast={onBroadcastSource ? () => onBroadcastSource(s) : undefined}
        />
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

// 원장 대시보드(/director/exam-prep)의 새 디자인 브라우징 UI에서도 그대로
// 재사용한다 — 과목별 세부 입력폼이 크고 복잡해서 다시 만들지 않고, 감싸는
// 카드만 새 디자인으로 바꾸고 내부 폼은 그대로 가져다 쓴다.
export function ExamPrepEditor({
  studentId,
  onSaved,
}: {
  studentId: string;
  onSaved: () => void;
}) {
  const [sheet, setSheet] = useState<ExamPrepSheet | null>(null);
  const [scores, setScores] = useState<ExamScore[]>([]);
  const [template, setTemplate] = useState<ExamPrepTemplate>(null);
  const [loading, setLoading] = useState(true);

  const [level, setLevel] = useState<SchoolLevel>("중등");
  const [examTitle, setExamTitle] = useState("");
  const [examRange, setExamRange] = useState("");
  const [examDate, setExamDate] = useState("");
  const [teachers, setTeachers] = useState<string[]>([]);
  const [weakPoints, setWeakPoints] = useState("");
  const [data, setData] = useState<ExamPrepData>(defaultDataFor("중등"));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // 사용자가 항목을 조금만 고쳐도(체크박스 하나라도) 자동으로 저장되도록,
  // 데이터 로딩으로 인한 state 변경은 건너뛰고 실제 편집만 디바운스 저장한다.
  const skipAutosaveRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    skipAutosaveRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
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
        setTeachers(sheetData.teachers);
        setWeakPoints(sheetData.weakPoints);
        setData(sheetData.data);
        setScores(studentData.examScores ?? []);

        if (!sheetData.school || !sheetData.grade) {
          setTemplate(null);
          return;
        }
        const params = new URLSearchParams({
          school: sheetData.school,
          grade: sheetData.grade,
          excludeStudentId: studentId,
        });
        fetch(`/api/exam-prep/template?${params}`)
          .then((r) => r.json())
          .then((tpl: ExamPrepTemplate) => {
            setTemplate(tpl);
            // 새 시트(id 없음)라면 같은 학교/학년에서 이미 쓰던 값으로
            // 빈 칸을 자동으로 채워 표기를 통일한다.
            if (!sheetData.id && tpl) {
              skipAutosaveRef.current = true;
              if (!sheetData.examTitle) setExamTitle(tpl.latest.examTitle);
              if (sheetData.teachers.length === 0) setTeachers(tpl.latest.teachers);
              setData((prev) => {
                if (prev.level === "중등") {
                  // 중등은 textbook 값이 "과 이름"들을 이어붙인 문자열이라
                  // (예: "1과, 2과") 고등처럼 새 텍스트 항목으로 자동 등록하면
                  // 뜻 모를 라벨이 생긴다 — 학교 프린트만 자동으로 채운다.
                  return {
                    level: "중등",
                    middle: { ...prev.middle, schoolPrint: prev.middle.schoolPrint || tpl.latest.schoolPrint },
                  };
                }
                return {
                  level: "고등",
                  high: { ...prev.high, textSources: addAutoTextSources(prev.high.textSources, tpl.latest, newTextSource) },
                };
              });
            }
          });
      })
      .finally(() => setLoading(false));
  }, [studentId]);

  function applyTemplate() {
    if (!template) return;
    setExamTitle(template.latest.examTitle);
    setTeachers(template.latest.teachers);
    setData((prev) => {
      if (prev.level === "중등") {
        return { level: "중등", middle: { ...prev.middle, schoolPrint: template.latest.schoolPrint } };
      }
      return {
        level: "고등",
        high: { ...prev.high, textSources: addAutoTextSources(prev.high.textSources, template.latest, newTextSource) },
      };
    });
  }

  // 상시 동기화가 아니라 "지금 이 순간" 한 번 — 같은 학교·학년에서 이
  // 단원을 이미 가진 다른 학생들에게 현재 워크북 체크 상태를 복사한다.
  // 이후엔 각자 시트에서 다시 자유롭게 개별 조정할 수 있다.
  async function handleBroadcastSteps(source: TextSource) {
    if (!sheet?.school || !sheet?.grade || !source.label.trim()) return;
    const ok = window.confirm(
      `${sheet.school} ${sheet.grade}에서 "${source.label}" 단원을 이미 가진, 내가 담당교사로 등록된 다른 학생들에게만 지금 워크북 체크 상태를 적용합니다. 계속할까요?`
    );
    if (!ok) return;
    try {
      const res = await fetch("/api/exam-prep/broadcast-steps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school: sheet.school,
          grade: sheet.grade,
          excludeStudentId: studentId,
          category: source.category,
          label: source.label,
          steps: source.steps.map((s) => ({ label: s.label, done: s.done })),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        window.alert(d.error ?? "적용에 실패했습니다.");
        return;
      }
      const { updated } = await res.json();
      window.alert(
        updated.length === 0
          ? "이 단원을 가진, 내가 담당교사로 등록된 다른 학생이 없습니다."
          : `${updated.map((u: { studentName: string }) => u.studentName).join(", ")} (${updated.length}명)에게 적용했습니다.`
      );
    } catch {
      window.alert("네트워크 오류가 발생했습니다.");
    }
  }

  function switchLevel(next: SchoolLevel) {
    if (next === level) return;
    if (data.level !== "중등" && data.level !== "고등") return;
    const hasContent = data.level === "중등" ? data.middle.textSources.length > 0 : data.high.textSources.length > 0;
    if (hasContent && !window.confirm("학교급을 변경하면 입력해둔 세부 항목이 초기화됩니다. 계속할까요?")) return;
    setLevel(next);
    setData(defaultDataFor(next));
  }

  function reloadScores() {
    fetch(`/api/students/${studentId}`)
      .then((r) => r.json())
      .then((d) => setScores(d.examScores ?? []));
  }

  async function handleSave(): Promise<boolean> {
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
          teachers,
          weakPoints,
          data,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "저장에 실패했습니다.");
        return false;
      }
      const result = await res.json();
      setSheet((prev) => (prev ? { ...prev, id: result.id, progress: result.progress } : prev));
      setSavedFlash(true);
      onSaved();
      return true;
    } catch {
      setError("네트워크 오류가 발생했습니다.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  // 체크박스 하나, 글자 하나만 고쳐도 잠시 후 자동으로 저장한다 — 로딩 중
  // 반영된 state 변경(skipAutosaveRef)은 건너뛰고, 실제 편집만 디바운스로 저장.
  useEffect(() => {
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      handleSave();
    }, 1200);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, examTitle, examRange, examDate, teachers, weakPoints, data]);

  const liveProgress = useMemo(() => computeProgress(data), [data]);
  const liveCategories = useMemo(() => computeCategoryBreakdown(data), [data]);

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

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0", flexWrap: "wrap" }}>
        <ProgressBar value={liveProgress} />
        <span className="badge">진행률 {liveProgress}%</span>
        <CategoryChips categories={liveCategories} />
        {sheet.updatedAt && <span className="muted" style={{ fontSize: 12 }}>최근 저장: {sheet.updatedAt}</span>}
      </div>

      {template && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 12px",
            marginBottom: 10,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span className="muted" style={{ fontSize: 12 }}>
            같은 학교·학년 학생들의 최근 입력값이 있습니다 — 시험대비명/교과서/부교재/학교프린트를 그대로 가져와
            표기를 통일할 수 있어요. (시험범위는 학교 단위로 자동 동기화되어 여기서 다루지 않습니다.)
          </span>
          <button type="button" className="secondary" onClick={applyTemplate} style={{ padding: "4px 10px", fontSize: 12 }}>
            동일 학교·학년 값 적용
          </button>
        </div>
      )}

      <datalist id="examTitleOptions">
        {(template?.examTitleOptions ?? []).map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <datalist id="textbookOptions">
        {(template?.textbookOptions ?? []).map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <datalist id="supplementaryOptions">
        {(template?.supplementaryOptions ?? []).map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <datalist id="schoolPrintOptions">
        {(template?.schoolPrintOptions ?? []).map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <datalist id="schoolPrintItemLabels">
        {(template?.schoolPrintItemLabels ?? []).map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>

      <div className="field-row">
        <div>
          <label>시험명</label>
          <input
            type="text"
            list="examTitleOptions"
            placeholder="예: 2026 2학기 중간고사"
            value={examTitle}
            onChange={(e) => setExamTitle(e.target.value)}
          />
        </div>
        <div>
          <label>시험일</label>
          <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div>
          <label>시험범위 (학교 단위로 관리 · 읽기 전용)</label>
          <input
            type="text"
            value={examRange || "학교별시험범위에 등록된 값이 없습니다"}
            readOnly
            title="이 값은 '학교 찾기'에서 학교+학년 단위로 관리됩니다. 여기서는 수정할 수 없어요."
            style={{ color: examRange ? undefined : "var(--muted-foreground, #94a3b8)" }}
          />
        </div>
        <div>
          <TeacherMultiSelect selected={teachers} onChange={setTeachers} />
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
          <p className="muted" style={{ fontSize: 12 }}>
            교과서·부교재는 과(Lesson)마다 워크북 9단계(영어빈칸 · 동사형 · 어법 · 순서배열 · 영작 · 주제문 · 제목 ·
            요약문 · 변형문제)와 단어암기, 본문암기·대화문암기·성취도를 관리합니다. 과를 여러 건 등록할 수 있어요.
          </p>

          {MIDDLE_TEXT_CATEGORIES.map((cat) => (
            <TextSourceGroup
              key={cat}
              category={cat}
              sources={data.middle.textSources.filter((t) => t.category === cat)}
              onChange={(catSources) => {
                const others = data.middle.textSources.filter((t) => t.category !== cat);
                setData({ level: "중등", middle: { ...data.middle, textSources: [...others, ...catSources] } });
              }}
              labelDatalistId={cat === "교과서" ? "textbookOptions" : "supplementaryOptions"}
              middleFields
              onBroadcastSource={handleBroadcastSteps}
            />
          ))}

          <label style={{ marginTop: 16 }}>학교 프린트</label>
          <input
            type="text"
            list="schoolPrintOptions"
            value={data.middle.schoolPrint}
            onChange={(e) => setData({ level: "중등", middle: { ...data.middle, schoolPrint: e.target.value } })}
          />

          <p style={{ marginTop: 16, marginBottom: 4, fontWeight: 600 }}>내신대비 문제풀이</p>
          {MIDDLE_PRACTICE_CATEGORIES.map((cat) => (
            <div key={cat} style={{ marginTop: 8 }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{cat}</p>
              <NamedItemList
                items={data.middle.practiceItems[cat]}
                onChange={(items) =>
                  setData({
                    level: "중등",
                    middle: { ...data.middle, practiceItems: { ...data.middle.practiceItems, [cat]: items } },
                  })
                }
                addLabel="항목 추가"
              />
            </div>
          ))}
        </>
      )}

      {level === "고등" && data.level === "고등" && (
        <>
          <label>본문분석 및 진도</label>
          <textarea
            value={data.high.textAnalysisProgress}
            onChange={(e) => setData({ level: "고등", high: { ...data.high, textAnalysisProgress: e.target.value } })}
            style={{ minHeight: 50 }}
          />

          <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
            교과서·부교재·모의고사·학교프린트로 다루는 텍스트마다 워크북 9단계(영어빈칸 · 동사형 · 어법 · 순서배열 ·
            영작 · 주제문 · 제목 · 요약문 · 변형문제)와 단어암기를 반드시 마쳐야 합니다. 텍스트를 여러 건 등록할 수
            있어요.
          </p>

          {TEXT_CATEGORIES.map((cat) => (
            <TextSourceGroup
              key={cat}
              category={cat}
              sources={data.high.textSources.filter((t) => t.category === cat)}
              onChange={(catSources) => {
                const others = data.high.textSources.filter((t) => t.category !== cat);
                setData({ level: "고등", high: { ...data.high, textSources: [...others, ...catSources] } });
              }}
              labelDatalistId={
                cat === "교과서" ? "textbookOptions" : cat === "부교재" ? "supplementaryOptions" : cat === "학교프린트" ? "schoolPrintItemLabels" : undefined
              }
              onBroadcastSource={handleBroadcastSteps}
            />
          ))}
        </>
      )}

      {error && <p className="error-text">{error}</p>}
      {savedFlash && !error && <p className="success-box" style={{ marginTop: 8 }}>저장되었습니다.</p>}

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" disabled={saving} onClick={handleSave}>
          {saving ? "저장 중..." : "지금 저장"}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>수정하면 잠시 후 자동으로 저장됩니다.</span>
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

type StudentBrief = { id: string; name: string; school: string; grade: string | null };

// GRADE_ORDER: raw grade strings sort lexicographically wrong ("고1" before
// "중2" is fine, but "중10"-style never happens — this just keeps 중 before
// 고 and ascending within each, matching how staff think about grade level).
const GRADE_ORDER = ["중1", "중2", "중3", "고1", "고2", "고3"];
function gradeSort(a: string, b: string) {
  const ia = GRADE_ORDER.indexOf(a);
  const ib = GRADE_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  return a.localeCompare(b, "ko");
}

function CascadeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="secondary"
      onClick={onClick}
      style={{
        textAlign: "left",
        fontSize: 12.5,
        padding: "5px 8px",
        fontWeight: active ? 700 : 400,
        background: active ? "var(--primary-tint)" : undefined,
        color: active ? "var(--primary-dark)" : undefined,
        borderColor: active ? "var(--primary)" : undefined,
      }}
    >
      {children}
    </button>
  );
}

export default function ExamPrepClient() {
  const [overview, setOverview] = useState<OverviewRow[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [studentId, setStudentId] = useState("");
  const [levelFilter, setLevelFilter] = useState<"" | SchoolLevel>("");
  const [query, setQuery] = useState("");
  const [allStudents, setAllStudents] = useState<StudentBrief[]>([]);
  const [selectedSchool, setSelectedSchool] = useState("");
  const [selectedGrade, setSelectedGrade] = useState("");

  function reloadOverview() {
    fetch("/api/exam-prep")
      .then((r) => r.json())
      .then(setOverview)
      .finally(() => setLoadingOverview(false));
  }

  useEffect(() => {
    reloadOverview();
    fetch("/api/students?q=")
      .then((r) => r.json())
      .then((list: StudentBrief[]) => setAllStudents(Array.isArray(list) ? list : []));
  }, []);

  // 학교 → 학년 → 학생 3단 캐스케이드로 좁혀갈 수 있게, 학생 명단에서 뽑아둔다.
  // 이름 검색(StudentPicker)만으로는 "이 학교 이 학년 중에서 고르고 싶다"는
  // 흐름이 안 돼서 추가했다 — 기존 이름검색은 그대로 남겨둔다.
  const schools = useMemo(() => {
    const set = new Set(allStudents.map((s) => s.school).filter(Boolean));
    return Array.from(set).sort();
  }, [allStudents]);

  const grades = useMemo(() => {
    if (!selectedSchool) return [];
    const set = new Set(
      allStudents.filter((s) => s.school === selectedSchool).map((s) => s.grade).filter((g): g is string => !!g)
    );
    return Array.from(set).sort(gradeSort);
  }, [allStudents, selectedSchool]);

  const gradeStudents = useMemo(() => {
    if (!selectedSchool || !selectedGrade) return [];
    return allStudents
      .filter((s) => s.school === selectedSchool && s.grade === selectedGrade)
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [allStudents, selectedSchool, selectedGrade]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return overview
      .filter((r) => (levelFilter ? r.level === levelFilter : true))
      .filter((r) => (q ? r.studentName.toLowerCase().includes(q) : true))
      .sort((a, b) => a.progress - b.progress);
  }, [overview, levelFilter, query]);

  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div className="card" style={{ width: 160, flexShrink: 0, padding: 14 }}>
          <h2 style={{ fontSize: 14, marginBottom: 2 }}>학생별 시험대비</h2>
          <p className="muted" style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>
            학교 → 학년 → 학생 순으로 눌러서 찾으세요.
          </p>
          <label style={{ fontSize: 11 }}>학교</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 360, overflowY: "auto" }}>
            {schools.map((s) => (
              <CascadeButton
                key={s}
                active={selectedSchool === s}
                onClick={() => {
                  setSelectedSchool(s);
                  setSelectedGrade("");
                  setStudentId("");
                }}
              >
                {s}
              </CascadeButton>
            ))}
          </div>
          <label style={{ fontSize: 11, marginTop: 12 }}>이름으로 검색</label>
          <StudentPicker studentId={studentId} onChange={setStudentId} label="" />
        </div>

        {selectedSchool && (
          <div className="card" style={{ width: 100, flexShrink: 0, padding: 14 }}>
            <h2 style={{ fontSize: 14, marginBottom: 8 }}>학년</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 360, overflowY: "auto" }}>
              {grades.length === 0 && <p className="muted" style={{ fontSize: 11 }}>학생 없음</p>}
              {grades.map((g) => (
                <CascadeButton
                  key={g}
                  active={selectedGrade === g}
                  onClick={() => {
                    setSelectedGrade(g);
                    setStudentId("");
                  }}
                >
                  {g}
                </CascadeButton>
              ))}
            </div>
          </div>
        )}

        {selectedGrade && (
          <div className="card" style={{ width: 180, flexShrink: 0, padding: 14 }}>
            <h2 style={{ fontSize: 14, marginBottom: 8 }}>
              {selectedSchool} {selectedGrade}
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 360, overflowY: "auto" }}>
              {gradeStudents.length === 0 && <p className="muted" style={{ fontSize: 11 }}>소속 학생이 없습니다.</p>}
              {gradeStudents.map((s) => (
                <CascadeButton key={s.id} active={studentId === s.id} onClick={() => setStudentId(s.id)}>
                  {s.name}
                </CascadeButton>
              ))}
            </div>
          </div>
        )}

        <div style={{ flex: "1 1 480px", minWidth: 0 }}>
          {studentId ? (
            <div className="card">
              <ExamPrepEditor key={studentId} studentId={studentId} onSaved={reloadOverview} />
            </div>
          ) : (
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
                <p className="muted">등록된 시험대비 시트가 없습니다. 왼쪽에서 학생을 선택해 작성해보세요.</p>
              )}
              {!loadingOverview && filtered.length > 0 && (
                <div className="table-scroll" style={{ marginTop: 12 }}>
                  <table className="sortable-table">
                    <thead>
                      <tr>
                        <th>학생</th>
                        <th>학교급</th>
                        <th>시험명 / 범위</th>
                        <th>담당교사</th>
                        <th>진행률</th>
                        <th>항목별 성취</th>
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
                          <td>{r.teachers.length > 0 ? r.teachers.join(", ") : "-"}</td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <ProgressBar value={r.progress} />
                              <span style={{ fontSize: 12 }}>{r.progress}%</span>
                            </div>
                          </td>
                          <td>
                            <CategoryChips categories={r.categories} />
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
          )}
        </div>
      </div>
    </div>
  );
}
