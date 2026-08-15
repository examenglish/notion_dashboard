"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ExamPrepEditor, ProgressBar, CategoryChips, type OverviewRow } from "@/components/ExamPrepClient";
import type { SchoolLevel } from "@/lib/examPrep";
import { cn } from "@/lib/utils";

type StudentBrief = { id: string; name: string; school: string; grade: string | null };

const GRADE_ORDER = ["중1", "중2", "중3", "고1", "고2", "고3"];
function gradeSort(a: string, b: string) {
  const ia = GRADE_ORDER.indexOf(a);
  const ib = GRADE_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  return a.localeCompare(b, "ko");
}

function BrowseRow({
  label,
  meta,
  active,
  onClick,
}: {
  label: string;
  meta?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-normal hover:bg-muted/60",
        active ? "bg-accent text-accent-foreground" : "bg-transparent text-foreground"
      )}
    >
      <span className="truncate">{label}</span>
      {meta && <span className="shrink-0 text-[13px] text-muted-foreground">{meta}</span>}
    </button>
  );
}

function BrowseColumn({ title, width, children }: { title: string; width: number; children: React.ReactNode }) {
  return (
    <Card className="flex h-full flex-col" style={{ width, flexShrink: 0 }}>
      <CardHeader>
        <CardTitle className="truncate text-[13px] font-normal text-muted-foreground" title={title}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-0.5 overflow-y-auto pt-0.5">{children}</CardContent>
    </Card>
  );
}

// /director/exam-prep 전용 — 학생 관리 화면과 같은 새 디자인 톤을 쓰되, 학교를
// 누르면 그 오른쪽에 학년 열이, 학년을 누르면 그 오른쪽에 학생 열이 나타나는
// 캐스케이드(Finder 컬럼 뷰) 방식으로 찾는다. 과목별 세부 입력폼
// (ExamPrepEditor)은 복잡해서 그대로 재사용하고, 감싸는 카드/목록/현황판만
// 새 디자인으로 바꿨다 — /exam-prep(구 화면, 다른 역할용)은 그대로 둔다.
export default function ExamPrepDirectorClient() {
  const [overview, setOverview] = useState<OverviewRow[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [allStudents, setAllStudents] = useState<StudentBrief[]>([]);
  const [studentId, setStudentId] = useState("");
  const [selectedSchool, setSelectedSchool] = useState("");
  const [selectedGrade, setSelectedGrade] = useState("");
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<"" | SchoolLevel>("");

  function reloadOverview() {
    fetch("/api/exam-prep")
      .then((r) => r.json())
      .then(setOverview)
      .finally(() => setLoadingOverview(false));
  }

  useEffect(() => {
    reloadOverview();
    fetch("/api/students?q=")
      .then((r) => r.json())
      // 초등학생은 시험대비 시트를 만들 일이 없어(중/고만 시험을 침) 이
      // 화면의 학교/학년/학생 목록·검색·현황판 어디에도 나오지 않게 뺀다.
      .then((list: StudentBrief[]) => setAllStudents(Array.isArray(list) ? list.filter((s) => !s.grade?.startsWith("초")) : []));
  }, []);

  const schools = useMemo(() => {
    const set = new Set(allStudents.map((s) => s.school).filter(Boolean));
    return Array.from(set).sort();
  }, [allStudents]);

  const grades = useMemo(() => {
    if (!selectedSchool) return [];
    const set = new Set(
      allStudents.filter((s) => s.school === selectedSchool).map((s) => s.grade).filter((g): g is string => !!g)
    );
    return Array.from(set).sort(gradeSort);
  }, [allStudents, selectedSchool]);

  const gradeStudents = useMemo(() => {
    if (!selectedSchool || !selectedGrade) return [];
    return allStudents
      .filter((s) => s.school === selectedSchool && s.grade === selectedGrade)
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [allStudents, selectedSchool, selectedGrade]);

  const searchResults = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return allStudents.filter((s) => s.name.includes(q)).slice(0, 20);
  }, [allStudents, query]);

  const filteredOverview = useMemo(() => {
    return [...overview].filter((r) => (levelFilter ? r.level === levelFilter : true)).sort((a, b) => a.progress - b.progress);
  }, [overview, levelFilter]);

  function reset() {
    setSelectedSchool("");
    setSelectedGrade("");
    setStudentId("");
    setQuery("");
  }

  return (
    <div className="flex items-start gap-4" style={{ height: "calc(100vh - 8.5rem)" }}>
      <Card className="flex h-full flex-col" style={{ width: 170, flexShrink: 0 }}>
        <CardHeader className="flex-col items-stretch gap-2.5">
          <CardTitle className="text-[13px] font-normal text-muted-foreground">시험대비 · 학생 찾기</CardTitle>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="이름으로 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 text-[13px] placeholder:font-normal"
            />
          </div>
        </CardHeader>
        <CardContent className="flex-1 space-y-0.5 overflow-y-auto pt-0.5">
          {query.trim() !== "" ? (
            searchResults.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">검색 결과가 없습니다.</p>
            ) : (
              searchResults.map((s) => (
                <BrowseRow
                  key={s.id}
                  label={s.name}
                  meta={`${s.school} ${s.grade ?? ""}`}
                  onClick={() => {
                    setStudentId(s.id);
                    setQuery("");
                  }}
                />
              ))
            )
          ) : (
            schools.map((s) => (
              <BrowseRow
                key={s}
                label={s}
                active={selectedSchool === s}
                onClick={() => {
                  setSelectedSchool(s);
                  setSelectedGrade("");
                  setStudentId("");
                }}
              />
            ))
          )}
        </CardContent>
      </Card>

      {!query.trim() && selectedSchool && (
        <BrowseColumn title="학년" width={80}>
          {grades.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">학생 없음</p>}
          {grades.map((g) => (
            <BrowseRow
              key={g}
              label={g}
              active={selectedGrade === g}
              onClick={() => {
                setSelectedGrade(g);
                setStudentId("");
              }}
            />
          ))}
        </BrowseColumn>
      )}

      {!query.trim() && selectedGrade && (
        <BrowseColumn title={`${selectedSchool} ${selectedGrade}`} width={120}>
          {gradeStudents.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">소속 학생이 없습니다.</p>
          )}
          {gradeStudents.map((s) => (
            <BrowseRow key={s.id} label={s.name} active={studentId === s.id} onClick={() => setStudentId(s.id)} />
          ))}
        </BrowseColumn>
      )}

      <div className="h-full min-w-0 flex-1">
        {studentId ? (
          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle>학생 상세 · 시험대비</CardTitle>
              <button
                type="button"
                onClick={reset}
                className="rounded-md border border-border bg-transparent px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
              >
                목록으로
              </button>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto pt-1">
              <ExamPrepEditor key={studentId} studentId={studentId} onSaved={reloadOverview} />
            </CardContent>
          </Card>
        ) : selectedSchool ? (
          // 학교/학년까지만 고르고 아직 학생을 안 눌렀을 때, 선택과 무관한
          // 전체 현황판을 그대로 띄워두면 그 안의 아무 학생이나 눈에 들어와
          // "왜 얘가 나오지" 하고 헷갈리게 된다 — 학생을 고르기 전까진 비워둔다.
          <Card className="flex h-full flex-col items-center justify-center">
            <p className="text-sm text-muted-foreground">왼쪽에서 학생을 선택하세요.</p>
          </Card>
        ) : (
          <Card className="flex h-full flex-col">
            <CardHeader className="flex-col items-stretch gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>현황판 · 진도표</CardTitle>
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value as "" | SchoolLevel)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
              >
                <option value="">전체</option>
                <option value="중등">중등</option>
                <option value="고등">고등</option>
              </select>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto pt-1">
              {loadingOverview && <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중...</p>}
              {!loadingOverview && filteredOverview.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  등록된 시험대비 시트가 없습니다. 왼쪽에서 학생을 선택해 작성해보세요.
                </p>
              )}
              {!loadingOverview && filteredOverview.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="py-1.5 text-left font-medium">학생</th>
                        <th className="py-1.5 text-left font-medium">시험명 / 범위</th>
                        <th className="py-1.5 text-left font-medium">담당교사</th>
                        <th className="py-1.5 text-left font-medium">진행률</th>
                        <th className="py-1.5 text-left font-medium">항목별 성취</th>
                        <th className="py-1.5 text-left font-medium">취약부분</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOverview.map((r) => (
                        <tr
                          key={r.studentId}
                          onClick={() => setStudentId(r.studentId)}
                          className="cursor-pointer border-b border-border last:border-b-0 hover:bg-muted/40"
                        >
                          <td className="py-2">
                            <div className="font-medium text-foreground">{r.studentName}</div>
                            <div className="text-xs text-muted-foreground">
                              {r.school} {r.grade} · {r.level}
                            </div>
                          </td>
                          <td className="py-2 text-foreground">
                            {r.examTitle || "-"}
                            {r.examRange && <div className="text-xs text-muted-foreground">{r.examRange}</div>}
                          </td>
                          <td className="py-2 text-foreground">{r.teachers.length > 0 ? r.teachers.join(", ") : "-"}</td>
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <ProgressBar value={r.progress} />
                              <span className="text-xs text-foreground">{r.progress}%</span>
                            </div>
                          </td>
                          <td className="py-2">
                            <CategoryChips categories={r.categories} />
                          </td>
                          <td className="max-w-[200px] py-2 text-xs text-foreground">{r.weakPoints || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
