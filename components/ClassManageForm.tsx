"use client";

import { useEffect, useState } from "react";
import { stripClassSuffix } from "@/lib/format";

type ClassFull = { id: string; name: string; teacher: string; days: string[]; time: string; level: string | null };

const DAY_OPTIONS = ["월", "화", "수", "목", "금", "토", "일"];
const LEVEL_OPTIONS = ["초등", "중등", "고등"];

function confirmSave() {
  return window.confirm("저장하시겠습니까?");
}

// 반 신설과 반명 변경(및 담당교사/요일/시간/레벨 수정)을 한 화면에서 처리.
// 반을 고르면 기존 정보를 불러와 수정 모드가 되고, "새 반 추가"를 고르면
// 빈 폼에서 새 반을 만든다. 반이름(title)만 바뀌어도 소속학생 등 relation은
// 페이지 id로 연결되어 있어 끊어지지 않는다.
export default function ClassManageForm() {
  const [classes, setClasses] = useState<ClassFull[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [teacher, setTeacher] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [time, setTime] = useState("");
  const [level, setLevel] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadClasses() {
    fetch("/api/classes")
      .then((r) => r.json())
      .then(setClasses);
  }

  useEffect(() => {
    loadClasses();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setName("");
      setTeacher("");
      setDays([]);
      setTime("");
      setLevel("");
      setDone(false);
      return;
    }
    const cls = classes.find((c) => c.id === selectedId);
    if (cls) {
      setName(stripClassSuffix(cls.name));
      setTeacher(cls.teacher);
      setDays(cls.days);
      setTime(cls.time);
      setLevel(cls.level ?? "");
    }
    setDone(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function toggleDay(d: string) {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmSave()) return;
    setError(null);
    setSaving(true);
    setDone(false);
    try {
      const isEdit = !!selectedId;
      const res = await fetch(isEdit ? `/api/classes/${selectedId}` : "/api/classes", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, teacher, days, time, level }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      setDone(true);
      loadClasses();
      if (!isEdit && data.classId) setSelectedId(data.classId);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>반 관리 <span className="title-lab-tag">(실험실)</span></h2>
      <p className="muted">반을 선택하면 반명을 포함해 정보를 수정할 수 있고, "새 반 추가"를 선택하면 새로 만듭니다.</p>

      <label htmlFor="classSelect">반 선택</label>
      <select id="classSelect" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
        <option value="">+ 새 반 추가</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {stripClassSuffix(c.name)}
          </option>
        ))}
      </select>

      <label htmlFor="className">반이름</label>
      <input id="className" type="text" value={name} onChange={(e) => setName(e.target.value)} required />

      <div className="field-row">
        <div>
          <label htmlFor="classTeacher">담당교사</label>
          <input id="classTeacher" type="text" value={teacher} onChange={(e) => setTeacher(e.target.value)} />
        </div>
        <div>
          <label htmlFor="classLevel">레벨</label>
          <select id="classLevel" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">선택 안 함</option>
            {LEVEL_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label>요일</label>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
        {DAY_OPTIONS.map((d) => (
          <label key={d} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, margin: 0 }}>
            <input type="checkbox" checked={days.includes(d)} onChange={() => toggleDay(d)} />
            {d}
          </label>
        ))}
      </div>

      <label htmlFor="classTime">시간</label>
      <input
        id="classTime"
        type="text"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        placeholder="예: 17:00-19:00"
      />

      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={saving || !name.trim()}>
          {saving ? "저장 중..." : selectedId ? "수정 저장" : "반 추가"}
        </button>
      </div>
    </form>
  );
}
