"use client";

import { useEffect, useState } from "react";
import StudentPicker from "./StudentPicker";
import StaffPicker from "./StaffPicker";
import DailyBriefingPreviewModal from "./DailyBriefingPreviewModal";
import AssistantClinicForm from "./AssistantClinicForm";
import AttendanceCheckForm from "./AttendanceCheckForm";
import ClassAssistantAssignForm from "./ClassAssistantAssignForm";
import StaffScheduleForm from "./StaffScheduleForm";
import ClassManageForm from "./ClassManageForm";
import AssignClinicTaskForm from "./AssignClinicTaskForm";
import QuickScheduleForm from "./QuickScheduleForm";
import MakeupStatusCard from "./MakeupStatusCard";
import AbsenceReviewModal, { AbsenceReviewItem } from "./AbsenceReviewModal";
import { todayKST as todayStr } from "@/lib/date";
import { stripClassSuffix } from "@/lib/format";

type ClassOption = { id: string; name: string };
type RosterStudent = { id: string; name: string };

const SUBJECT_OPTIONS = ["문법", "독해", "서술형", "구문", "듣기", "모의고사", "어법", "내신대비"];
const GRADE_OPTIONS = ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"];
const STATUS_OPTIONS = ["재원", "대기생", "휴원", "퇴원"];

function confirmSave() {
  return window.confirm("저장하시겠습니까?");
}

function ClassRecordForm() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState("");
  const [manualClassName, setManualClassName] = useState("");
  const [date, setDate] = useState(todayStr());
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
  const [perStudent, setPerStudent] = useState<
    Record<string, { vocabFail: boolean; homeworkIncomplete: boolean; absent: boolean; late: boolean }>
  >({});
  const [showPreview, setShowPreview] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [existingProgressId, setExistingProgressId] = useState<string | null>(null);
  const [reviewItems, setReviewItems] = useState<AbsenceReviewItem[] | null>(null);

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

  useEffect(() => {
    if (!classId) return;
    setLoadingRoster(true);
    fetch(`/api/students?classId=${classId}`)
      .then((r) => r.json())
      .then((list: RosterStudent[]) => {
        setRoster(list);
        setExtraStudents([]); // switching class clears any manually-called-up guests
        setPerStudent(
          Object.fromEntries(
            list.map((s) => [s.id, { vocabFail: false, homeworkIncomplete: false, absent: false, late: false }])
          )
        );
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
        // 아직 이 반/날짜의 수업 기록이 없어도, 행정실에 "결석예정"으로 이미
        // 접수된 학생은 결석 체크를 미리 반영해 강사가 다시 체크하지 않게 한다.
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
          next[sid] = rec.perStudent[sid] ?? { vocabFail: false, homeworkIncomplete: false, absent: false, late: false };
        }
        return next;
      });
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
        setPerStudent((cur) => ({ ...cur, [id]: { vocabFail: false, homeworkIncomplete: false, absent: false, late: false } }));
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

  function handleOpenPreview() {
    setDone(false);
    setError(null);
    setShowPreview(true);
  }

  async function actuallySave(briefingTexts?: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    const isEdit = !!existingProgressId;
    try {
      const res = await fetch("/api/class-record", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEdit ? { progressId: existingProgressId } : {}),
          classId: classId || undefined,
          manualClassName: classId ? undefined : manualClassName.trim() || undefined,
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
    if (!confirmSave()) return;
    setError(null);
    setDone(false);
    setSaving(true);
    const res = await actuallySave();
    setSaving(false);
    if (!res.ok) setError(res.error ?? "저장에 실패했습니다.");
  }

  const selectedClassName = stripClassSuffix(classes.find((c) => c.id === classId)?.name ?? "");
  const hasClass = !!classId || !!manualClassName.trim();
  const canSave = hasClass && (classId ? fullRoster.length > 0 : true) && !saving;

  return (
    <>
      <form className="card" onSubmit={(e) => e.preventDefault()}>
        <h2>오늘 수업 기록 <span className="title-lab-tag">(실험실)</span></h2>
        {existingProgressId && (
          <p className="muted" style={{ marginTop: -4 }}>
            이미 저장된 기록을 불러왔습니다 — 수정 후 저장하면 기존 기록이 업데이트됩니다.
          </p>
        )}

        <div className="class-record-layout">
          <div>
            <div className="field-row">
              <div>
                <label htmlFor="date">날짜</label>
                <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div>
                <label htmlFor="class">반</label>
                <select
                  id="class"
                  value={classId}
                  onChange={(e) => {
                    setClassId(e.target.value);
                    if (e.target.value) setManualClassName("");
                  }}
                >
                  <option value="">반 선택</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{stripClassSuffix(c.name)}</option>
                  ))}
                </select>
              </div>
            </div>

            <label htmlFor="manualClass">반이름 직접입력 (목록에 없는 반일 때)</label>
            <input
              id="manualClass"
              type="text"
              value={manualClassName}
              onChange={(e) => {
                setManualClassName(e.target.value);
                if (e.target.value) setClassId("");
              }}
              placeholder="예: 고3 E반"
            />

            <label htmlFor="period">교시 (같은 반을 같은 날 여러 선생님이 교시로 나눠 들어갈 때만 선택)</label>
            <select id="period" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="">교시 구분 없음</option>
              <option value="1교시">1교시</option>
              <option value="2교시">2교시</option>
              <option value="3교시">3교시</option>
            </select>

            <label>수업과목</label>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
              {SUBJECT_OPTIONS.map((s) => (
                <label key={s} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, margin: 0 }}>
                  <input type="checkbox" checked={subjects.includes(s)} onChange={() => toggleSubject(s)} />
                  {s}
                </label>
              ))}
            </div>

            <label htmlFor="progress">진도</label>
            <textarea id="progress" rows={2} value={progress} onChange={(e) => setProgress(e.target.value)} required />

            <label htmlFor="homework">과제</label>
            <textarea id="homework" rows={2} value={homework} onChange={(e) => setHomework(e.target.value)} />

            <label htmlFor="nextAssignment">다음시간 테스트</label>
            <textarea
              id="nextAssignment"
              rows={2}
              value={nextAssignment}
              onChange={(e) => setNextAssignment(e.target.value)}
            />

            <label htmlFor="notice">전달사항</label>
            <input id="notice" type="text" value={notice} onChange={(e) => setNotice(e.target.value)} />

            {!existingProgressId && (
              <>
                <label htmlFor="reviewDays">복습 주기 (일 — 오늘 진도를 며칠 뒤 복습 알림으로 등록할지)</label>
                <input
                  id="reviewDays"
                  type="text"
                  inputMode="numeric"
                  placeholder="예: 7 (비우면 복습 등록 안 함)"
                  value={reviewDays}
                  onChange={(e) => setReviewDays(e.target.value.replace(/\D/g, ""))}
                />
              </>
            )}

            {error && <p className="error-text">{error}</p>}
            {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button
                type="button"
                className="secondary"
                onClick={handleOpenPreview}
                disabled={!classId || fullRoster.length === 0}
              >
                미리보기
              </button>
              <button
                type="button"
                onClick={handleDirectSave}
                disabled={!canSave}
              >
                {saving ? "저장 중..." : existingProgressId ? "수정 저장" : "저장"}
              </button>
            </div>
          </div>

          <div>
            <label>학생별 체크 ({selectedClassName || "반 선택"})</label>
            {loadingRoster && <p className="muted">명단 불러오는 중...</p>}
            {!loadingRoster && roster.length === 0 && extraStudents.length === 0 && (
              <p className="muted">이 반에 등록된 학생이 없습니다.</p>
            )}
            {!loadingRoster &&
              fullRoster.map((s) => {
                const isExtra = extraStudents.some((e) => e.id === s.id);
                return (
                  <div key={s.id} className="roster-check-row">
                    <span>
                      {s.name}
                      {isExtra && <span className="badge" style={{ marginLeft: 6 }}>다른반</span>}
                    </span>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <label>
                        <input
                          type="checkbox"
                          checked={perStudent[s.id]?.absent ?? false}
                          onChange={() => toggleFlag(s.id, "absent")}
                        />
                        결석
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={perStudent[s.id]?.late ?? false}
                          onChange={() => toggleFlag(s.id, "late")}
                        />
                        지각
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={perStudent[s.id]?.vocabFail ?? false}
                          onChange={() => toggleFlag(s.id, "vocabFail")}
                        />
                        단어미통과
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={perStudent[s.id]?.homeworkIncomplete ?? false}
                          onChange={() => toggleFlag(s.id, "homeworkIncomplete")}
                        />
                        과제미완료
                      </label>
                      {isExtra && (
                        <button type="button" className="secondary" onClick={() => removeExtraStudent(s.id)}>
                          제거
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

            <div style={{ marginTop: 12 }}>
              <StudentPicker studentId={extraPickerId} onChange={addExtraStudent} label="다른 반 학생 호출 (개별 기록 추가)" allowEmpty />
            </div>
          </div>
        </div>
      </form>

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

      <StudentPicker studentId={searchPickerId} onChange={handlePickExisting} label="학생 검색 (있으면 불러오기, 없으면 새로 등록)" />
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

export default function InputClient({ role }: { role: string | null; staffId?: string | null }) {
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

  const [tab, setTab] = useState<TabKey>("schedule");
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;

  return (
    <div className="page">
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
          {!isAssistant && <AssignClinicTaskForm />}
        </div>
      )}

      {activeTab === "records" && (
        <>
          {!isAssistant && <ClassRecordForm />}
          {(isAssistant || isAdminLike) && <AttendanceCheckForm />}
          {(isAssistant || isAdminLike) && <AssistantClinicForm role={role} />}
        </>
      )}
    </div>
  );
}
