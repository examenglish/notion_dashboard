"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ExamPrepEditor, ProgressBar, CategoryChips, type OverviewRow } from "@/components/ExamPrepClient";
import { TEXT_CATEGORIES, MIDDLE_TEXT_CATEGORIES, levelFromGrade, type SchoolLevel, type TextCategory } from "@/lib/examPrep";
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

type CategoryUnits = { name: string; units: string[] };
type SchoolExamRangeEntry = {
  id: string;
  school: string;
  grade: string;
  examTitle: string;
  examRange: string;
  units: Record<TextCategory, CategoryUnits>;
  updatedAt: string | null;
};

type CategoryForm = { name: string; unitsText: string };
function emptyCategoryForm(): CategoryForm {
  return { name: "", unitsText: "" };
}
function emptyUnitsForm(): Record<TextCategory, CategoryForm> {
  const form = {} as Record<TextCategory, CategoryForm>;
  for (const cat of TEXT_CATEGORIES) form[cat] = emptyCategoryForm();
  return form;
}

const CATEGORY_UNITS_PLACEHOLDER: Record<TextCategory, string> = {
  교과서: "예: 1과, 2과, 3과",
  부교재: "예: 1강, 2강, 3강",
  모의고사: "예: 18-45 (번호 범위) 또는 21, 24, 33-36",
  학교프린트: "예: 1학기 중간대비 프린트",
};

// 학교+학년 단위로 시험범위·교과서/부교재/모의고사/학교프린트 단원 틀을
// 관리하는 패널. 여기서 저장하면 그 학교·학년 학생들의 시험대비 시트에
// 읽기 전용(시험범위)/자동 추가(단원 틀)로 즉시 반영된다 — 단원별 워크북
// 진도·단어암기 등 개별 진행상황은 절대 건드리지 않는다.
function SchoolExamRangePanel({
  school,
  grades,
  affectedCount,
}: {
  school: string;
  grades: string[];
  affectedCount: (grade: string) => number;
}) {
  const [grade, setGrade] = useState(grades[0] ?? "");
  const [latest, setLatest] = useState<SchoolExamRangeEntry | null>(null);
  const [history, setHistory] = useState<SchoolExamRangeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [examTitle, setExamTitle] = useState("");
  const [examRange, setExamRange] = useState("");
  const [unitsForm, setUnitsForm] = useState<Record<TextCategory, CategoryForm>>(emptyUnitsForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const level = levelFromGrade(grade);
  // 중등 학교프린트는 학생 쪽에서 단일 문자열 필드라 MIDDLE_TEXT_CATEGORIES엔
  // 없지만, 이 패널에서는 입력할 수 있어야 한다(비어있을 때만 채워짐).
  const categories: TextCategory[] = level === "중등" ? [...MIDDLE_TEXT_CATEGORIES, "학교프린트"] : TEXT_CATEGORIES;

  useEffect(() => {
    if (!grades.includes(grade)) setGrade(grades[0] ?? "");
  }, [grades, grade]);

  useEffect(() => {
    if (!school || !grade) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ school, grade });
    fetch(`/api/school-exam-range?${params}`)
      .then((r) => r.json())
      .then((d: { latest: SchoolExamRangeEntry | null; history: SchoolExamRangeEntry[] }) => {
        setLatest(d.latest);
        setHistory(d.history);
        setExamTitle(d.latest?.examTitle ?? "");
        setExamRange(d.latest?.examRange ?? "");
        const form = emptyUnitsForm();
        for (const cat of TEXT_CATEGORIES) {
          const u = d.latest?.units?.[cat];
          form[cat] = { name: u?.name ?? "", unitsText: (u?.units ?? []).join(", ") };
        }
        setUnitsForm(form);
      })
      .finally(() => setLoading(false));
  }, [school, grade]);

  async function handleSave() {
    if (!examTitle.trim()) {
      window.alert("시험명을 입력해주세요 (예: 2026 2학기 중간고사).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const units: Record<TextCategory, CategoryUnits> = {} as Record<TextCategory, CategoryUnits>;
      for (const cat of TEXT_CATEGORIES) {
        units[cat] = {
          name: unitsForm[cat].name,
          units: unitsForm[cat].unitsText.split(",").map((u) => u.trim()).filter(Boolean),
        };
      }
      const res = await fetch("/api/school-exam-range", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ school, grade, examTitle, examRange, units }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "저장에 실패했습니다.");
        return;
      }
      const entry: SchoolExamRangeEntry = await res.json();
      setLatest(entry);
      setHistory((prev) => [entry, ...prev.filter((h) => h.examTitle !== entry.examTitle)]);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>{school} · 학교별 시험범위</CardTitle>
        <p className="text-xs text-muted-foreground">
          여기서 저장하면 이 학교·학년 학생들의 시험대비 시트에 시험범위는 읽기 전용으로, 교과서·부교재·모의고사·
          학교프린트는 없는 단원만 자동 추가로 반영됩니다. 개별 학생의 워크북·단어암기 진행상황은 전혀 건드리지 않습니다.
        </p>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 overflow-y-auto pt-1">
        <div className="flex flex-wrap gap-1.5">
          {grades.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGrade(g)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium",
                g === grade ? "border-primary bg-accent text-accent-foreground" : "border-border bg-transparent text-foreground hover:bg-muted"
              )}
            >
              {g} ({affectedCount(g)}명)
            </button>
          ))}
        </div>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중...</p>
        ) : (
          grade && (
            <>
              <div className="rounded-md border border-border p-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  현재 값 · 대상 학생 {affectedCount(grade)}명
                </p>
                {latest ? (
                  <>
                    <p className="mt-1 text-sm text-foreground">
                      <span className="font-medium">{latest.examTitle}</span> — {latest.examRange || "(범위 미입력)"}
                      {latest.updatedAt && <span className="ml-2 text-xs text-muted-foreground">{latest.updatedAt} 갱신</span>}
                    </p>
                    {categories.map((cat) => {
                      const u = latest.units[cat];
                      if (!u || (u.units.length === 0 && !u.name)) return null;
                      return (
                        <p key={cat} className="text-xs text-muted-foreground">
                          {cat}: {u.name || "(이름 미입력)"} · {u.units.length > 0 ? u.units.join(", ") : "(단원 미입력)"}
                        </p>
                      );
                    })}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">아직 등록된 시험범위가 없습니다.</p>
                )}
              </div>

              <div className="space-y-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">시험명</label>
                  <input
                    type="text"
                    list="schoolExamTitleHistory"
                    placeholder="예: 2026 2학기 중간고사"
                    value={examTitle}
                    onChange={(e) => setExamTitle(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
                  />
                  <datalist id="schoolExamTitleHistory">
                    {Array.from(new Set(history.map((h) => h.examTitle))).map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">시험범위</label>
                  <textarea
                    placeholder="예: 1~3과, 모의고사 18-24"
                    value={examRange}
                    onChange={(e) => setExamRange(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm text-foreground"
                  />
                </div>

                {categories.map((cat) => (
                  <div key={cat} className="rounded-md border border-border p-2.5 space-y-2">
                    <p className="text-xs font-semibold text-foreground">{cat}</p>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        {cat === "모의고사" ? "모의고사 회차명" : `${cat} 이름 (공통 교재명 — 없으면 비워두세요)`}
                      </label>
                      <input
                        type="text"
                        placeholder={
                          cat === "교과서" || cat === "부교재"
                            ? "예: 영어2 능률(오)"
                            : cat === "모의고사"
                              ? "예: 2025년 6월 모의고사"
                              : "선택사항"
                        }
                        value={unitsForm[cat].name}
                        onChange={(e) => setUnitsForm((prev) => ({ ...prev, [cat]: { ...prev[cat], name: e.target.value } }))}
                        className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        {cat === "모의고사" ? "번호 범위" : `${cat} 단원`} (쉼표로 구분 —{" "}
                        {level === "중등" && cat === "학교프린트"
                          ? "학생 시트가 비어있을 때만 채워짐, 이미 적혀있으면 안 건드림"
                          : "없는 단원만 학생 시트에 자동 추가, 기존 진도는 안 건드림"}
                        )
                      </label>
                      <input
                        type="text"
                        placeholder={CATEGORY_UNITS_PLACEHOLDER[cat]}
                        value={unitsForm[cat].unitsText}
                        onChange={(e) => setUnitsForm((prev) => ({ ...prev, [cat]: { ...prev[cat], unitsText: e.target.value } }))}
                        className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
                      />
                    </div>
                  </div>
                ))}

                {error && <p className="text-xs text-destructive">{error}</p>}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "저장 중..." : "이 학교·학년에 저장"}
                </button>
              </div>

              {history.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">이력</p>
                  <div className="space-y-1">
                    {history.map((h) => (
                      <div key={h.id} className="rounded-md border border-border px-2.5 py-1.5 text-xs">
                        <span className="font-medium text-foreground">{h.examTitle}</span>
                        <span className="ml-2 text-muted-foreground">{h.examRange || "(범위 미입력)"}</span>
                        {h.updatedAt && <span className="ml-2 text-muted-foreground">· {h.updatedAt}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )
        )}
      </CardContent>
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
  const [rangeSchool, setRangeSchool] = useState("");
  const [schoolQuery, setSchoolQuery] = useState("");

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

  const rangeGrades = useMemo(() => {
    if (!rangeSchool) return [];
    const set = new Set(
      allStudents.filter((s) => s.school === rangeSchool).map((s) => s.grade).filter((g): g is string => !!g)
    );
    return Array.from(set).sort(gradeSort);
  }, [allStudents, rangeSchool]);

  function rangeAffectedCount(grade: string) {
    return allStudents.filter((s) => s.school === rangeSchool && s.grade === grade).length;
  }

  function reset() {
    setSelectedSchool("");
    setSelectedGrade("");
    setStudentId("");
    setQuery("");
    setRangeSchool("");
    setSchoolQuery("");
  }

  function selectRangeSchool(school: string) {
    reset();
    setRangeSchool(school);
  }

  const schoolSearchResults = useMemo(() => {
    const q = schoolQuery.trim();
    if (!q) return [];
    return schools.filter((s) => s.includes(q));
  }, [schools, schoolQuery]);

  return (
    <div className="flex items-start gap-4" style={{ height: "calc(100vh - 8.5rem)" }}>
      <div className="flex h-full flex-col gap-4" style={{ width: 170, flexShrink: 0 }}>
        <Card className="flex flex-1 flex-col overflow-hidden">
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
                      setRangeSchool("");
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
                    setRangeSchool("");
                    setSelectedSchool(s);
                    setSelectedGrade("");
                    setStudentId("");
                  }}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-1 flex-col overflow-hidden">
          <CardHeader className="flex-col items-stretch gap-2.5">
            <CardTitle className="text-[13px] font-normal text-muted-foreground">학교별 시험범위 입력</CardTitle>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="학교 이름으로 검색"
                value={schoolQuery}
                onChange={(e) => setSchoolQuery(e.target.value)}
                className="pl-8 text-[13px] placeholder:font-normal"
              />
            </div>
          </CardHeader>
          <CardContent className="flex-1 space-y-0.5 overflow-y-auto pt-0.5">
            {schoolQuery.trim() === "" ? (
              <p className="py-6 text-center text-xs text-muted-foreground">학교 이름을 입력하세요.</p>
            ) : schoolSearchResults.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">검색 결과가 없습니다.</p>
            ) : (
              schoolSearchResults.map((s) => (
                <BrowseRow key={s} label={s} active={rangeSchool === s} onClick={() => selectRangeSchool(s)} />
              ))
            )}
          </CardContent>
        </Card>
      </div>

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
        {rangeSchool ? (
          <SchoolExamRangePanel school={rangeSchool} grades={rangeGrades} affectedCount={rangeAffectedCount} />
        ) : studentId ? (
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
            <CardHeader className="flex-row flex-nowrap items-center justify-between gap-2">
              <CardTitle className="truncate">현황판 · 진도표</CardTitle>
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value as "" | SchoolLevel)}
                className="h-8 w-24 shrink-0 rounded-md border border-input bg-background px-2 text-xs text-foreground"
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
