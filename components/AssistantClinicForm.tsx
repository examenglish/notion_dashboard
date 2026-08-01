"use client";

import { useEffect, useState } from "react";
import StudentPicker from "./StudentPicker";
import StaffPicker from "./StaffPicker";
import { todayKST } from "@/lib/date";

type TodayTask = {
  id: string;
  title: string;
  type: string | null;
  time: string;
  studentName: string;
  memo: string;
  done: boolean;
};
type PrepItem = { studentName: string; date: string | null; content: string };
type ClinicHistoryItem = { id: string; date: string | null; studentNames: string[]; content: string; nextPrep: string };
type MyClass = { id: string; name: string; students: { id: string; name: string }[] };

type Brief = { todayTasks: TodayTask[]; upcomingPrep: PrepItem[]; myClasses: MyClass[]; recentClinic: ClinicHistoryItem[] };

function confirmSave() {
  return window.confirm("저장하시겠습니까?");
}

// 조교 전용 입력 화면 — 강사의 "오늘 수업 기록" 대신, 코칭/클리닉 업무에 맞춰
// (1) 오늘 배정된 일 확인, (2) 직전 클리닉에서 남긴 다음 준비사항 확인,
// (3) 방금 진행한 클리닉 세션 기록 작성을 한 곳에서 처리한다.
export default function AssistantClinicForm() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);

  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [studentPickerId, setStudentPickerId] = useState("");
  const [studentNames, setStudentNames] = useState<Record<string, string>>({});
  const [teacher, setTeacher] = useState("");
  const [date, setDate] = useState(todayKST());
  const [content, setContent] = useState("");
  const [nextPrep, setNextPrep] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadBrief() {
    fetch("/api/assistant-brief")
      .then((r) => r.json())
      .then(setBrief)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadBrief();
  }, []);

  function addStudent(id: string) {
    if (!id || studentIds.includes(id)) {
      setStudentPickerId("");
      return;
    }
    fetch(`/api/students/${id}`)
      .then((r) => r.json())
      .then((data: { student: { id: string; name: string } }) => {
        setStudentIds((cur) => [...cur, data.student.id]);
        setStudentNames((cur) => ({ ...cur, [data.student.id]: data.student.name }));
      });
    setStudentPickerId("");
  }

  function removeStudent(id: string) {
    setStudentIds((cur) => cur.filter((s) => s !== id));
  }

  // 반별로 배정받은 담당반의 학생 전체를 한 번에 담당 학생 목록에 추가 —
  // 매번 한 명씩 검색해서 고르지 않아도 되도록.
  function addClassRoster(cls: MyClass) {
    setStudentIds((cur) => Array.from(new Set([...cur, ...cls.students.map((s) => s.id)])));
    setStudentNames((cur) => {
      const next = { ...cur };
      for (const s of cls.students) next[s.id] = s.name;
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmSave()) return;
    setError(null);
    setSaving(true);
    setDone(false);
    try {
      const res = await fetch("/api/clinic-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds, teacherId: teacher || undefined, date, content, nextPrep }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setDone(true);
      setStudentIds([]);
      setStudentNames({});
      setContent("");
      setNextPrep("");
      loadBrief();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleTaskDone(taskId: string) {
    await fetch(`/api/schedule-entry/${taskId}`, { method: "PATCH" });
    loadBrief();
  }

  return (
    <>
      <div className="card">
        <h2>오늘 할 일</h2>
        {loading && <p className="muted">불러오는 중...</p>}
        {!loading && (!brief || brief.todayTasks.length === 0) && (
          <p className="muted">오늘 배정된 일정이 없습니다.</p>
        )}
        {!loading && brief && brief.todayTasks.length > 0 && (
          <ul className="schedule-list">
            {brief.todayTasks.map((t) => (
              <li key={t.id}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 6,
                    margin: 0,
                    cursor: t.done ? "default" : "pointer",
                    textDecoration: t.done ? "line-through" : "none",
                    opacity: t.done ? 0.6 : 1,
                  }}
                >
                  <input type="checkbox" checked={t.done} disabled={t.done} onChange={() => toggleTaskDone(t.id)} />
                  <span className="badge">{t.type ?? "-"}</span>
                  <strong>{t.studentName}</strong>
                  <span className="muted">{t.time || "시간 미정"}</span>
                  {t.memo && <span className="muted schedule-item-memo">· {t.memo}</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>다음 준비사항</h2>
        <p className="muted">직전 클리닉 기록에 남긴 학생별 준비사항입니다.</p>
        {!loading && (!brief || brief.upcomingPrep.length === 0) && <p className="muted">준비사항이 없습니다.</p>}
        {!loading && brief && brief.upcomingPrep.length > 0 && (
          <ul className="schedule-list">
            {brief.upcomingPrep.map((p, i) => (
              <li key={i}>
                <strong>{p.studentName}</strong> <span className="muted">({p.date ?? "-"})</span>
                <br />
                {p.content}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form className="card" onSubmit={handleSubmit}>
        <h2>클리닉 기록 작성</h2>
        <p className="muted">이번 클리닉 시간에 지도한 학생, 진행 내용, 다음 준비사항을 남겨주세요.</p>

        {brief && brief.myClasses.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <label>내 담당반 (클릭하면 명단 전체 추가)</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {brief.myClasses.map((cls) => (
                <button
                  key={cls.id}
                  type="button"
                  className="secondary"
                  onClick={() => addClassRoster(cls)}
                >
                  {cls.name} ({cls.students.length}명)
                </button>
              ))}
            </div>
          </div>
        )}

        <label>담당 학생 (여러 명 선택 가능)</label>
        <StudentPicker studentId={studentPickerId} onChange={addStudent} label="" />
        {studentIds.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "6px 0 12px" }}>
            {studentIds.map((id) => (
              <span key={id} className="badge" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {studentNames[id] ?? id}
                <button
                  type="button"
                  className="secondary"
                  style={{ padding: "0 4px", fontSize: 11 }}
                  onClick={() => removeStudent(id)}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="field-row">
          <div>
            <label htmlFor="clinicDate">날짜</label>
            <input id="clinicDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <StaffPicker value={teacher} onChange={setTeacher} label="담당 강사 (검토 요청)" />
        </div>

        <label htmlFor="clinicContent">진행 내용 (학습/코칭 내용)</label>
        <textarea
          id="clinicContent"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          style={{ minHeight: 100 }}
        />

        <label htmlFor="clinicNextPrep">다음 준비사항 (다음 클리닉 때 준비할 것)</label>
        <textarea id="clinicNextPrep" value={nextPrep} onChange={(e) => setNextPrep(e.target.value)} />

        {error && <p className="error-text">{error}</p>}
        {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

        <div style={{ marginTop: 16 }}>
          <button type="submit" disabled={saving || studentIds.length === 0 || !content}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>

      {brief && brief.recentClinic.length > 0 && (
        <div className="card">
          <h2>최근 내 클리닉 기록</h2>
          <ul className="schedule-list">
            {brief.recentClinic.map((c) => (
              <li key={c.id}>
                <strong>{c.date ?? "-"}</strong> <span className="muted">{c.studentNames.join(", ")}</span>
                <br />
                {c.content}
                {c.nextPrep && <div className="muted">다음: {c.nextPrep}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
