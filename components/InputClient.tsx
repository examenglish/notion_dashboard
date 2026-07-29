"use client";

import { useEffect, useState } from "react";
import StudentPicker from "./StudentPicker";
import { todayKST as todayStr } from "@/lib/date";

type ClassOption = { id: string; name: string };
type StudentOption = { id: string; name: string };

function ClassRecordForm() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [progress, setProgress] = useState("");
  const [homework, setHomework] = useState("");
  const [vocabRange, setVocabRange] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/classes")
      .then((r) => r.json())
      .then((list: ClassOption[]) => {
        setClasses(list);
        if (list.length > 0) setClassId(list[0].id);
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    setDone(false);
    try {
      const res = await fetch("/api/class-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, date, progress, homework, vocabRange, notes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setDone(true);
      setProgress("");
      setHomework("");
      setVocabRange("");
      setNotes("");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>오늘 수업 기록</h2>

      <label htmlFor="class">반</label>
      <select id="class" value={classId} onChange={(e) => setClassId(e.target.value)} required>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <label htmlFor="date">날짜</label>
      <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />

      <label htmlFor="progress">진도</label>
      <textarea id="progress" value={progress} onChange={(e) => setProgress(e.target.value)} required />

      <label htmlFor="homework">숙제</label>
      <textarea id="homework" value={homework} onChange={(e) => setHomework(e.target.value)} />

      <label htmlFor="vocab">단어시험범위</label>
      <input id="vocab" type="text" value={vocabRange} onChange={(e) => setVocabRange(e.target.value)} />

      <label htmlFor="notes">특이사항</label>
      <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />

      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={saving || !classId}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </form>
  );
}

function AdminInputForm() {
  const [type, setType] = useState("전달사항");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      fetch(`/api/students?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((list: StudentOption[]) => setOptions(list));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    setDone(false);
    try {
      const res = await fetch("/api/admin-input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, studentId: studentId || null, content }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setDone(true);
      setContent("");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>결석 / 전달사항</h2>

      <label htmlFor="type">유형</label>
      <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="결석신고">결석신고</option>
        <option value="전달사항">전달사항</option>
      </select>

      <label htmlFor="student-search">대상학생 검색</label>
      <input
        id="student-search"
        type="text"
        placeholder="학생 이름 입력"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <select
        style={{ marginTop: 8 }}
        value={studentId}
        onChange={(e) => setStudentId(e.target.value)}
      >
        <option value="">전체 / 특정 학생 없음</option>
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <label htmlFor="content">내용</label>
      <textarea id="content" value={content} onChange={(e) => setContent(e.target.value)} required />

      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={saving || !content}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </form>
  );
}

function StudentInfoForm() {
  const [studentId, setStudentId] = useState("");
  const [enrolledAt, setEnrolledAt] = useState("");
  const [tuitionDay, setTuitionDay] = useState("");
  const [learningLevel, setLearningLevel] = useState("");
  const [action, setAction] = useState("");
  const [actionAlarmDate, setActionAlarmDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    setDone(false);
    try {
      const res = await fetch("/api/student-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, enrolledAt, tuitionDay, learningLevel, action, actionAlarmDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setDone(true);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>학생 정보 업데이트</h2>
      <p className="muted">등원일 · 회비일 · 학습레벨 · 조치(알람) 입력</p>

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

      <label htmlFor="action">조치</label>
      <textarea id="action" value={action} onChange={(e) => setAction(e.target.value)} />

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

function ScheduleEntryForm() {
  const [type, setType] = useState("보강");
  const [studentId, setStudentId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    setDone(false);
    try {
      const res = await fetch("/api/schedule-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, studentId: studentId || null, date, time, note }),
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

      <label htmlFor="counselor">상담자</label>
      <input id="counselor" type="text" value={counselor} onChange={(e) => setCounselor(e.target.value)} />

      <label htmlFor="counselingDate">날짜</label>
      <input id="counselingDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />

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

export default function InputClient() {
  return (
    <div className="page">
      <div className="grid-2">
        <ClassRecordForm />
        <AdminInputForm />
        <StudentInfoForm />
        <ScheduleEntryForm />
        <CounselingForm />
      </div>
    </div>
  );
}
