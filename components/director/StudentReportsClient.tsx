"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stripClassSuffix } from "@/lib/format";
import { todayKST } from "@/lib/date";

type Student = {
  id: string;
  name: string;
  school: string;
  grade: string | null;
  status: string | null;
  classIds: string[];
  classNames: string[];
};

type ClassInfo = { id: string; name: string };

type StudentPeriodReport = {
  studentId: string;
  studentName: string;
  school: string;
  grade: string | null;
  classNames: string[];
  from: string;
  to: string;
  loggedDays: number;
  attendanceRate: number | null;
  homeworkRate: number | null;
  vocabPassRate: number | null;
  progressLog: { date: string; progress: string }[];
  examScores: { date: string; examName: string; subject: string | null; score: number | null }[];
};

type Unit = "class" | "school" | "student";

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);

// 이번 달 1일 ~ 오늘 — 실제 발송 기간은 관리자가 화면에서 직접 바꾼다
// (하드코딩된 "이번 주/이번 달"을 그대로 보내면 안 된다는 지침에 따라
// 값은 어디까지나 시작점일 뿐, 저장/발송 전 항상 사용자가 조정 가능).
function defaultFrom(): string {
  const [y, m] = todayKST().split("-");
  return `${y}-${m}-01`;
}

export default function StudentReportsClient() {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);

  const [unit, setUnit] = useState<Unit>("class");
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [selectedSchools, setSelectedSchools] = useState<string[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [studentQuery, setStudentQuery] = useState("");

  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(todayKST());

  const [reports, setReports] = useState<StudentPeriodReport[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/students").then((r) => r.json()),
      fetch("/api/classes").then((r) => r.json()),
    ])
      .then(([s, c]) => {
        setStudents(Array.isArray(s) ? s : []);
        setClasses(Array.isArray(c) ? c : []);
      })
      .finally(() => setLoadingRoster(false));
  }, []);

  const schools = useMemo(
    () => Array.from(new Set(students.map((s) => s.school).filter(Boolean))).sort(),
    [students]
  );

  const resolvedStudentIds = useMemo(() => {
    if (unit === "class") {
      if (selectedClassIds.length === 0) return [];
      return students.filter((s) => s.classIds.some((id) => selectedClassIds.includes(id))).map((s) => s.id);
    }
    if (unit === "school") {
      if (selectedSchools.length === 0) return [];
      return students.filter((s) => selectedSchools.includes(s.school)).map((s) => s.id);
    }
    return selectedStudentIds;
  }, [unit, selectedClassIds, selectedSchools, selectedStudentIds, students]);

  const studentSearchResults = useMemo(() => {
    if (!studentQuery.trim()) return [];
    const q = studentQuery.trim();
    return students.filter((s) => s.name.includes(q)).slice(0, 20);
  }, [studentQuery, students]);

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function generate() {
    if (resolvedStudentIds.length === 0) {
      setError("대상을 먼저 선택해 주세요.");
      return;
    }
    setError(null);
    setGenerating(true);
    setReports(null);
    try {
      const res = await fetch("/api/student-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds: resolvedStudentIds, from, to }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "리포트 생성에 실패했습니다.");
        return;
      }
      setReports(data);
    } catch {
      setError("네트워크 오류로 리포트를 생성하지 못했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="no-print">
        <CardHeader>
          <CardTitle>리포트 만들기</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-muted-foreground">기간</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <span className="text-muted-foreground">~</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>

          <div className="flex gap-1.5">
            {(
              [
                ["class", "반별"],
                ["school", "학교별"],
                ["student", "학생별"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setUnit(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  unit === key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {loadingRoster ? (
            <p className="text-sm text-muted-foreground">명단을 불러오는 중...</p>
          ) : unit === "class" ? (
            <div className="flex flex-wrap gap-1.5">
              {classes.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(selectedClassIds, setSelectedClassIds, c.id)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium",
                    selectedClassIds.includes(c.id)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-transparent text-foreground hover:bg-muted/50"
                  )}
                >
                  {stripClassSuffix(c.name)}
                </button>
              ))}
            </div>
          ) : unit === "school" ? (
            <div className="flex flex-wrap gap-1.5">
              {schools.map((school) => (
                <button
                  key={school}
                  type="button"
                  onClick={() => toggle(selectedSchools, setSelectedSchools, school)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium",
                    selectedSchools.includes(school)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-transparent text-foreground hover:bg-muted/50"
                  )}
                >
                  {school}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                type="search"
                placeholder="학생 이름으로 검색해 추가"
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
                className="max-w-xs"
              />
              {studentSearchResults.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {studentSearchResults.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        toggle(selectedStudentIds, setSelectedStudentIds, s.id);
                        setStudentQuery("");
                      }}
                      className="rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted/50"
                    >
                      + {s.name} <span className="text-muted-foreground">({s.school} {s.grade})</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedStudentIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedStudentIds.map((id) => {
                    const s = students.find((x) => x.id === id);
                    return (
                      <Badge key={id} variant="default" className="gap-1 pr-1.5">
                        {s?.name ?? id}
                        <button
                          type="button"
                          onClick={() => toggle(selectedStudentIds, setSelectedStudentIds, id)}
                          className="ml-1 bg-transparent p-0 text-primary-foreground/80 hover:text-primary-foreground"
                          aria-label="제거"
                        >
                          ×
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="secondary"
              disabled={generating || resolvedStudentIds.length === 0}
              onClick={generate}
            >
              {generating ? "생성 중..." : `리포트 생성 (${resolvedStudentIds.length}명)`}
            </button>
            {reports && reports.length > 0 && (
              <button type="button" className="secondary" onClick={() => window.print()}>
                전체 인쇄 / PDF 저장
              </button>
            )}
            {error && <span className="error-text">{error}</span>}
          </div>
        </CardContent>
      </Card>

      {reports && (
        <div className="print-area space-y-6">
          {reports.length === 0 && <p className="text-sm text-muted-foreground">생성된 리포트가 없습니다.</p>}
          {reports.map((r) => (
            <ReportCard key={r.studentId} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report: r }: { report: StudentPeriodReport }) {
  return (
    <div className="report-page rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">{r.studentName} 학습현황 리포트</h2>
          <p className="text-sm text-muted-foreground">
            {r.school} {r.grade} · {r.classNames.map(stripClassSuffix).join(", ") || "소속반 없음"}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">기간: {r.from} ~ {r.to}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="outline">출석률 {pct(r.attendanceRate)}</Badge>
        <Badge variant="outline">과제 제출률 {pct(r.homeworkRate)}</Badge>
        <Badge variant="outline">단어 테스트 통과율 {pct(r.vocabPassRate)}</Badge>
        <Badge variant="outline">수업 기록 {r.loggedDays}일</Badge>
      </div>

      <h3 className="mt-4 text-sm font-semibold text-foreground">진도 현황</h3>
      {r.progressLog.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">해당 기간 진도 기록이 없습니다.</p>
      ) : (
        <table className="mt-1 w-full text-sm">
          <tbody>
            {r.progressLog.map((p, i) => (
              <tr key={i} className="border-b border-border last:border-b-0">
                <td className="w-24 py-1.5 align-top text-muted-foreground">{p.date}</td>
                <td className="py-1.5">{p.progress}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="mt-4 text-sm font-semibold text-foreground">시험 성적</h3>
      {r.examScores.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">해당 기간 등록된 시험 성적이 없습니다.</p>
      ) : (
        <table className="mt-1 w-full text-sm">
          <tbody>
            {r.examScores.map((e, i) => (
              <tr key={i} className="border-b border-border last:border-b-0">
                <td className="w-24 py-1.5 text-muted-foreground">{e.date}</td>
                <td className="py-1.5">{e.examName}</td>
                <td className="w-16 py-1.5 text-muted-foreground">{e.subject ?? "-"}</td>
                <td className="w-16 py-1.5 text-right font-medium">{e.score ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
