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
  studentId: string | null;
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
export default function AssistantClinicForm({ role }: { role?: string | null } = {}) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);

  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [studentPickerId, setStudentPickerId] = useState("");
  const [studentNames, setStudentNames] = useState<Record<string, string>>({});
  const [teacher, setTeacher] = useState("");
  // StaffPicker의 onChange는 이름 문자열만 넘겨준다(다른 모든 화면에서
  // 담당자/상담자를 텍스트 필드로 저장하는 것과 같은 계약). 하지만 여기
  // 담당강사는 Notion에서 진짜 relation 필드라서 이름이 아니라 페이지 ID가
  // 필요하다 — 그래서 이름→ID 매핑을 따로 들고 있다가 제출 시점에 바꿔치기한다.
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>([]);
  const [date, setDate] = useState(todayKST());
  const [content, setContent] = useState("");
  const [nextPrep, setNextPrep] = useState("");
  // 강사/원장이 "조교 클리닉 지시"로 배정한 오늘의 할일 중 하나를 이 보고와
  // 연결하면, 저장 시 그 할일이 자동 완료 처리되고 지시자가 지시-보고를
  // 나란히 비교할 수 있게 된다. 비워두면 지시받지 않은 자율 클리닉으로 남는다.
  const [relatedTaskId, setRelatedTaskId] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 방금 저장한 클리닉 기록도 여기서 바로 고쳐 쓸 수 있어야 한다 — 조교가
  // 빠르게 여러 건을 연달아 입력하다 보면 오타나 누락을 그 자리에서 바로잡고
  // 싶을 때가 많은데, 지금까지는 "최근 내 클리닉 기록" 목록이 읽기 전용이라
  // 학생별 전체기록 화면까지 가야만 수정할 수 있었다.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editNextPrep, setEditNextPrep] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const canDelete = role === "원장";

  function loadBrief() {
    fetch("/api/assistant-brief")
      .then((r) => r.json())
      .then((data) => setBrief(data && !data.error ? data : null))
      .catch(() => setBrief(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadBrief();
    fetch("/api/staff")
      .then((r) => r.json())
      .then((list: { id: string; name: string }[]) => setStaffList(list))
      .catch(() => setStaffList([]));
  }, []);

  function addStudent(id: string) {
    if (!id || studentIds.includes(id)) {
      setStudentPickerId("");
      return;
    }
    fetch(`/api/students/${id}`)
      .then((r) => r.json())
      .then((data: { student?: { id: string; name: string }; error?: string }) => {
        if (!data.student) {
          setError(data.error ?? "학생을 불러오지 못했습니다. 다시 시도해주세요.");
          return;
        }
        setStudentIds((cur) => [...cur, data.student!.id]);
        setStudentNames((cur) => ({ ...cur, [data.student!.id]: data.student!.name }));
      })
      .catch(() => setError("네트워크 오류로 학생을 추가하지 못했습니다."));
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
    // teacher는 StaffPicker가 준 "이름" 문자열이다 — 담당강사는 Notion relation이라
    // 실제 페이지 ID가 필요하므로 목록에서 이름이 일치하는 스태프를 찾아 ID로
    // 바꿔 보낸다. 목록에 없는 이름(오타 등)을 그대로 보내면 Notion이 잘못된
    // relation ID로 저장을 거부해 "저장에 실패했습니다"만 뜨고 원인을 알 수
    // 없었다 — 그 전에 여기서 걸러서 알려준다.
    const teacherId = teacher ? staffList.find((s) => s.name === teacher)?.id : undefined;
    if (teacher && !teacherId) {
      setError("담당 강사 이름이 목록에 없습니다. 검색 결과에서 선택해주세요.");
      return;
    }
    if (!confirmSave()) return;
    setError(null);
    setSaving(true);
    setDone(false);
    try {
      const res = await fetch("/api/clinic-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds, teacherId, date, content, nextPrep, relatedTaskId: relatedTaskId || undefined }),
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
      setRelatedTaskId("");
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

  function linkTask(t: TodayTask) {
    setRelatedTaskId(t.id);
    if (t.studentId && !studentIds.includes(t.studentId)) {
      setStudentIds((cur) => [...cur, t.studentId as string]);
      setStudentNames((cur) => ({ ...cur, [t.studentId as string]: t.studentName }));
    }
  }

  function startEdit(c: ClinicHistoryItem) {
    setEditingId(c.id);
    setEditContent(c.content);
    setEditNextPrep(c.nextPrep);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(id: string) {
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/clinic-records/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent, nextPrep: editNextPrep }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(data.error ?? "수정에 실패했습니다.");
        return;
      }
      setEditingId(null);
      loadBrief();
    } catch {
      setEditError("네트워크 오류가 발생했습니다.");
    } finally {
      setEditSaving(false);
    }
  }

  async function deleteRecord(id: string) {
    if (!window.confirm("이 클리닉 기록을 삭제하시겠습니까?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/clinic-records/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(data.error ?? "삭제에 실패했습니다.");
        return;
      }
      loadBrief();
    } catch {
      setEditError("네트워크 오류가 발생했습니다.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="card">
        <h2>오늘 할 일 <span className="title-lab-tag">(실험실)</span></h2>
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
                {t.type === "클리닉" && !t.done && (
                  <button
                    type="button"
                    className="secondary"
                    style={{ padding: "2px 8px", fontSize: 12, marginLeft: 28, marginTop: 4 }}
                    disabled={relatedTaskId === t.id}
                    onClick={() => linkTask(t)}
                  >
                    {relatedTaskId === t.id ? "아래에 연결됨" : "이 지시로 보고 작성"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>다음 준비사항 <span className="title-lab-tag">(실험실)</span></h2>
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
        <h2>클리닉 기록 작성 <span className="title-lab-tag">(실험실)</span></h2>
        <p className="muted">이번 클리닉 시간에 지도한 학생, 진행 내용, 다음 준비사항을 남겨주세요.</p>

        {relatedTaskId ? (
          <p className="muted" style={{ marginBottom: 12 }}>
            "오늘 할 일"의 지시사항과 연결됩니다 — 저장하면 그 할일도 자동으로 완료 처리됩니다.{" "}
            <button type="button" className="secondary" style={{ padding: "0 6px", fontSize: 12 }} onClick={() => setRelatedTaskId("")}>
              연결 해제
            </button>
          </p>
        ) : (
          <p className="muted" style={{ marginBottom: 12 }}>
            지시받은 클리닉이 아니라면 그대로 두세요 — 자율적으로 진행한 클리닉으로 기록됩니다.
          </p>
        )}

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
          <h2>최근 내 클리닉 기록 <span className="title-lab-tag">(실험실)</span></h2>
          {editError && <p className="error-text">{editError}</p>}
          <ul className="schedule-list">
            {brief.recentClinic.map((c) =>
              editingId === c.id ? (
                <li key={c.id}>
                  <strong>{c.date ?? "-"}</strong> <span className="muted">{c.studentNames.join(", ")}</span>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    placeholder="진행 내용"
                    style={{ minHeight: 60, marginTop: 4 }}
                  />
                  <textarea
                    value={editNextPrep}
                    onChange={(e) => setEditNextPrep(e.target.value)}
                    placeholder="다음 준비사항"
                    style={{ minHeight: 40, marginTop: 4 }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <button type="button" disabled={editSaving} onClick={() => saveEdit(c.id)}>
                      {editSaving ? "저장 중..." : "저장"}
                    </button>
                    <button type="button" className="secondary" onClick={cancelEdit}>취소</button>
                  </div>
                </li>
              ) : (
                <li key={c.id}>
                  <strong>{c.date ?? "-"}</strong> <span className="muted">{c.studentNames.join(", ")}</span>
                  <span style={{ display: "inline-flex", gap: 6, marginLeft: 8 }}>
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: "2px 8px", fontSize: 12 }}
                      onClick={() => startEdit(c)}
                    >
                      수정
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        className="secondary"
                        style={{ padding: "2px 8px", fontSize: 12 }}
                        disabled={deletingId === c.id}
                        onClick={() => deleteRecord(c.id)}
                      >
                        {deletingId === c.id ? "삭제 중..." : "삭제"}
                      </button>
                    )}
                  </span>
                  <br />
                  {c.content}
                  {c.nextPrep && <div className="muted">다음: {c.nextPrep}</div>}
                </li>
              )
            )}
          </ul>
        </div>
      )}
    </>
  );
}
