"use client";

import { useEffect, useState } from "react";

type StudentOption = { id: string; name: string; school: string; grade: string | null };

export default function StudentPicker({
  studentId,
  onChange,
  label = "학생 검색",
  allowEmpty = false,
}: {
  studentId: string;
  onChange: (id: string) => void;
  label?: string;
  allowEmpty?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<StudentOption[]>([]);

  useEffect(() => {
    const handle = setTimeout(() => {
      fetch(`/api/students?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((list: StudentOption[]) => setOptions(list));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <>
      <label>{label}</label>
      <input
        type="text"
        placeholder="이름으로 검색 (동명이인은 학교/학년으로 구분)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <select style={{ marginTop: 8 }} value={studentId} onChange={(e) => onChange(e.target.value)}>
        {allowEmpty && <option value="">선택 안 함</option>}
        {!allowEmpty && <option value="">학생을 선택하세요</option>}
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.school || "학교미상"} {s.grade || ""})
          </option>
        ))}
      </select>
    </>
  );
}
