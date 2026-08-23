"use client";

import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import StudentPicker from "./StudentPicker";
import StaffPicker from "./StaffPicker";
import DailyBriefingPreviewModal from "./DailyBriefingPreviewModal";
import AssistantClinicForm from "./AssistantClinicForm";
import AttendanceCheckForm from "./AttendanceCheckForm";
import ClassAssistantAssignForm from "./ClassAssistantAssignForm";
import StaffScheduleForm from "./StaffScheduleForm";
import StaffRegisterForm from "./StaffRegisterForm";
import ClassManageForm from "./ClassManageForm";
import AssignClinicTaskForm from "./AssignClinicTaskForm";
import QuickScheduleForm from "./QuickScheduleForm";
import ClassRecordGapFinder from "./ClassRecordGapFinder";
import MakeupStatusCard from "./MakeupStatusCard";
import AbsenceReviewModal, { AbsenceReviewItem } from "./AbsenceReviewModal";
import { todayKST as todayStr } from "@/lib/date";
import { stripClassSuffix } from "@/lib/format";

type ClassOption = { id: string; name: string; type?: string };
type RosterStudent = { id: string; name: string };
// 그날 테스트/과제 채점 한 건 — "항목종류"(예: 단어테스트)와 정답수/총문항수.
// correct/total은 입력 중 빈 문자열을 허용해야 해서(다 채우기 전에는 숫자로
// 강제 변환하지 않음) 문자열로 들고 있다가 저장 시점에만 서버가 해석한다.
type ScoreEntry = { type: string; correct: string; total: string };
type PerStudentFlags = {
  vocabFail: boolean;
  homeworkIncomplete: boolean;
  absent: boolean;
  late: boolean;
  individualNotice: string;
  scores: ScoreEntry[];
};

function blankPerStudent(): PerStudentFlags {
  return { vocabFail: false, homeworkIncomplete: false, absent: false, late: false, individualNotice: "", scores: [] };
}

const SUBJECT_OPTIONS = ["문법", "독해", "서술형", "구문", "듣기", "모의고사", "어법", "내신대비"];
// 자주 쓰는 테스트/과제 항목 — 원클릭으로 컬럼 추가, 목록에 없는 항목은
// 옆의 직접입력으로 얼마든지 늘릴 수 있다("추가 항목이 있을 수도 있다").
const SCORE_TYPE_SUGGESTIONS = ["단어테스트", "문법테스트", "독해테스트", "서술형과제"];
const GRADE_OPTIONS = ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"];
const STATUS_OPTIONS = ["재원", "대기생", "휴원", "퇴원"];

function confirmSave() {
  return window.confirm("저장하시겠습니까?");
}

function ClassRecordForm({
  canEditExisting,
  initialClassId,
  initialDate,
}: {
  canEditExisting: boolean;
  initialClassId?: string;
  initialDate?: string;
}) {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState(initialClassId ?? "");
  const [date, setDate] = useState(initialDate ?? todayStr());
  const [period, setPeriod] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [progress, setProgress] = useState("");
  const [homework, setHomework] = useState("");
  const [nextAssignment, setNextAssignment] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewDays, setReviewDays] = useState("7");
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [extraStudents, setExtraStudents] = useState<RosterStudent[]>([]);
  const [extraPickerId, setExtraPickerId] = useState("");
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [perStudent, setPerStudent] = useState<Record<string, PerStudentFlags>>({});
  // 오늘 이 반에서 실제로 채점한 테스트/과제 종류(표의 열) — 학생마다
  // 따로 고르지 않고 한 번만 정하면 모든 학생 행에 같은 열로 뜬다.
  const [scoreTypes, setScoreTypes] = useState<string[]>([]);
  const [scoreTypeInput, setScoreTypeInput] = useState("");
  // 개별 안내사항은 내용이 있는 학생만 기본으로 펼쳐두고, 나머지는 이
  // Set에 담긴 학생만 눌러서 펼친다 — 매 학생마다 빈 메모칸을 항상
  // 띄우던 것이 스크롤을 가장 많이 잡아먹던 원인이었다.
  const [openNoticeIds, setOpenNoticeIds] = useState<Set<string>>(new Set());
  const [showPreview, setShowPreview] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [existingProgressId, setExistingProgressId] = useState<string | null>(null);
  const [savingScores, setSavingScores] = useState(false);
  const [scoresSaved, setScoresSaved] = useState(false);
  const [reviewItems, setReviewItems] = useState<AbsenceReviewItem[] | null>(null);
  const [includeExamClasses, setIncludeExamClasses] = useState(false);

  // 결석 체크 후 그 날짜(당일 포함)의 결석 검토 팝업을 바로 띄운다 — 담당교사가
  // 이미 지정된 건은 서버가 걸러서 내려주므로, 항목이 남아있으면 실제로
  // 처리(지각 정정/보강 취소/담당자 지정)가 필요한 경우다. 행정/원장이 아니면
  // 서버가 빈 목록을 내려줘 자연히 아무 일도 일어나지 않는다.
  function maybeOpenReview() {
    const hasAbsent = Object.values(perStudent).some((f) => f.absent);
    if (!hasAbsent) return;
    fetch(`/api/absence-review?date=${encodeURIComponent(date)}`)
      .then((r) => r.json())
      .then((data: { items: AbsenceReviewItem[] }) => {
        if (data.items?.length > 0) setReviewItems(data.items);
      });
  }

  useEffect(() => {
    fetch("/api/classes")
      .then((r) => r.json())
      .then((list: ClassOption[]) => {
        setClasses(list);
      });
  }, []);

  // 시험대비반은 기본적으로 목록에서 숨기되(체크박스로 펼쳐볼 수 있음), 이미
  // 골라둔 반이 시험대비반이면 체크를 나중에 꺼도 선택값이 안 사라지게 한다.
  const visibleClasses = classes.filter((c) => includeExamClasses || c.type !== "시험대비" || c.id === classId);

  useEffect(() => {
    if (!classId) return;
    setLoadingRoster(true);
    fetch(`/api/students?classId=${classId}`)
      .then((r) => r.json())
      .then((list: RosterStudent[]) => {
        setRoster(list);
        setExtraStudents([]); // switching class clears any manually-called-up guests
        setPerStudent(Object.fromEntries(list.map((s) => [s.id, blankPerStudent()])));
      })
      .finally(() => setLoadingRoster(false));
  }, [classId]);

  // If this class+date already has a saved 수업 기록, load it back in so
  // re-opening the same class/day edits the existing record instead of
  // silently creating a duplicate. Runs after the roster-reset effect above
  // (declared later => applied later), so it overwrites the blank flags.
  useEffect(() => {
    if (!classId || !date) {
      setExistingProgressId(null);
      return;
    }
    let cancelled = false;
    const periodQuery = period ? `&period=${encodeURIComponent(period)}` : "";
    Promise.all([
      fetch(`/api/class-record?classId=${classId}&date=${date}${periodQuery}`).then((r) => r.json()),
      fetch(`/api/students?classId=${classId}`).then((r) => r.json()),
    ]).then(([data, rosterList]: [{ existing: any; plannedAbsentIds: string[] }, RosterStudent[]]) => {
      if (cancelled) return;
      const rec = data?.existing;
      const plannedAbsentIds = data?.plannedAbsentIds ?? [];
      if (!rec) {
        setExistingProgressId(null);
        // 같은 반을 켜둔 채 날짜만 바꾼 경우, 이 분기(그 날짜엔 기존 기록이
        // 없음)는 롯스터가 바뀔 때만 도는 초기화 effect를 타지 않는다 —
        // 그대로 두면 이전 날짜에 입력했던 진도/과제 텍스트와 학생별
        // 결석·지각·단어미통과·과제미완료 체크가 새 날짜 입력에 섞여
        // 들어간다. 그래서 여기서 명시적으로 빈 상태로 리셋한다.
        setSubjects([]);
        setProgress("");
        setHomework("");
        setNextAssignment("");
        setNotice("");
        setExtraStudents([]);
        setPerStudent(Object.fromEntries(rosterList.map((s) => [s.id, blankPerStudent()])));
        setScoreTypes([]);
        setOpenNoticeIds(new Set());
        // 행정실에 "결석예정"으로 이미 접수된 학생은 결석 체크를 미리
        // 반영해 강사가 다시 체크하지 않게 한다.
        if (plannedAbsentIds.length > 0) {
          setPerStudent((cur) => {
            const next = { ...cur };
            for (const sid of plannedAbsentIds) {
              if (next[sid]) next[sid] = { ...next[sid], absent: true };
            }
            return next;
          });
        }
        return;
      }
      setExistingProgressId(rec.progressId);
      setSubjects(rec.subjects ?? []);
      setProgress(rec.progress ?? "");
      setHomework(rec.homework ?? "");
      setNextAssignment(rec.nextAssignment ?? "");
      setNotice(rec.notice ?? "");
      const rosterIds = new Set(rosterList.map((s) => s.id));
      const extraIds: string[] = (rec.studentIds ?? []).filter((id: string) => !rosterIds.has(id));
      setPerStudent((cur) => {
        const next = { ...cur };
        for (const sid of rec.studentIds ?? []) {
          const loaded = rec.perStudent[sid];
          next[sid] = loaded ? { ...blankPerStudent(), ...loaded, scores: loaded.scores ?? [] } : blankPerStudent();
        }
        return next;
      });
      // 이미 저장된 항목 종류를 그대로 열로 복원하고(등장 순서 유지),
      // 내용이 있는 개별 안내사항은 다시 열어서 보여준다.
      const loadedTypes: string[] = [];
      const seenTypes = new Set<string>();
      const toOpen = new Set<string>();
      for (const sid of rec.studentIds ?? []) {
        const loaded = rec.perStudent[sid];
        if (!loaded) continue;
        for (const sc of loaded.scores ?? []) {
          if (!seenTypes.has(sc.type)) {
            seenTypes.add(sc.type);
            loadedTypes.push(sc.type);
          }
        }
        if (loaded.individualNotice) toOpen.add(sid);
      }
      setScoreTypes(loadedTypes);
      setOpenNoticeIds(toOpen);
      if (extraIds.length > 0) {
        Promise.all(extraIds.map((id) => fetch(`/api/students/${id}`).then((r) => r.json()))).then((results) => {
          if (cancelled) return;
          setExtraStudents((cur) => {
            const have = new Set(cur.map((s) => s.id));
            const added = results
              .map((d: any) => ({ id: d.student.id, name: d.student.name }))
              .filter((s) => !have.has(s.id));
            return [...cur, ...added];
          });
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [classId, date, period]);

  const fullRoster = [...roster, ...extraStudents];

  function addExtraStudent(id: string) {
    if (!id || fullRoster.some((s) => s.id === id)) {
      setExtraPickerId("");
      return;
    }
    fetch(`/api/students/${id}`)
      .then((r) => r.json())
      .then((data: { student: { id: string; name: string } }) => {
        setExtraStudents((cur) => [...cur, { id: data.student.id, name: data.student.name }]);
        setPerStudent((cur) => ({ ...cur, [id]: blankPerStudent() }));
      });
    setExtraPickerId("");
  }

  function removeExtraStudent(id: string) {
    setExtraStudents((cur) => cur.filter((s) => s.id !== id));
    setPerStudent((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }

  function toggleSubject(name: string) {
    setSubjects((cur) => (cur.includes(name) ? cur.filter((s) => s !== name) : [...cur, name]));
  }

  function toggleFlag(studentId: string, key: "vocabFail" | "homeworkIncomplete" | "absent" | "late") {
    setPerStudent((cur) => {
      const nextValue = !cur[studentId]?.[key];
      const next = { ...cur[studentId], [key]: nextValue };
      // 결석과 지각은 동시에 켜질 수 없는 출결 상태라, 한쪽을 체크하면 다른
      // 한쪽은 자동으로 꺼진다.
      if (nextValue && key === "absent") next.late = false;
      if (nextValue && key === "late") next.absent = false;
      return { ...cur, [studentId]: next };
    });
  }

  function setIndividualNotice(studentId: string, value: string) {
    setPerStudent((cur) => ({ ...cur, [studentId]: { ...cur[studentId], individualNotice: value } }));
  }

  function toggleNoticeOpen(studentId: string) {
    setOpenNoticeIds((cur) => {
      const next = new Set(cur);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  // 항목 종류(열)를 한 번만 추가하면 모든 학생 행에 같은 입력칸이 뜬다 —
  // 학생마다 항목을 따로 고르지 않아도 되게 하는 게 핵심.
  function addScoreType(raw: string) {
    const name = raw.trim();
    if (!name) return;
    setScoreTypes((cur) => (cur.includes(name) ? cur : [...cur, name]));
    setScoreTypeInput("");
  }

  function removeScoreType(name: string) {
    setScoreTypes((cur) => cur.filter((t) => t !== name));
    setPerStudent((cur) => {
      const next: typeof cur = {};
      for (const [sid, v] of Object.entries(cur)) next[sid] = { ...v, scores: v.scores.filter((s) => s.type !== name) };
      return next;
    });
  }

  function getScore(studentId: string, type: string): ScoreEntry {
    return perStudent[studentId]?.scores.find((s) => s.type === type) ?? { type, correct: "", total: "" };
  }

  function setScoreField(studentId: string, type: string, field: "correct" | "total", raw: string) {
    const value = raw.replace(/\D/g, "").slice(0, 3);
    setPerStudent((cur) => {
      const student = cur[studentId] ?? blankPerStudent();
      const idx = student.scores.findIndex((s) => s.type === type);
      const base = idx >= 0 ? student.scores[idx] : { type, correct: "", total: "" };
      const updated = { ...base, [field]: value };
      const scores = idx >= 0 ? student.scores.map((s, i) => (i === idx ? updated : s)) : [...student.scores, updated];
      return { ...cur, [studentId]: { ...student, scores } };
    });
  }

  function handleOpenPreview() {
    setDone(false);
    setError(null);
    setShowPreview(true);
  }

  async function actuallySave(briefingTexts?: Record<string, string>): Promise<{ ok: boolean; error?: string; cancelled?: boolean }> {
    const isEdit = !!existingProgressId;
    // 같은 반을 같은 날 여러 교시로 나눠 기록할 때, 교시를 잘못 고르거나
    // 안 고르면 조회가 다른 교시(또는 "교시 구분 없음")의 기존 기록을 찾아와
    // 조용히 편집 모드로 바뀐다 — 그 상태로 저장을 누르면 새 기록이 아니라
    // 기존 기록이 통째로 덮어써지므로, 편집 모드로 저장할 때는 어떤 교시의
    // 어떤 기록을 덮어쓰는지 짚어주고 한 번 더 확인받는다.
    if (isEdit) {
      const periodLabel = period || "교시 구분 없음";
      const className = selectedClassName || "이 반";
      const ok = window.confirm(
        `${date} ${className} (${periodLabel})에 이미 저장된 기록이 있습니다.\n저장하면 그 기존 기록을 덮어씁니다 — 교시를 잘못 고른 건 아닌지 확인해주세요.\n계속할까요?`
      );
      if (!ok) return { ok: false, cancelled: true };
    }
    try {
      const res = await fetch("/api/class-record", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEdit ? { progressId: existingProgressId } : {}),
          classId: classId || undefined,
          date,
          period: period || undefined,
          subjects,
          progress,
          homework,
          nextAssignment,
          notice,
          perStudent,
          ...(isEdit ? {} : { briefingTexts, reviewDays: reviewDays ? Number(reviewDays) : undefined }),
          extraStudentIds: extraStudents.map((s) => s.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? "저장에 실패했습니다." };
      setDone(true);
      maybeOpenReview();
      if (!isEdit) {
        setProgress("");
        setHomework("");
        setNextAssignment("");
        setNotice("");
        setSubjects([]);
        setExtraStudents([]);
      }
      return { ok: true };
    } catch {
      return { ok: false, error: "네트워크 오류가 발생했습니다." };
    }
  }

  async function handleDirectSave() {
    // 편집(기존 기록 불러온 상태) 저장은 actuallySave 안에서 교시를 짚어주는
    // 전용 확인을 이미 거치므로, 여기서는 새 기록 저장일 때만 일반 확인을 묻는다.
    if (!existingProgressId && !confirmSave()) return;
    setError(null);
    setDone(false);
    setSaving(true);
    const res = await actuallySave();
    setSaving(false);
    if (!res.ok && !res.cancelled) setError(res.error ?? "저장에 실패했습니다.");
  }

  // 이미 저장된 기록이라 전체 저장(handleDirectSave)이 잠긴 강사도, 점수만은
  // 이 별도 경로로 바로 저장할 수 있다 — /api/class-record/scores는 성취사항
  // 외의 필드를 전혀 건드리지 않아 원장/행정 권한 체크가 없다.
  async function handleSaveScoresOnly() {
    if (!existingProgressId) return;
    setError(null);
    setScoresSaved(false);
    setSavingScores(true);
    try {
      const res = await fetch("/api/class-record/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          progressId: existingProgressId,
          scores: Object.fromEntries(Object.entries(perStudent).map(([id, f]) => [id, f.scores])),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "점수 저장에 실패했습니다.");
        return;
      }
      setScoresSaved(true);
    } catch {
      setError("네트워크 오류로 점수를 저장하지 못했습니다.");
    } finally {
      setSavingScores(false);
    }
  }

  const selectedClassName = stripClassSuffix(classes.find((c) => c.id === classId)?.name ?? "");
  const isLocked = !!existingProgressId && !canEditExisting;
  const canSave = !!classId && fullRoster.length > 0 && !saving && !isLocked;

  const selectClass =
    "mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const textareaClass =
    "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const fieldLabelClass = "text-xs font-medium text-muted-foreground";

  return (
    <>
      {/* 사이드바가 생기면서 콘텐츠 폭이 화면 대부분을 채우게 됐는데, 안의
          입력창들을 그 너비에 맞춰 그대로 늘리면 필드 사이 마우스 이동
          거리가 옛 독립형 페이지(.page, max-width:1080px)보다 훨씬 멀어진다
          — 카드 자체 너비를 그때와 비슷하게 다시 제한해 필드 위치가 그
          자리에 가깝게 남도록 한다. */}
      <Card className="max-w-[1040px]">
        <CardHeader>
          <CardTitle>
            오늘 수업 기록 <span className="title-lab-tag">(실험실)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {existingProgressId && isLocked && (
            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              이미 저장된 <strong>{period || "교시 구분 없음"}</strong> 기록입니다. 진도/출결 등은 원장/행정만 수정할 수
              있어요 — 내용을 고칠 일이 있으면 원장/행정에게 요청해주세요. 테스트/과제 점수는 아래 표에서 바로 입력하고{" "}
              <Button type="button" size="sm" variant="outline" disabled={savingScores} onClick={handleSaveScoresOnly}>
                {savingScores ? "저장 중..." : "점수만 저장"}
              </Button>{" "}
              버튼으로 저장하면 됩니다.
              {scoresSaved && <span className="ml-1 font-semibold text-success">저장됐습니다.</span>}
            </div>
          )}
          {existingProgressId && !isLocked && (
            <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning">
              이미 저장된 <strong>{period || "교시 구분 없음"}</strong> 기록을 불러왔습니다 — 수정 후 저장하면 기존 기록을
              덮어씁니다. 다른 교시를 기록하려면 위 "교시"를 먼저 맞게 골라주세요.
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-3.5">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={fieldLabelClass} htmlFor="date">날짜</label>
                  <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="mt-1" />
                </div>
                <div>
                  <label className={fieldLabelClass} htmlFor="class">반</label>
                  <select id="class" value={classId} onChange={(e) => setClassId(e.target.value)} className={selectClass}>
                    <option value="">반 선택</option>
                    {visibleClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.type === "시험대비" ? `[시험대비] ${stripClassSuffix(c.name)}` : stripClassSuffix(c.name)}
                      </option>
                    ))}
                  </select>
                  <label className="mt-1.5 flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={includeExamClasses}
                      onChange={(e) => setIncludeExamClasses(e.target.checked)}
                    />
                    시험대비반 포함
                  </label>
                </div>
                <div>
                  <label className={fieldLabelClass} htmlFor="period">
                    교시 (같은 반, 여러 선생님이 교시로 나눌 때만)
                  </label>
                  <select id="period" value={period} onChange={(e) => setPeriod(e.target.value)} className={selectClass}>
                    <option value="">교시 구분 없음</option>
                    <option value="1교시">1교시</option>
                    <option value="2교시">2교시</option>
                    <option value="3교시">3교시</option>
                  </select>
                </div>
              </div>

              <div>
                <label className={fieldLabelClass}>수업과목</label>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
                  {SUBJECT_OPTIONS.map((s) => (
                    <label key={s} className="flex items-center gap-1.5 text-sm text-foreground">
                      <input type="checkbox" disabled={isLocked} checked={subjects.includes(s)} onChange={() => toggleSubject(s)} />
                      {s}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-3.5">
                  <div>
                    <label className={fieldLabelClass} htmlFor="progress">진도</label>
                    <textarea
                      id="progress"
                      rows={2}
                      disabled={isLocked}
                      value={progress}
                      onChange={(e) => setProgress(e.target.value)}
                      required
                      className={textareaClass}
                    />
                  </div>

                  <div>
                    <label className={fieldLabelClass} htmlFor="homework">과제</label>
                    <textarea
                      id="homework"
                      rows={2}
                      disabled={isLocked}
                      value={homework}
                      onChange={(e) => setHomework(e.target.value)}
                      className={textareaClass}
                    />
                  </div>

                  <div>
                    <label className={fieldLabelClass} htmlFor="nextAssignment">다음시간 테스트</label>
                    <textarea
                      id="nextAssignment"
                      rows={2}
                      disabled={isLocked}
                      value={nextAssignment}
                      onChange={(e) => setNextAssignment(e.target.value)}
                      className={textareaClass}
                    />
                  </div>
                </div>

                <div className="space-y-3.5">
                  <div>
                    <label className={fieldLabelClass} htmlFor="notice">전달사항</label>
                    <Input
                      id="notice"
                      type="text"
                      disabled={isLocked}
                      value={notice}
                      onChange={(e) => setNotice(e.target.value)}
                      className="mt-1"
                    />
                  </div>

                  {!existingProgressId && (
                    <div>
                      <label className={fieldLabelClass} htmlFor="reviewDays">
                        복습 주기 (일 — 오늘 진도를 며칠 뒤 복습 알림으로 등록할지)
                      </label>
                      <Input
                        id="reviewDays"
                        type="text"
                        inputMode="numeric"
                        placeholder="예: 7 (비우면 복습 등록 안 함)"
                        value={reviewDays}
                        onChange={(e) => setReviewDays(e.target.value.replace(/\D/g, ""))}
                        className="mt-1"
                      />
                    </div>
                  )}
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
              {done && (
                <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm font-semibold text-success">
                  저장됐습니다.
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" onClick={handleOpenPreview} disabled={!classId || fullRoster.length === 0}>
                  미리보기
                </Button>
                <Button type="button" onClick={handleDirectSave} disabled={!canSave}>
                  {saving ? "저장 중..." : existingProgressId ? "수정 저장" : "저장"}
                </Button>
              </div>
            </div>

            {/* 예전엔 이 패널 전체를 <fieldset disabled={isLocked}>로 한 번에 잠갔는데,
                그러면 새로 추가한 테스트/과제 점수 입력칸까지 함께 잠겨(브라우저가
                disabled input에는 아예 포커스/타이핑을 안 받음) 강사가 이미 저장된
                오늘 기록에 점수를 나중에 채워 넣을 수 없었다("숫자 입력이 안됨" 버그
                원인). 잠금 사유(출결/단어미통과/과제미완료 같은 확정된 값을 실수로
                덮어쓰는 사고 방지)와 무관한 점수 입력은 항상 열어두고, 그 사유에
                해당하는 컨트롤에만 disabled={isLocked}를 개별로 건다. */}
            <div>
              <label className={fieldLabelClass}>학생별 체크 ({selectedClassName || "반 선택"})</label>

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">오늘 테스트/과제 항목:</span>
                {scoreTypes.map((t) => (
                  <Badge key={t} className="gap-1 pr-1.5">
                    {t}
                    <button
                      type="button"
                      onClick={() => removeScoreType(t)}
                      aria-label={`${t} 항목 제거`}
                      className="bg-transparent p-0 leading-none text-primary/70 hover:text-primary"
                    >
                      ×
                    </button>
                  </Badge>
                ))}
                {SCORE_TYPE_SUGGESTIONS.filter((t) => !scoreTypes.includes(t)).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => addScoreType(t)}
                    className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                  >
                    + {t}
                  </button>
                ))}
                <input
                  type="text"
                  value={scoreTypeInput}
                  onChange={(e) => setScoreTypeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addScoreType(scoreTypeInput);
                    }
                  }}
                  placeholder="직접입력 후 Enter"
                  className="h-6 w-28 rounded-full border border-dashed border-border bg-transparent px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              {loadingRoster && <p className="mt-3 text-sm text-muted-foreground">명단 불러오는 중...</p>}
              {!loadingRoster && roster.length === 0 && extraStudents.length === 0 && (
                <p className="mt-3 text-sm text-muted-foreground">이 반에 등록된 학생이 없습니다.</p>
              )}
              {!loadingRoster && fullRoster.length > 0 && (
                <div className="mt-3 max-h-[560px] overflow-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="sticky top-0 z-10 border-b border-border bg-card text-xs text-muted-foreground">
                        <th className="whitespace-nowrap px-2 py-1.5 text-left font-medium">학생</th>
                        <th className="whitespace-nowrap px-2 py-1.5 text-left font-medium">결석</th>
                        <th className="whitespace-nowrap px-2 py-1.5 text-left font-medium">지각</th>
                        <th className="whitespace-nowrap px-2 py-1.5 text-left font-medium">단어X</th>
                        <th className="whitespace-nowrap px-2 py-1.5 text-left font-medium">과제X</th>
                        {scoreTypes.map((t) => (
                          <th key={t} className="whitespace-nowrap px-2 py-1.5 text-left font-medium">{t}</th>
                        ))}
                        <th className="whitespace-nowrap px-2 py-1.5 text-left font-medium">메모</th>
                        <th className="px-2 py-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {fullRoster.map((s, idx) => {
                        const isExtra = extraStudents.some((e) => e.id === s.id);
                        const flags = perStudent[s.id];
                        const noticeOpen = openNoticeIds.has(s.id) || !!flags?.individualNotice;
                        const flagChip = (active: boolean, label: string, onClick: () => void) => (
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={onClick}
                            className={cn(
                              "whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50",
                              active
                                ? "border-destructive bg-destructive/10 text-destructive"
                                : "border-border bg-transparent text-muted-foreground hover:bg-muted"
                            )}
                          >
                            {label}
                          </button>
                        );
                        return (
                          <Fragment key={s.id}>
                            <tr className={cn("border-b border-border last:border-b-0", idx % 2 === 1 && "bg-muted/40")}>
                              <td className="whitespace-nowrap px-2 py-1.5 font-medium text-foreground">
                                {s.name}
                                {isExtra && (
                                  <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">
                                    다른반
                                  </Badge>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1">{flagChip(!!flags?.absent, "결석", () => toggleFlag(s.id, "absent"))}</td>
                              <td className="whitespace-nowrap px-2 py-1">{flagChip(!!flags?.late, "지각", () => toggleFlag(s.id, "late"))}</td>
                              <td className="whitespace-nowrap px-2 py-1">{flagChip(!!flags?.vocabFail, "단어X", () => toggleFlag(s.id, "vocabFail"))}</td>
                              <td className="whitespace-nowrap px-2 py-1">
                                {flagChip(!!flags?.homeworkIncomplete, "과제X", () => toggleFlag(s.id, "homeworkIncomplete"))}
                              </td>
                              {scoreTypes.map((t) => {
                                const score = getScore(s.id, t);
                                return (
                                  <td key={t} className="px-2 py-1.5">
                                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={score.correct}
                                        onChange={(e) => setScoreField(s.id, t, "correct", e.target.value)}
                                        aria-label={`${s.name} ${t} 맞은 개수`}
                                        autoComplete="off"
                                        data-lpignore="true"
                                        data-1p-ignore="true"
                                        data-bwignore="true"
                                        className="h-6 w-7 rounded border border-input bg-background px-0.5 text-center text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                      />
                                      <span className="text-muted-foreground">/</span>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={score.total}
                                        onChange={(e) => setScoreField(s.id, t, "total", e.target.value)}
                                        aria-label={`${s.name} ${t} 전체 개수`}
                                        autoComplete="off"
                                        data-lpignore="true"
                                        data-1p-ignore="true"
                                        data-bwignore="true"
                                        className="h-6 w-7 rounded border border-input bg-background px-0.5 text-center text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                      />
                                    </span>
                                  </td>
                                );
                              })}
                              <td className="px-2 py-1.5">
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  onClick={() => toggleNoticeOpen(s.id)}
                                  className={cn(
                                    "whitespace-nowrap rounded-md border px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-50",
                                    flags?.individualNotice
                                      ? "border-primary bg-primary/10 text-primary"
                                      : "border-border bg-transparent text-muted-foreground hover:bg-muted"
                                  )}
                                >
                                  {flags?.individualNotice ? "메모 있음" : "+ 메모"}
                                </button>
                              </td>
                              <td className="px-2 py-1.5">
                                {isExtra && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={isLocked}
                                    onClick={() => removeExtraStudent(s.id)}
                                    className="h-6 px-2 text-[11px]"
                                  >
                                    제거
                                  </Button>
                                )}
                              </td>
                            </tr>
                            {noticeOpen && (
                              <tr className="border-b border-border bg-muted/30 last:border-b-0">
                                <td colSpan={7 + scoreTypes.length} className="px-2 py-1.5">
                                  <textarea
                                    rows={2}
                                    disabled={isLocked}
                                    placeholder="개별 안내사항"
                                    value={flags?.individualNotice ?? ""}
                                    onChange={(e) => setIndividualNotice(s.id, e.target.value)}
                                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className={cn("mt-3", isLocked && "pointer-events-none opacity-50")}>
                <StudentPicker studentId={extraPickerId} onChange={addExtraStudent} label="다른 반 학생 호출 (개별 기록 추가)" allowEmpty />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {showPreview && (
        <DailyBriefingPreviewModal
          draft={{
            date,
            classId,
            className: selectedClassName,
            progress,
            homework,
            nextAssignment,
            notice,
            roster: fullRoster,
            perStudent,
          }}
          classes={classes}
          onClose={() => setShowPreview(false)}
          onSave={actuallySave}
        />
      )}

      {reviewItems && (
        <AbsenceReviewModal
          items={reviewItems}
          onClose={() => setReviewItems(null)}
          onChanged={() => {
            fetch(`/api/absence-review?date=${encodeURIComponent(date)}`)
              .then((r) => r.json())
              .then((data: { items: AbsenceReviewItem[] }) => setReviewItems(data.items ?? []));
          }}
        />
      )}
    </>
  );
}

function AdminInputForm() {
  const [type, setType] = useState("결석예정");
  const [studentId, setStudentId] = useState("");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState("");
  const [content, setContent] = useState("");
  const [owner, setOwner] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAbsence = type === "결석예정";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmSave()) return;
    setError(null);
    setSaving(true);
    setDone(false);
    try {
      const res = await fetch("/api/admin-input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          studentId,
          content,
          startDate,
          endDate: isAbsence ? endDate : undefined,
          owner,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setDone(true);
      setContent("");
      setEndDate("");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>결석예정 / 긴급상담요청 <span className="title-lab-tag">(실험실)</span></h2>

      <label htmlFor="type">유형</label>
      <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="결석예정">결석예정</option>
        <option value="긴급상담요청">긴급상담요청</option>
      </select>

      <StudentPicker studentId={studentId} onChange={setStudentId} label="대상학생" />

      <StaffPicker value={owner} onChange={setOwner} label="담당자 (처리해야 할 사람, 선택)" />

      {isAbsence ? (
        <div className="field-row">
          <div>
            <label htmlFor="startDate">시작일</label>
            <input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="endDate">종료일</label>
            <input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate} />
          </div>
        </div>
      ) : (
        <>
          <label htmlFor="startDate2">날짜</label>
          <input id="startDate2" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </>
      )}

      <label htmlFor="content">내용</label>
      <textarea id="content" value={content} onChange={(e) => setContent(e.target.value)} required />

      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={saving || !content || !studentId}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </form>
  );
}

function CounselingForm() {
  const [studentId, setStudentId] = useState("");
  const [counselor, setCounselor] = useState("");
  const [date, setDate] = useState(todayStr());
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmSave()) return;
    setError(null);
    setSaving(true);
    setDone(false);
    try {
      const res = await fetch("/api/counseling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, counselor, date, transcript, summary, followUp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setDone(true);
      setTranscript("");
      setSummary("");
      setFollowUp("");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>상담일지 등록 <span className="title-lab-tag">(실험실)</span></h2>
      <p className="muted">전사내용(원본)과 상담내용(요약)을 나눠서 입력합니다.</p>

      <StudentPicker studentId={studentId} onChange={setStudentId} />

      <div className="field-row">
        <StaffPicker value={counselor} onChange={setCounselor} />
        <div>
          <label htmlFor="counselingDate">날짜</label>
          <input id="counselingDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
      </div>

      <label htmlFor="transcript">전사내용 (원본, 길게 작성 가능)</label>
      <textarea id="transcript" value={transcript} onChange={(e) => setTranscript(e.target.value)} style={{ minHeight: 140 }} />

      <label htmlFor="summary">상담내용 (요약)</label>
      <textarea id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} required />

      <label htmlFor="followUp">후속조치</label>
      <textarea id="followUp" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />

      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={saving || !studentId || !summary}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </form>
  );
}

const EVAL_REASONS = ["누적결석 3회", "단어미통과 3회", "성적하락"];

function StudentInfoForm() {
  const [studentId, setStudentId] = useState("");
  const [enrolledAt, setEnrolledAt] = useState("");
  const [tuitionDay, setTuitionDay] = useState("");
  const [learningLevel, setLearningLevel] = useState("");
  const [action, setAction] = useState("");
  const [actionOwner, setActionOwner] = useState("");
  const [actionAlarmDate, setActionAlarmDate] = useState("");
  const [evalReasons, setEvalReasons] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleReason(reason: string) {
    setEvalReasons((cur) => {
      const next = cur.includes(reason) ? cur.filter((r) => r !== reason) : [...cur, reason];
      return next;
    });
  }

  useEffect(() => {
    if (evalReasons.length === 0) return;
    if (!actionAlarmDate) setActionAlarmDate(todayStr());
  }, [evalReasons, actionAlarmDate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmSave()) return;
    setError(null);
    setSaving(true);
    setDone(false);
    try {
      const combinedAction = [action, ...evalReasons].filter(Boolean).join(" / ");
      const res = await fetch("/api/student-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          enrolledAt,
          tuitionDay,
          learningLevel,
          action: combinedAction,
          actionOwner,
          actionAlarmDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setDone(true);
      setEvalReasons([]);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>학생 정보 업데이트 <span className="title-lab-tag">(실험실)</span></h2>
      <p className="muted">등원일 · 회비일 · 학습레벨 · 조치(알람) 입력 (행정 전용)</p>

      <StudentPicker studentId={studentId} onChange={setStudentId} />

      <label htmlFor="enrolledAt">등원일</label>
      <input id="enrolledAt" type="date" value={enrolledAt} onChange={(e) => setEnrolledAt(e.target.value)} />

      <label htmlFor="tuitionDay">회비일 (매월 며칠)</label>
      <input
        id="tuitionDay"
        type="text"
        inputMode="numeric"
        placeholder="예: 15"
        value={tuitionDay}
        onChange={(e) => setTuitionDay(e.target.value.replace(/\D/g, ""))}
      />

      <label htmlFor="learningLevel">학습레벨</label>
      <input id="learningLevel" type="text" value={learningLevel} onChange={(e) => setLearningLevel(e.target.value)} />

      <label>평가결과 (체크 시 조치에 자동 반영)</label>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
        {EVAL_REASONS.map((r) => (
          <label key={r} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, margin: 0 }}>
            <input type="checkbox" checked={evalReasons.includes(r)} onChange={() => toggleReason(r)} />
            {r}
          </label>
        ))}
      </div>

      <label htmlFor="action">조치</label>
      <textarea id="action" value={action} onChange={(e) => setAction(e.target.value)} />

      <StaffPicker value={actionOwner} onChange={setActionOwner} label="담당자(상담자)" />

      <label htmlFor="actionAlarmDate">조치 알람일 (이 날짜에 대시보드 "오늘의 일정"에 표시)</label>
      <input
        id="actionAlarmDate"
        type="date"
        value={actionAlarmDate}
        onChange={(e) => setActionAlarmDate(e.target.value)}
      />

      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={saving || !studentId}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </form>
  );
}

function StudentRegisterForm() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [searchPickerId, setSearchPickerId] = useState("");
  const [loadingStudent, setLoadingStudent] = useState(false);
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [grade, setGrade] = useState("");
  const [status, setStatus] = useState("재원");
  const [phone, setPhone] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [registeredAt, setRegisteredAt] = useState(todayStr());
  const [enrolledAt, setEnrolledAt] = useState("");
  const [tuitionDay, setTuitionDay] = useState("");
  const [learningLevel, setLearningLevel] = useState("");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/classes")
      .then((r) => r.json())
      .then(setClasses);
  }, []);

  function toggleClass(id: string) {
    setClassIds((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]));
  }

  function resetForm() {
    setEditingStudentId(null);
    setSearchPickerId("");
    setName("");
    setSchool("");
    setGrade("");
    setStatus("재원");
    setPhone("");
    setParentPhone("");
    setRegisteredAt(todayStr());
    setEnrolledAt("");
    setTuitionDay("");
    setLearningLevel("");
    setClassIds([]);
    setMemo("");
    setError(null);
  }

  // 검색창을 다시 입력하는 동안 계속 onChange("")가 날아오는 StudentPicker의
  // 특성상, 여기서는 실제 선택(id가 있을 때)에만 반응한다 — 그래야 검색어를
  // 고치는 동안 이미 불러온 폼 내용이 매 타이핑마다 날아가지 않는다.
  async function handlePickExisting(id: string) {
    setSearchPickerId(id);
    if (!id) return;
    setLoadingStudent(true);
    setError(null);
    try {
      const res = await fetch(`/api/students/${id}`);
      const data = await res.json();
      const s = data.student;
      setEditingStudentId(s.id);
      setName(s.name ?? "");
      setSchool(s.school ?? "");
      setGrade(s.grade ?? "");
      setStatus(s.status ?? "재원");
      setPhone(s.phone ?? "");
      setParentPhone(s.parentPhone ?? "");
      setRegisteredAt(s.registeredAt ?? "");
      setEnrolledAt(s.enrolledAt ?? "");
      setTuitionDay(s.tuitionDay !== null && s.tuitionDay !== undefined ? String(s.tuitionDay) : "");
      setLearningLevel(s.learningLevel ?? "");
      setClassIds(s.classIds ?? []);
      setMemo(s.memo ?? "");
      setDone(false);
    } catch {
      setError("학생 정보를 불러오지 못했습니다.");
    } finally {
      setLoadingStudent(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmSave()) return;
    setError(null);
    setSaving(true);
    setDone(false);
    try {
      const isEdit = !!editingStudentId;
      const res = await fetch(isEdit ? `/api/students/${editingStudentId}` : "/api/students", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          school,
          grade,
          status,
          phone,
          parentPhone,
          registeredAt,
          enrolledAt,
          tuitionDay: tuitionDay || undefined,
          learningLevel,
          classIds,
          memo,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      if (isEdit) {
        setDone(true);
      } else {
        resetForm();
        setDone(true);
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>학생 등록 <span className="title-lab-tag">(실험실)</span></h2>
      <p className="muted">이름으로 검색하면 기존 학생 정보를 불러와 수정할 수 있고, 검색 결과가 없으면 새로 등록됩니다.</p>

      <StudentPicker
        studentId={searchPickerId}
        onChange={handlePickExisting}
        label="학생 검색 (있으면 불러오기, 없으면 새로 등록)"
        includeInactive
      />
      {loadingStudent && <p className="muted">불러오는 중...</p>}
      {editingStudentId && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 12px" }}>
          <p className="muted" style={{ margin: 0 }}>
            기존 학생 정보를 불러왔습니다 — 수정 후 저장하면 해당 학생 정보가 업데이트됩니다.
          </p>
          <button type="button" className="secondary" onClick={resetForm}>
            새 학생 등록으로 초기화
          </button>
        </div>
      )}

      <div className="field-row">
        <div>
          <label htmlFor="regName">이름</label>
          <input id="regName" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="regStatus">상태</label>
          <select id="regStatus" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="field-row">
        <div>
          <label htmlFor="regSchool">학교</label>
          <input id="regSchool" type="text" value={school} onChange={(e) => setSchool(e.target.value)} />
        </div>
        <div>
          <label htmlFor="regGrade">학년</label>
          <select id="regGrade" value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">선택 안 함</option>
            {GRADE_OPTIONS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="field-row">
        <div>
          <label htmlFor="regPhone">학생 연락처</label>
          <input id="regPhone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" />
        </div>
        <div>
          <label htmlFor="regParentPhone">학부모 연락처</label>
          <input id="regParentPhone" type="tel" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} placeholder="010-0000-0000" />
        </div>
      </div>

      <div className="field-row">
        <div>
          <label htmlFor="regRegisteredAt">등록일</label>
          <input id="regRegisteredAt" type="date" value={registeredAt} onChange={(e) => setRegisteredAt(e.target.value)} />
        </div>
        <div>
          <label htmlFor="regEnrolledAt">등원일 (첫 등원일)</label>
          <input id="regEnrolledAt" type="date" value={enrolledAt} onChange={(e) => setEnrolledAt(e.target.value)} />
        </div>
      </div>

      <div className="field-row">
        <div>
          <label htmlFor="regTuitionDay">회비일 (매월 며칠)</label>
          <input
            id="regTuitionDay"
            type="text"
            inputMode="numeric"
            placeholder="예: 15"
            value={tuitionDay}
            onChange={(e) => setTuitionDay(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div>
          <label htmlFor="regLearningLevel">학습레벨</label>
          <input id="regLearningLevel" type="text" value={learningLevel} onChange={(e) => setLearningLevel(e.target.value)} />
        </div>
      </div>

      <label>소속반 (복수 선택 가능)</label>
      <div className="class-checkbox-grid">
        {classes.map((c) => (
          <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, margin: 0 }}>
            <input type="checkbox" checked={classIds.includes(c.id)} onChange={() => toggleClass(c.id)} />
            {stripClassSuffix(c.name)}
          </label>
        ))}
      </div>

      <label htmlFor="regMemo">메모 (추천인/특이사항 등)</label>
      <textarea id="regMemo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 백서연 친구 소개" />

      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={saving || !name.trim()}>
          {saving ? "저장 중..." : editingStudentId ? "수정 저장" : "저장"}
        </button>
      </div>
    </form>
  );
}

function QuickScheduleCard() {
  return (
    <div className="card">
      <h2>일정 빠른등록 <span className="title-lab-tag">(실험실)</span></h2>
      <p className="muted">
        보강 · 재시 · 신입생상담/레벨체크 · 클리닉 · 신입생 첫등원 · 조치사항 · 개인 할일 — 대시보드
        "오늘의 일정"의 빠른 등록과 완전히 같은 방식으로 저장되어 서로 그대로 동기화됩니다.
      </p>
      <QuickScheduleForm />
    </div>
  );
}

type TabKey = "schedule" | "students" | "ops" | "records";

export default function InputClient({
  role,
  embedded = false,
}: {
  role: string | null;
  staffId?: string | null;
  // /director/input처럼 이미 사이드바+본문 패딩이 있는 레이아웃 안에서 쓸
  // 때는 true로 넘긴다 — 기본값(false)은 옛 독립형 /input 라우트(TopBar만
  // 있고 좌측 사이드바가 없음) 그대로, .page의 max-width:1080px+margin:0
  // auto가 콘텐츠를 화면 중앙으로 밀어 사이드바 옆에 큰 여백을 만든다.
  embedded?: boolean;
}) {
  // 원장/행정은 강사·조교·행정 입력폼을 모두 볼 수 있어야 하므로, "행정 전용"
  // 폼들도 원장에게 함께 열어준다. 조교는 강사의 "오늘 수업 기록"이 아니라
  // 클리닉(코칭) 전용 폼을 쓴다 — 정규수업 진도가 아니라 1:1~1:다수 코칭이
  // 업무의 핵심이라 강사 폼을 그대로 재사용할 수 없다. 다만 결석/단어통과
  // 체크는 조교·행정도 진도 없이 바로 할 수 있어야 하므로 AttendanceCheckForm은
  // 둘 다에게 열어준다 — 같은 반/날짜 기록을 담당교사의 "오늘 수업 기록"과
  // 공유해서, 먼저 체크해두면 교사가 열었을 때 그대로 남아있고, 교사가 진도를
  // 채워 저장하면 그 시점에 브리핑이 생성된다.
  const isAdminLike = role === "행정" || role === "원장";
  const isAssistant = role === "조교";

  // 폼이 12개 가까이 한 페이지에 세로로 쌓여 있으면 원하는 폼을 찾으려고
  // 계속 스크롤해야 했다. 성격이 비슷한 폼끼리 탭으로 묶어서, 탭 전환만으로
  // 원하는 폼에 바로 도달하고 각 탭 안의 스크롤도 최소화되게 한다.
  const showStudentsTab = isAdminLike;
  const showOpsTab = isAdminLike || !isAssistant;

  const tabs = (
    [
      { key: "schedule", label: "일정 등록", show: true },
      { key: "students", label: "학생 관리", show: showStudentsTab },
      { key: "ops", label: "반 · 조교 관리", show: showOpsTab },
      { key: "records", label: "수업 · 코칭 기록", show: true },
    ] as { key: TabKey; label: string; show: boolean }[]
  ).filter((t) => t.show);

  // 좌측 사이드바 트리 메뉴("입력 > 일정 등록" 등)에서 ?tab=records 식으로
  // 특정 탭에 바로 딥링크할 수 있게 초기값만 URL에서 읽는다 — 이후 탭 전환은
  // 기존처럼 로컬 상태로만 처리(URL은 굳이 갱신하지 않음).
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as TabKey | null) ?? "schedule";
  const [tab, setTab] = useState<TabKey>(initialTab);
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;

  // 미입력 반 찾기에서 항목을 고르면 그 반/날짜로 기록폼을 다시 채워 넣는다
  // — key를 바꿔 ClassRecordForm을 새로 마운트시키는 방식으로, 폼 내부 상태를
  // 밖에서 직접 건드리지 않고도 초기값만 갈아끼운다.
  const [recordPrefill, setRecordPrefill] = useState<{ classId: string; date: string; key: number } | null>(null);

  return (
    <div className={embedded ? "space-y-4" : "page"}>
      <div className="input-tabbar">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={activeTab === t.key ? "" : "secondary"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "schedule" && (
        <>
          <div className="grid-3">
            <QuickScheduleCard />
            <CounselingForm />
            <AdminInputForm />
          </div>
          <MakeupStatusCard role={role} />
        </>
      )}

      {activeTab === "students" && showStudentsTab && (
        <>
          <StudentRegisterForm />
          <StudentInfoForm />
        </>
      )}

      {activeTab === "ops" && showOpsTab && (
        <div className="grid-2">
          {isAdminLike && <ClassManageForm />}
          {isAdminLike && <ClassAssistantAssignForm />}
          {isAdminLike && <StaffScheduleForm />}
          {isAdminLike && <StaffRegisterForm />}
          {!isAssistant && <AssignClinicTaskForm />}
        </div>
      )}

      {activeTab === "records" && (
        <>
          {!isAssistant && (
            <ClassRecordGapFinder onPick={(classId, date) => setRecordPrefill({ classId, date, key: Date.now() })} />
          )}
          {!isAssistant && (
            <ClassRecordForm
              key={recordPrefill?.key ?? "default"}
              canEditExisting={isAdminLike}
              initialClassId={recordPrefill?.classId}
              initialDate={recordPrefill?.date}
            />
          )}
          {(isAssistant || isAdminLike) && <AttendanceCheckForm />}
          {(isAssistant || isAdminLike) && <AssistantClinicForm role={role} />}
        </>
      )}
    </div>
  );
}
