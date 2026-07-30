"use client";

import { useEffect, useRef, useState } from "react";

type StaffOption = { id: string; name: string };

export default function StaffPicker({
  value,
  onChange,
  label = "상담자",
}: {
  value: string;
  onChange: (name: string) => void;
  label?: string;
}) {
  const [text, setText] = useState(value);
  const [allStaff, setAllStaff] = useState<StaffOption[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/staff")
      .then((r) => r.json())
      .then((list: StaffOption[]) => setAllStaff(list));
  }, []);

  useEffect(() => {
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
  }, []);

  const options = allStaff.filter((s) => s.name.includes(text));

  function select(s: StaffOption) {
    setText(s.name);
    onChange(s.name);
    setOpen(false);
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
      select(options[highlight]);
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
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {open && options.length > 0 && (
        <div className="autocomplete-list">
          {options.map((s, i) => (
            <div
              key={s.id}
              className={`autocomplete-item ${i === highlight ? "active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                select(s);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {s.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
