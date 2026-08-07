"use client";

import { useEffect, useState } from "react";
import { stripClassSuffix } from "@/lib/format";

type ClassOption = { id: string; name: string };

const GRADE_OPTIONS = ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"];
const STATUS_OPTIONS = ["재원", "대기생", "휴원", "퇴원"];

// 학생레벨 화면에서 이름을 클릭하면 뜨는 가벼운 등록정보 수정 팝업 —
// 입력 페이지의 "학생 등록" 폼과 같은 /api/students/[id] PATCH를 쓰므로
// 어디서 고치든 항상 같은 곳(DB②학생마스터)에 저장돼 서로 어긋나지 않는다.
export default function StudentEditModal({
  studentId,
  onClose,
  onSaved,
}: {
  studentId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [grade, setGrade] = useState("");
  const [status, setStatus] = useState("재원");
  const [phone, setPhone] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [enrolledAt, setEnrolledAt] = useState("");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/students/${studentId}`).then((r) => r.json()),
      fetch("/api/classes").then((r) => r.json()),
    ]).then(([data, classList]) => {
      if (cancelled) return;
      const s = data.student;
      setName(s.name ?? "");
      setSchool(s.school ?? "");
      setGrade(s.grade ?? "");
      setStatus(s.status ?? "재원");
      setPhone(s.phone ?? "");
      setParentPhone(s.parentPhone ?? "");
      setEnrolledAt(s.enrolledAt ?? "");
      setClassIds(s.classIds ?? []);
      setMemo(s.memo ?? "");
      setClasses(classList);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  function toggleClass(id: string) {
    setClassIds((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]));
  }

  async function handleSave() {
    if (!window.confirm("수정하시겠습니까?")) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/students/${studentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, school, grade, status, phone, parentPhone, enrolledAt, classIds, memo }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{name || "학생"} 정보 수정</h2>
          <button type="button" className="secondary" onClick={onClose}>닫기</button>
        </div>

        {loading ? (
          <p className="muted">불러오는 중...</p>
        ) : (
          <>
            <div className="field-row">
              <div>
                <label htmlFor="editLvName">이름</label>
                <input id="editLvName" type="text" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="editLvStatus">상태</label>
                <select id="editLvStatus" value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field-row">
              <div>
                <label htmlFor="editLvSchool">학교</label>
                <input id="editLvSchool" type="text" value={school} onChange={(e) => setSchool(e.target.value)} />
              </div>
              <div>
                <label htmlFor="editLvGrade">학년</label>
                <select id="editLvGrade" value={grade} onChange={(e) => setGrade(e.target.value)}>
                  <option value="">선택 안 함</option>
                  {GRADE_OPTIONS.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field-row">
              <div>
                <label htmlFor="editLvPhone">학생 연락처</label>
                <input id="editLvPhone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" />
              </div>
              <div>
                <label htmlFor="editLvParentPhone">학부모 연락처</label>
                <input
                  id="editLvParentPhone"
                  type="tel"
                  value={parentPhone}
                  onChange={(e) => setParentPhone(e.target.value)}
                  placeholder="010-0000-0000"
                />
              </div>
            </div>

            <label htmlFor="editLvEnrolledAt">등원일</label>
            <input id="editLvEnrolledAt" type="date" value={enrolledAt} onChange={(e) => setEnrolledAt(e.target.value)} />

            <label>소속반 (복수 선택 가능)</label>
            <div className="class-checkbox-grid">
              {classes.map((c) => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, margin: 0 }}>
                  <input type="checkbox" checked={classIds.includes(c.id)} onChange={() => toggleClass(c.id)} />
                  {stripClassSuffix(c.name)}
                </label>
              ))}
            </div>

            <label htmlFor="editLvMemo">메모</label>
            <textarea id="editLvMemo" value={memo} onChange={(e) => setMemo(e.target.value)} />

            {error && <p className="error-text">{error}</p>}

            <div style={{ marginTop: 16 }}>
              <button type="button" disabled={saving} onClick={handleSave}>
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
