"use client";

import { useEffect, useState } from "react";

type ClassOption = { id: string; name: string };
type StudentOption = { id: string; name: string };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

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

export default function InputClient() {
  return (
    <div className="page">
      <div className="grid-2">
        <ClassRecordForm />
        <AdminInputForm />
      </div>
    </div>
  );
}
