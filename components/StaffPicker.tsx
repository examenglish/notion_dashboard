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
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // 모달처럼 스크롤 가능한 상자 안에서 열릴 때, 목록을 그 상자 기준
  // position:absolute로 띄우면 목록 높이만큼 상자의 스크롤 영역이 갑자기
  // 늘어나면서 스크롤바가 나타났다 사라지고 본문이 흔들려 항목을 클릭하기
  // 어려웠다. 뷰포트 기준 position:fixed로 띄우면 어느 조상의 스크롤
  // 영역에도 포함되지 않아 이 흔들림이 아예 생기지 않는다. 대신 스크롤이
  // 시작되면(모달이든 페이지든) 입력창과 어긋나므로 그냥 목록을 닫는다.
  useEffect(() => {
    if (!open) return;
    function close() {
      setOpen(false);
    }
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const options = allStaff.filter((s) => s.name.includes(text));

  function openDropdown() {
    const rect = inputRef.current?.getBoundingClientRect();
    if (rect) setDropdownPos({ top: rect.bottom, left: rect.left, width: rect.width });
    setOpen(true);
  }

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
        ref={inputRef}
        type="text"
        placeholder="이름을 입력하면 바로 목록이 뜹니다"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
          openDropdown();
          setHighlight(0);
        }}
        onFocus={openDropdown}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {open && options.length > 0 && dropdownPos && (
        <div
          className="autocomplete-list"
          style={{
            position: "fixed",
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            right: "auto",
          }}
        >
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
