"use client";

import { useEffect, useState } from "react";

type StaffOption = { id: string; name: string; role: string | null };

// 담당교사 복수선택 — 태그 클릭으로 토글, 검색으로 좁혀볼 수 있다.
// max를 주면 그 이상은 새로 선택할 수 없다(이미 선택된 항목 해제는 항상 가능).
export default function TeacherMultiSelect({
  selected,
  onChange,
  max,
  roleFilter,
}: {
  selected: string[];
  onChange: (names: string[]) => void;
  max?: number;
  roleFilter?: string;
}) {
  const [allStaff, setAllStaff] = useState<StaffOption[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/staff")
      .then((r) => r.json())
      .then(setAllStaff);
  }, []);

  function toggle(name: string) {
    if (selected.includes(name)) {
      onChange(selected.filter((n) => n !== name));
      return;
    }
    if (max && selected.length >= max) return;
    onChange([...selected, name]);
  }

  const byRole = roleFilter ? allStaff.filter((s) => s.role === roleFilter) : allStaff;
  const filtered = byRole.filter((s) => s.name.includes(query));
  const atMax = !!max && selected.length >= max;

  return (
    <div>
      <label>담당교사 ({max ? `최대 ${max}명` : "복수선택 가능"})</label>
      <input
        type="text"
        placeholder="이름으로 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 6 }}
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {filtered.map((s) => {
          const active = selected.includes(s.name);
          const disabled = !active && atMax;
          return (
            <label
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 13,
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "4px 10px",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.5 : 1,
                background: active ? "var(--primary)" : "transparent",
                color: active ? "#fff" : "inherit",
              }}
            >
              <input
                type="checkbox"
                checked={active}
                disabled={disabled}
                onChange={() => toggle(s.name)}
                style={{ display: "none" }}
              />
              {s.name}
            </label>
          );
        })}
        {filtered.length === 0 && <span className="muted" style={{ fontSize: 12 }}>검색 결과가 없습니다.</span>}
      </div>
    </div>
  );
}
