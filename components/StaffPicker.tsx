"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkHours } from "@/lib/format";

type StaffOption = { id: string; name: string; workHours?: WorkHours };

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"]; // Date#getDay(): 0=일 ... 6=토

function dayLabelFor(dateStr: string): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return DAY_LABELS[d.getDay()];
}

// 근무시간표가 아예 설정 안 된 직원(대부분의 강사/원장/행정, 그리고 아직
// 근무표를 등록 안 한 조교)은 제한 없이 항상 가능한 것으로 취급한다 —
// 이 필터는 "근무표를 등록해둔 조교"에게만 실질적으로 적용된다. 요일마다
// 시간이 다를 수 있어(월 14~18시, 수 16~20시 등) 그 날짜의 요일에 해당하는
// 시간대만 확인한다 — 날짜를 모르면(date 미지정) 어느 요일 기준인지 알 수
// 없으므로 시간 검사를 건너뛴다.
function isAvailable(s: StaffOption, date?: string, time?: string): boolean {
  const hours = s.workHours;
  if (!hours || Object.keys(hours).length === 0) return true;
  const day = date ? dayLabelFor(date) : null;
  if (!day) return true;
  const range = hours[day];
  if (!range) return false;
  if (time && (time < range.start || time > range.end)) return false;
  return true;
}

export default function StaffPicker({
  value,
  onChange,
  label = "상담자",
  date,
  time,
}: {
  value: string;
  onChange: (name: string) => void;
  label?: string;
  // 보강/재시/클리닉처럼 "이 날짜·시간에 실제로 근무하는 담당자인지"가
  // 중요한 화면에서만 넘겨준다 — 둘 다 없으면 지금까지처럼 아무 표시 없이
  // 동작한다(다른 15곳 넘는 기존 사용처에 영향 없음).
  date?: string;
  time?: string;
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
  const selectedStaff = allStaff.find((s) => s.name === value);
  const selectedUnavailable = !!selectedStaff && !!(date || time) && !isAvailable(selectedStaff, date, time);

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
      {selectedUnavailable && (
        <p className="muted" style={{ color: "#b91c1c", fontSize: 12, margin: "4px 0 0" }}>
          ⚠ {value}님은 이 날짜/시간에 근무 등록이 안 되어 있습니다 — 실제로 처리 가능한지 확인해주세요.
        </p>
      )}
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
          {options.map((s, i) => {
            const available = isAvailable(s, date, time);
            return (
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
                {(date || time) && !available && (
                  <span style={{ color: "#b91c1c", fontSize: 12, marginLeft: 6 }}>⚠ 근무시간 아님</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
