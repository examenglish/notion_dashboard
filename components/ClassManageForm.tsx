"use client";

import { useEffect, useState } from "react";
import { stripClassSuffix, parseWorkHours, WEEKDAYS, type WorkHours, type DayTeachers } from "@/lib/format";
import TeacherMultiSelect from "./TeacherMultiSelect";

type ClassFull = {
  id: string;
  name: string;
  teachers: string[];
  dayTeachers: DayTeachers;
  days: string[];
  time: string;
  level: string | null;
  type: string;
  studentIds: string[];
};

const MAX_TEACHERS = 3;

const LEVEL_OPTIONS = ["초등", "중등", "고등"];
const TYPE_OPTIONS = ["정규", "시험대비"];

function confirmSave() {
  return window.confirm("저장하시겠습니까?");
}

// "17:00-19:00" 같은 옛 방식(요일 전체 공통 시간) 문자열을 시작/종료로 쪼갠다.
function splitFlatTime(raw: string): { start: string; end: string } {
  const dash = raw.indexOf("-");
  if (dash < 0) return { start: raw.trim(), end: "" };
  return { start: raw.slice(0, dash).trim(), end: raw.slice(dash + 1).trim() };
}

// 반의 "시간"을 요일별 WorkHours로 풀어준다. 이미 요일별 포맷("월=17:00-19:00;...")
// 이면 그대로 파싱하고, 아직 옛 방식(요일 전체 공통 시간 하나)이면 등록된
// 요일마다 같은 시간을 채워 넣어 편집 화면에서 이어서 요일별로 나눠 쓸 수 있게 한다.
function dayHoursFromClass(cls: ClassFull): WorkHours {
  const structured = parseWorkHours(cls.time);
  if (Object.keys(structured).length > 0) return structured;
  if (!cls.time) return {};
  const flat = splitFlatTime(cls.time);
  const seeded: WorkHours = {};
  for (const d of cls.days) seeded[d] = { ...flat };
  return seeded;
}

// 반 신설과 반명 변경(및 담당교사/요일/시간/레벨 수정)을 한 화면에서 처리.
// 반을 고르면 기존 정보를 불러와 수정 모드가 되고, "새 반 추가"를 고르면
// 빈 폼에서 새 반을 만든다. 반이름(title)만 바뀌어도 소속학생 등 relation은
// 페이지 id로 연결되어 있어 끊어지지 않는다.
export default function ClassManageForm() {
  const [classes, setClasses] = useState<ClassFull[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [teachers, setTeachers] = useState<string[]>([]);
  const [dayHours, setDayHours] = useState<WorkHours>({});
  const [dayTeachers, setDayTeachers] = useState<DayTeachers>({});
  const [level, setLevel] = useState("");
  const [classType, setClassType] = useState("정규");
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
      setTeachers([]);
      setDayHours({});
      setDayTeachers({});
      setLevel("");
      setClassType("정규");
      setDone(false);
      return;
    }
    const cls = classes.find((c) => c.id === selectedId);
    if (cls) {
      setName(stripClassSuffix(cls.name));
      setTeachers(cls.teachers);
      setDayHours(dayHoursFromClass(cls));
      setDayTeachers(cls.dayTeachers);
      setLevel(cls.level ?? "");
      setClassType(cls.type || "정규");
    }
    setDone(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function toggleDay(d: string) {
    setDayHours((cur) => {
      if (cur[d]) {
        const next = { ...cur };
        delete next[d];
        return next;
      }
      return { ...cur, [d]: { start: "", end: "" } };
    });
    // 요일을 끄면 그 요일에 지정해둔 담당교사도 함께 지운다 — 꺼진 요일에
    // 고아 상태로 남아있으면 다시 켰을 때 예전 지정이 그대로 되살아나
    // 헷갈릴 수 있다.
    setDayTeachers((cur) => {
      if (!cur[d]) return cur;
      const next = { ...cur };
      delete next[d];
      return next;
    });
  }

  function setDayField(d: string, field: "start" | "end", value: string) {
    setDayHours((cur) => ({ ...cur, [d]: { ...cur[d], [field]: value } }));
  }

  // 반 전체 담당교사 목록이 바뀌면(예: 3명 중 1명을 뺌), 요일·교시별 지정에만
  // 남아있는 이름을 함께 정리한다 — 더는 반 담당교사가 아닌 사람이 특정
  // 교시 담당자로 남아있는 상태를 막기 위함.
  useEffect(() => {
    setDayTeachers((cur) => {
      let changed = false;
      const next: DayTeachers = {};
      for (const [day, periods] of Object.entries(cur)) {
        const kept: Record<string, string> = {};
        for (const [period, name] of Object.entries(periods)) {
          if (teachers.includes(name)) kept[period] = name;
          else changed = true;
        }
        if (Object.keys(kept).length > 0) next[day] = kept;
        else if (Object.keys(periods).length > 0) changed = true;
      }
      return changed ? next : cur;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teachers]);

  // period: "1"|"2"|"3" (1~3교시). teacherName이 빈 문자열이면 "미지정"으로
  // 처리해 그 교시 지정을 지운다.
  function setDayPeriodTeacher(day: string, period: string, teacherName: string) {
    setDayTeachers((cur) => {
      const periods = { ...(cur[day] ?? {}) };
      if (teacherName) periods[period] = teacherName;
      else delete periods[period];
      if (Object.keys(periods).length === 0) {
        const copy = { ...cur };
        delete copy[day];
        return copy;
      }
      return { ...cur, [day]: periods };
    });
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
        body: JSON.stringify({ name, teachers, dayHours, dayTeachers, level, type: classType }),
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

  async function handleDelete() {
    if (!selectedId) return;
    if (!window.confirm("이 반을 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;
    setError(null);
    setSaving(true);
    setDone(false);
    try {
      const res = await fetch(`/api/classes/${selectedId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "삭제에 실패했습니다.");
        return;
      }
      setSelectedId("");
      loadClasses();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const selectedClass = classes.find((c) => c.id === selectedId);
  const canDelete = !!selectedClass && selectedClass.studentIds.length === 0;

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>반 관리 <span className="title-lab-tag">(실험실)</span></h2>
      <p className="muted">반을 선택하면 반명을 포함해 정보를 수정할 수 있고, "새 반 추가"를 선택하면 새로 만듭니다.</p>

      <label htmlFor="classSelect">반 선택</label>
      <select id="classSelect" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
        <option value="">+ 새 반 추가</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.type === "시험대비" ? `[시험대비] ${stripClassSuffix(c.name)}` : stripClassSuffix(c.name)}
          </option>
        ))}
      </select>

      <label htmlFor="className">반이름</label>
      <input id="className" type="text" value={name} onChange={(e) => setName(e.target.value)} required />

      <label htmlFor="classType">구분</label>
      <select id="classType" value={classType} onChange={(e) => setClassType(e.target.value)}>
        {TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {classType === "시험대비" && (
        <p className="muted" style={{ marginTop: 2 }}>
          시험대비반은 평소 수업기록/출결체크 화면의 반 목록에서 기본적으로 숨겨지고("시험대비반 포함" 체크 시에만
          표시), 학생을 이 반에 추가해도 원래 소속반은 그대로 유지됩니다.
        </p>
      )}

      <TeacherMultiSelect selected={teachers} onChange={setTeachers} max={MAX_TEACHERS} roleFilter={["강사", "원장"]} />

      <label htmlFor="classLevel">레벨</label>
      <select id="classLevel" value={level} onChange={(e) => setLevel(e.target.value)}>
        <option value="">선택 안 함</option>
        {LEVEL_OPTIONS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>

      <label>요일별 시간</label>
      <p className="muted" style={{ marginTop: 2 }}>
        같은 반이라도 요일마다 시간이 다르면(예: 월 16~18시, 수 18~20시) 요일별로 따로 입력하세요.
        {teachers.length > 1 &&
          " 같은 요일 안에서도 1·2·3교시마다 담당교사가 다르면 시간 아래에서 교시별로 골라주세요(비워두면 전체 담당교사 모두로 처리)."}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
        {WEEKDAYS.map((d) => {
          const enabled = !!dayHours[d];
          return (
            <div key={d} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, margin: 0, width: 48 }}>
                  <input type="checkbox" checked={enabled} onChange={() => toggleDay(d)} />
                  {d}
                </label>
                {enabled && (
                  <>
                    <input
                      type="text"
                      value={dayHours[d]?.start ?? ""}
                      onChange={(e) => setDayField(d, "start", e.target.value)}
                      placeholder="시작 예: 17:00"
                      style={{ maxWidth: 120 }}
                    />
                    <span className="muted">~</span>
                    <input
                      type="text"
                      value={dayHours[d]?.end ?? ""}
                      onChange={(e) => setDayField(d, "end", e.target.value)}
                      placeholder="종료 예: 19:00"
                      style={{ maxWidth: 120 }}
                    />
                  </>
                )}
              </div>
              {enabled && teachers.length > 1 && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginLeft: 58 }}>
                  {["1", "2", "3"].map((period) => (
                    <label key={period} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, margin: 0 }}>
                      {period}교시
                      <select
                        value={dayTeachers[d]?.[period] ?? ""}
                        onChange={(e) => setDayPeriodTeacher(d, period, e.target.value)}
                        style={{ fontSize: 12, padding: "2px 4px" }}
                      >
                        <option value="">미지정</option>
                        {teachers.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-box" style={{ marginTop: 12 }}>저장됐습니다.</p>}

      <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
        <button type="submit" disabled={saving || !name.trim()}>
          {saving ? "저장 중..." : selectedId ? "수정 저장" : "반 추가"}
        </button>
        {selectedId && (
          <button
            type="button"
            className="secondary"
            disabled={saving || !canDelete}
            title={canDelete ? undefined : "소속 학생이 있는 반은 삭제할 수 없습니다."}
            onClick={handleDelete}
          >
            반 삭제
          </button>
        )}
      </div>
    </form>
  );
}
