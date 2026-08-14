"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import DirectorUserMenu from "./DirectorUserMenu";
import type { StudentRow } from "@/components/StudentTable";

export default function DirectorTopbar({
  staffName,
  role,
  dateLabel,
  greetingTitle,
  greetingText,
}: {
  staffName: string;
  role: string;
  dateLabel: string;
  // 검색창 우측에 놓는 페이지 제목/한줄 소개 — 대시보드에서만 넘긴다
  // (다른 /director 하위 페이지는 각자 본문에 자기 제목을 따로 둔다).
  greetingTitle?: string;
  greetingText?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 반/시험명 검색은 아직 없음 — placeholder 문구는 그대로 두되, 실제로는
  // 학생 이름만 /api/students?q=로 찾아 학생 관리 상세로 바로 연결한다.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      fetch(`/api/students?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data: StudentRow[]) => setResults(Array.isArray(data) ? data.slice(0, 8) : []))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  function goToStudent(s: StudentRow) {
    setOpen(false);
    setQuery("");
    router.push(`/director/students?id=${s.id}&q=${encodeURIComponent(s.name)}`);
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background px-6">
      <div className="text-sm font-semibold text-foreground">{dateLabel}</div>

      <div ref={boxRef} className="relative ml-4 flex-1 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          placeholder="학생 이름으로 검색"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        {open && query.trim() !== "" && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-card py-1 shadow-card">
            {loading && (
              <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                검색 중...
              </div>
            )}
            {!loading && results.length === 0 && (
              <p className="px-3 py-2.5 text-xs text-muted-foreground">일치하는 학생이 없습니다.</p>
            )}
            {!loading &&
              results.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => goToStudent(s)}
                  className="flex w-full items-center justify-between gap-2 bg-transparent px-3 py-2 text-left text-sm hover:bg-muted/60"
                >
                  <span className="font-medium text-foreground">{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.school} {s.grade ?? ""}
                    {s.status && s.status !== "재원" ? ` · ${s.status}` : ""}
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>

      {greetingTitle && (
        <div className="ml-4 min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold text-foreground">{greetingTitle}</span>
          {greetingText && <span className="text-muted-foreground"> · {greetingText}</span>}
        </div>
      )}

      <DirectorUserMenu staffName={staffName} role={role} />
    </header>
  );
}
