"use client";

import { useEffect, useState } from "react";
import StudentPicker from "./StudentPicker";
import StaffPicker from "./StaffPicker";
import DailyBriefingPreviewModal from "./DailyBriefingPreviewModal";
import { todayKST as todayStr } from "@/lib/date";
import { stripClassSuffix } from "@/lib/format";

type ClassOption = { id: string; name: string };
type RosterStudent = { id: string; name: string };

const SUBJECT_OPTIONS = ["문법", "독해", "서술형", "구문", "듣기", "모의고사", "어법", "내신대비"];

function confirmSave() {
  return window.confirm("저장하시겠습니까?");
}

function ClassRecordForm() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [subjects, setSubjects] = useState<string[]>([]);
  const [progress, setProgress] = useState("");
  const [homework, setHomework] = useState("");
  const [nextAssignment, setNextAssignment] = useState("");
  const [notice, setNotice] = useState("");
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [perStudent, setPerStudent] = useState<
    Record<string, { vocabFail: boolean; homeworkIncomplete: boolean; absent: boolean }>
  >({});
  const [showPreview, setShowPreview] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/classes")
      .then((r) => r.json())
      .then((list: ClassOption[]) => {
        setClasses(list);
        if (list.length > 0) setClassId(list[0].id);
      });
  }, []);

  useEffect(() => {
    if (!classId) return;
    setLoadingRoster(true);
    fetch(`/api/students?classId=${classId}`)
      .then((r) => r.json())
      .then((list: RosterStudent[]) => {
        setRoster(list);
        setPerStudent(
          Object.fromEntries(
            list.map((s) => [s.id, { vocabFail: false, homeworkIncomplete: false, absent: false }])
          )
        );
      })
      .finally(() => setLoadingRoster(false));
  }, [classId]);

  function toggleSubject(name: string) {
    setSubjects((cur) => (cur.includes(name) ? cur.filter((s) => s !== name) : [...cur, name]));
  }

  function toggleFlag(studentId: string, key: "vocabFail" | "homeworkIncomplete" | "absent") {
    setPerStudent((cur) => ({
      ...cur,
      [studentId]: { ...cur[studentId], [key]: !cur[studentId]?.[key] },
    }));
  }

  function handleOpenPreview() {
    setDone(false);
    setError(null);
    setShowPreview(true);
  }

  async function actuallySave(briefingTexts?: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch("/api/class-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          date,
          subjects,
          progress,
          homework,
          nextAssignment,
          notice,
          perStudent,
          briefingTexts,
        }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? "저장에 실패했습니다." };
      setDone(true);
      setProgress("");
      setHomework("");
      setNextAssignment("");
      setNotice("");
      setSubjects([]);
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

  return (
    <>
      <form className="card" onSubmit={(e) => e.preventDefault()}>
        <h2>오늘 수업 기록</h2>

        <div className="class-record-layout">
          <div>
            <div className="field-row">
              <div>
                <label htmlFor="date">날짜</label>
                <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div>
                <label htmlFor="class">반</label>
                <select id="class" value={classId} onChange={(e) => setClassId(e.target.value)} required>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{stripClassSuffix(c.name)}</option>
                  ))}
                </select>
              </div>
            </div>

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

            {error && <p className="error-text">{error}</p>}
            {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button
                type="button"
                className="secondary"
                onClick={handleOpenPreview}
                disabled={!classId || roster.length === 0}
              >
                미리보기
              </button>
              <button
                type="button"
                onClick={handleDirectSave}
                disabled={!classId || roster.length === 0 || saving}
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>

          <div>
            <label>학생별 체크 ({selectedClassName || "반 선택"})</label>
            {loadingRoster && <p className="muted">명단 불러오는 중...</p>}
            {!loadingRoster && roster.length === 0 && <p className="muted">이 반에 등록된 학생이 없습니다.</p>}
            {!loadingRoster &&
              roster.map((s) => (
                <div key={s.id} className="roster-check-row">
                  <span>{s.name}</span>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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
                  </div>
                </div>
              ))}
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
            roster,
            perStudent,
          }}
          classes={classes}
          onClose={() => setShowPreview(false)}
          onSave={actuallySave}
        />
      )}
    </>
  );
}

function AdminInputForm() {
  const [type, setType] = useState("결석신고");
  const [studentId, setStudentId] = useState("");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAbsence = type === "결석신고";

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
      <h2>결석 / 긴급상담요청</h2>

      <label htmlFor="type">유형</label>
      <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="결석신고">결석신고</option>
        <option value="긴급상담요청">긴급상담요청</option>
      </select>

      <StudentPicker studentId={studentId} onChange={setStudentId} label="대상학생" />

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

function ScheduleEntryForm() {
  const [type, setType] = useState("보강");
  const [studentId, setStudentId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [owner, setOwner] = useState("");
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
      const res = await fetch("/api/schedule-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, studentId: studentId || null, date, time, note, ownerName: owner }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setDone(true);
      setTime("");
      setNote("");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>일정 등록</h2>
      <p className="muted">보강 / 재시 / 신입생상담 / 레벨체크 — 오늘 날짜면 대시보드 "오늘의 일정"에 표시됩니다.</p>

      <label htmlFor="scheduleType">유형</label>
      <select id="scheduleType" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="보강">보강</option>
        <option value="재시">재시</option>
        <option value="신입생상담">신입생상담</option>
        <option value="레벨체크">레벨체크</option>
      </select>

      <StudentPicker studentId={studentId} onChange={setStudentId} allowEmpty />

      <label htmlFor="scheduleDate">날짜</label>
      <input id="scheduleDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />

      <label htmlFor="scheduleTime">시간</label>
      <input id="scheduleTime" type="text" placeholder="예: 16:30" value={time} onChange={(e) => setTime(e.target.value)} />

      <StaffPicker value={owner} onChange={setOwner} label="담당자 (보강자/진행자)" />

      <label htmlFor="scheduleNote">메모</label>
      <textarea id="scheduleNote" value={note} onChange={(e) => setNote(e.target.value)} />

      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={saving}>
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
      <h2>상담일지 등록</h2>
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
      <h2>학생 정보 업데이트</h2>
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

export default function InputClient({ role }: { role: string | null }) {
  return (
    <div className="page">
      {role !== "행정" && <ClassRecordForm />}
      <div className="grid-3">
        <ScheduleEntryForm />
        <CounselingForm />
        <AdminInputForm />
        {role === "행정" && <StudentInfoForm />}
      </div>
    </div>
  );
}
