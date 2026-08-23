"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stripClassSuffix } from "@/lib/format";
import { todayKST, formatDateLabel } from "@/lib/date";

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

export default function StudentReportsClient({ branchName }: { branchName: string }) {
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
            <ReportCard key={r.studentId} report={r} branchName={branchName} />
          ))}
        </div>
      )}
    </div>
  );
}

// 조교클리닉 리포트 스킬의 브랜드 규격(로고/프라이머리 블루/통계카드/
// 막대그래프/코멘트박스)을 이 웹앱 자체 CSS 변수(--primary 등, 이미 같은
// 색상 #004ea2로 정의돼 있음)로 그대로 재현한다 — 그 스킬처럼 Claude가
// Python+Playwright로 매번 렌더링하면 학생 1명당 별도 세션 비용이 들지만,
// 여기선 순수 CSS/SVG라 학생 수와 무관하게 렌더링 비용이 0이다.
function tierLabel(v: number | null, labels: [string, string, string]): string | null {
  if (v === null) return null;
  if (v >= 0.95) return labels[0];
  if (v >= 0.8) return labels[1];
  return labels[2];
}

// AI 문장 생성 없이 임계값 기반으로 조립하는 종합 코멘트 — 사실(수치) 그대로만
// 서술하고 과장하지 않는다(클리닉리포트 스킬의 "사실 기반 요약" 원칙과 동일).
function summarize(r: StudentPeriodReport): string {
  if (r.loggedDays === 0) return "해당 기간에 등록된 수업 기록이 없습니다.";
  const parts: string[] = [];
  const att = tierLabel(r.attendanceRate, ["매우 우수한", "양호한", "다소 아쉬운"]);
  const hw = tierLabel(r.homeworkRate, ["매우 성실한", "무난한", "보완이 필요한"]);
  if (att) parts.push(`출석은 ${att} 수준을 유지하고 있습니다`);
  if (hw) parts.push(`과제 수행은 ${hw} 편입니다`);
  if (r.vocabPassRate !== null) parts.push(`단어 테스트는 ${Math.round(r.vocabPassRate * 100)}% 통과했습니다`);
  return parts.length > 0 ? parts.join(". ") + "." : "기간 내 기록을 바탕으로 꾸준히 관리하고 있습니다.";
}

function RateBarChart({ rows }: { rows: { label: string; value: number | null }[] }) {
  const width = 640;
  const barHeight = 24;
  const gap = 16;
  const leftPad = 118;
  const rightPad = 46;
  const topPad = 8;
  const bottomPad = 22;
  const chartWidth = width - leftPad - rightPad;
  const height = topPad + rows.length * (barHeight + gap) + bottomPad;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="출석·과제·단어 테스트 지표">
      {[0, 25, 50, 75, 100].map((g) => {
        const x = leftPad + (g / 100) * chartWidth;
        return (
          <g key={g}>
            <line x1={x} y1={topPad} x2={x} y2={height - bottomPad + 4} stroke="#e1e5ec" strokeWidth={1} />
            <text x={x} y={height - bottomPad + 16} fontSize={11} fill="#6b7280" textAnchor="middle">
              {g}%
            </text>
          </g>
        );
      })}
      {rows.map((row, i) => {
        const y = topPad + i * (barHeight + gap);
        const v = row.value ?? 0;
        const w = (v / 100) * chartWidth;
        return (
          <g key={row.label}>
            <text x={leftPad - 10} y={y + barHeight / 2 + 4} fontSize={12} fill="#14213d" textAnchor="end">
              {row.label}
            </text>
            <rect x={leftPad} y={y} width={chartWidth} height={barHeight} fill="#f2f4f8" rx={4} />
            {row.value !== null && <rect x={leftPad} y={y} width={w} height={barHeight} fill="#004ea2" rx={4} />}
            <text x={leftPad + w + 6} y={y + barHeight / 2 + 4} fontSize={12} fontWeight={700} fill="#004ea2">
              {row.value === null ? "기록 없음" : `${Math.round(row.value)}%`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ReportCard({ report: r, branchName }: { report: StudentPeriodReport; branchName: string }) {
  const chartRows = [
    { label: "출석률", value: r.attendanceRate === null ? null : r.attendanceRate * 100 },
    { label: "과제 제출률", value: r.homeworkRate === null ? null : r.homeworkRate * 100 },
    { label: "단어 테스트 통과율", value: r.vocabPassRate === null ? null : r.vocabPassRate * 100 },
  ];
  const statTiles: [string, string][] = [
    ["출석률", pct(r.attendanceRate)],
    ["과제 제출률", pct(r.homeworkRate)],
    ["단어 테스트 통과율", pct(r.vocabPassRate)],
    ["수업 기록", `${r.loggedDays}일`],
  ];

  return (
    <div className="report-page rounded-lg border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3 border-b-2 pb-4" style={{ borderColor: "var(--primary)" }}>
        <div>
          <p className="text-xs font-semibold tracking-wide" style={{ color: "var(--primary)" }}>
            {branchName} · 학부모 발송용
          </p>
          <h2 className="mt-1 text-xl font-bold text-foreground">학습현황 리포트</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            기간 {r.from} ~ {r.to} · 발송일 {formatDateLabel(todayKST())}
          </p>
        </div>
        <Image src="/logo.png" alt="" width={140} height={26} className="h-6 w-auto shrink-0" />
      </div>

      <div className="mt-4 rounded-md p-4" style={{ background: "var(--primary-tint)" }}>
        <p className="text-lg font-bold text-foreground">{r.studentName}</p>
        <p className="mt-0.5 text-sm" style={{ color: "var(--primary-dark)" }}>
          {r.school} {r.grade} · {r.classNames.map(stripClassSuffix).join(", ") || "소속반 없음"}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        {statTiles.map(([label, value]) => (
          <div key={label} className="rounded-md border border-border p-3 text-center">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="mt-1 text-base font-bold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      <h3 className="mt-5 text-sm font-semibold text-foreground">출석 · 과제 · 단어 테스트 지표</h3>
      <div className="mt-2">
        <RateBarChart rows={chartRows} />
      </div>

      <h3 className="mt-5 text-sm font-semibold text-foreground">진도 현황</h3>
      {r.progressLog.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">해당 기간 진도 기록이 없습니다.</p>
      ) : (
        <table className="mt-1 w-full text-sm" style={{ wordBreak: "keep-all" }}>
          <thead>
            <tr style={{ background: "var(--primary-tint)" }}>
              <th className="w-24 py-1.5 px-2 text-left text-xs font-semibold" style={{ color: "var(--primary-dark)" }}>
                날짜
              </th>
              <th className="py-1.5 px-2 text-left text-xs font-semibold" style={{ color: "var(--primary-dark)" }}>
                진도 내용
              </th>
            </tr>
          </thead>
          <tbody>
            {r.progressLog.map((p, i) => (
              <tr key={i} className="border-b border-border last:border-b-0">
                <td className="py-1.5 px-2 align-top text-muted-foreground">{p.date}</td>
                <td className="py-1.5 px-2">{p.progress}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {r.examScores.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold text-foreground">시험 성적</h3>
          <table className="mt-1 w-full text-sm">
            <thead>
              <tr style={{ background: "var(--primary-tint)" }}>
                <th className="w-24 py-1.5 px-2 text-left text-xs font-semibold" style={{ color: "var(--primary-dark)" }}>
                  날짜
                </th>
                <th className="py-1.5 px-2 text-left text-xs font-semibold" style={{ color: "var(--primary-dark)" }}>
                  시험명
                </th>
                <th className="w-16 py-1.5 px-2 text-left text-xs font-semibold" style={{ color: "var(--primary-dark)" }}>
                  과목
                </th>
                <th className="w-16 py-1.5 px-2 text-right text-xs font-semibold" style={{ color: "var(--primary-dark)" }}>
                  점수
                </th>
              </tr>
            </thead>
            <tbody>
              {r.examScores.map((e, i) => (
                <tr key={i} className="border-b border-border last:border-b-0">
                  <td className="py-1.5 px-2 text-muted-foreground">{e.date}</td>
                  <td className="py-1.5 px-2">{e.examName}</td>
                  <td className="py-1.5 px-2 text-muted-foreground">{e.subject ?? "-"}</td>
                  <td className="py-1.5 px-2 text-right font-medium">{e.score ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="mt-5 rounded-md p-3" style={{ background: "var(--primary-tint)" }}>
        <p className="text-xs font-semibold" style={{ color: "var(--primary-dark)" }}>
          종합 코멘트
        </p>
        <p className="mt-1 text-sm text-foreground">{summarize(r)}</p>
      </div>

      <p className="mt-4 border-t border-border pt-2 text-center text-[11px] text-muted-foreground">
        {branchName} · 본 리포트는 학부모님께 전달되는 학습현황 안내 자료입니다.
      </p>
    </div>
  );
}
