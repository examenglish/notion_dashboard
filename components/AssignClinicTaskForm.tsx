"use client";

import { useEffect, useState } from "react";
import StudentPicker from "./StudentPicker";
import StaffPicker from "./StaffPicker";
import { todayKST } from "@/lib/date";
import { stripClassSuffix } from "@/lib/format";

type ClassOption = { id: string; name: string; studentIds: string[] };

function confirmSave() {
  return window.confirm("등록하시겠습니까?");
}

// 담당강사/원장/행정이 조교에게 "오늘/이날 클리닉 시간에 이 학생들을 봐줘,
// 이런 내용으로"를 명확하게 지시하는 전용 폼. 기존 "일정 등록"(ScheduleEntryForm)은
// 보강/재시/신입생상담/레벨체크 전용이라 클리닉 지시를 만들 방법이 아예 없었음.
// 학생별로 DB⑱할일관리에 유형="클리닉" 항목을 하나씩 만들어 기존 "오늘의 일정" /
// 조교의 "오늘 할 일"에 그대로 반영되게 한다.
export default function AssignClinicTaskForm() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [assistant, setAssistant] = useState("");
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [studentPickerId, setStudentPickerId] = useState("");
  const [studentNames, setStudentNames] = useState<Record<string, string>>({});
  const [classPickerId, setClassPickerId] = useState("");
  const [date, setDate] = useState(todayKST());
  const [time, setTime] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/classes")
      .then((r) => r.json())
      .then(setClasses);
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

  function addClassRoster(classId: string) {
    const cls = classes.find((c) => c.id === classId);
    setClassPickerId("");
    if (!cls) return;
    fetch(`/api/students?classId=${classId}`)
      .then((r) => r.json())
      .then((list: { id: string; name: string }[]) => {
        setStudentIds((cur) => Array.from(new Set([...cur, ...list.map((s) => s.id)])));
        setStudentNames((cur) => {
          const next = { ...cur };
          for (const s of list) next[s.id] = s.name;
          return next;
        });
      });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmSave()) return;
    setError(null);
    setSaving(true);
    setDone(false);
    try {
      const results = await Promise.all(
        studentIds.map((studentId) =>
          fetch("/api/schedule-entry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "클리닉",
              studentId,
              date,
              time,
              note: instructions,
              ownerName: assistant,
            }),
          })
        )
      );
      if (results.some((r) => !r.ok)) {
        setError("일부 항목 저장에 실패했습니다.");
        return;
      }
      setDone(true);
      setStudentIds([]);
      setStudentNames({});
      setInstructions("");
      setTime("");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>조교 클리닉 지시</h2>
      <p className="muted">담당 조교에게 클리닉 시간에 봐야 할 학생과 지시사항을 전달합니다. "오늘의 일정"과 조교의 "오늘 할 일"에 표시됩니다.</p>

      <StaffPicker value={assistant} onChange={setAssistant} label="담당 조교" />

      <label>반 선택해서 일괄 추가</label>
      <select
        value={classPickerId}
        onChange={(e) => (e.target.value ? addClassRoster(e.target.value) : setClassPickerId(""))}
      >
        <option value="">반 선택 (선택 시 명단 자동 추가)</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {stripClassSuffix(c.name)} ({c.studentIds.length}명)
          </option>
        ))}
      </select>

      <label style={{ marginTop: 12 }}>대상 학생 (여러 명 선택 가능)</label>
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
          <label htmlFor="clinicTaskDate">날짜</label>
          <input id="clinicTaskDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="clinicTaskTime">시간</label>
          <input
            id="clinicTaskTime"
            type="text"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="예: 17:00"
          />
        </div>
      </div>

      <label htmlFor="clinicTaskInstructions">지시사항 (무엇을 지도/코칭해야 하는지)</label>
      <textarea
        id="clinicTaskInstructions"
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        required
        style={{ minHeight: 90 }}
        placeholder="예: 3단원 문법 재점검, 단어 25개 재시험"
      />

      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={saving || studentIds.length === 0 || !assistant || !instructions.trim()}>
          {saving ? "저장 중..." : `${studentIds.length || ""}명에게 지시 등록`}
        </button>
      </div>
    </form>
  );
}
