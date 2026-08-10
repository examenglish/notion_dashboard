"use client";

import { useEffect, useRef, useState } from "react";

type StudentOption = { id: string; name: string; school: string; grade: string | null };

function displayLabel(s: StudentOption) {
  return `${s.name} (${s.school || "학교미상"} ${s.grade || ""})`.trim();
}

export default function StudentPicker({
  studentId,
  onChange,
  label = "학생 검색",
  allowEmpty = false,
  includeInactive = false,
}: {
  studentId: string;
  onChange: (id: string) => void;
  label?: string;
  allowEmpty?: boolean;
  // 퇴원/휴원 학생도 검색되게 한다 — 상태를 되돌려야 하는 학생 정보수정
  // 화면에서만 켠다. 기본은 꺼져 있어(모든 노출에서 제외) 다른 모든
  // StudentPicker는 자동으로 재원/대기생만 보여준다.
  includeInactive?: boolean;
}) {
  const [text, setText] = useState("");
  const [options, setOptions] = useState<StudentOption[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // If the parent clears the selection (e.g. after a successful save), clear the box too.
  useEffect(() => {
    if (!studentId) setText("");
  }, [studentId]);

  useEffect(() => {
    const handle = setTimeout(() => {
      fetch(`/api/students?q=${encodeURIComponent(text)}${includeInactive ? "&includeInactive=1" : ""}`)
        .then((r) => r.json())
        .then((list: StudentOption[]) => {
          setOptions(list);
          setHighlight(0);
        });
    }, 200);
    return () => clearTimeout(handle);
  }, [text, includeInactive]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function selectStudent(s: StudentOption) {
    onChange(s.id);
    setText(displayLabel(s));
    setOpen(false);
  }

  function handleInputChange(v: string) {
    setText(v);
    setOpen(true);
    if (studentId) onChange(""); // typing again invalidates the previous selection
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || options.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectStudent(options[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <label>{label}</label>
      <input
        type="text"
        placeholder="이름을 입력하면 바로 목록이 뜹니다"
        value={text}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {studentId && <p className="muted" style={{ margin: "4px 0 0" }}>선택됨: {text}</p>}
      {allowEmpty && studentId === "" && text === "" && (
        <p className="muted" style={{ margin: "4px 0 0" }}>비워두면 특정 학생 없이 저장됩니다.</p>
      )}
      {open && options.length > 0 && (
        <div className="autocomplete-list">
          {options.map((s, i) => (
            <div
              key={s.id}
              className={`autocomplete-item ${i === highlight ? "active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectStudent(s);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {displayLabel(s)}
            </div>
          ))}
        </div>
      )}
      {open && text && options.length === 0 && (
        <div className="autocomplete-list">
          <div className="autocomplete-empty">검색 결과가 없습니다.</div>
        </div>
      )}
    </div>
  );
}
