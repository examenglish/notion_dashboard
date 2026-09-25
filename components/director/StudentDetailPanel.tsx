"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { classColor, stripClassSuffix } from "@/lib/format";
import type { StudentRow } from "@/components/StudentTable";
import StudentHistoryModal from "@/components/StudentHistoryModal";
import { rememberWork } from "./recentWork";

type LearningRecord = {
  id: string;
  date: string | null;
  type: string;
  name: string;
  score: number | null;
  maxScore: number | null;
  passed: boolean | null;
  retestRequired: boolean;
  completed: boolean | null;
  note: string;
  enteredBy: string;
  raw: string;
};

// 학생 문맥 메뉴 — 같은 학생 데이터를 관점별로. "학생 기록"은 이 패널 안에서, 나머지는 전체기록의 해당 구역으로 바로 연다.
const CONTEXT_TABS: { key: string; label: string; section?: string }[] = [
  { key: "summary", label: "요약" },
  { key: "records", label: "학생 기록" },
  { key: "makeup", label: "보강", section: "makeup" },
  { key: "progress", label: "진도·과제", section: "progress" },
  { key: "counseling", label: "상담", section: "counseling" },
  { key: "examprep", label: "시험대비", section: "examprep" },
  { key: "slack", label: "Slack 기록", section: "slack" },
];

function recordSummary(r: LearningRecord): string {
  const parts = [r.name || r.type];
  if (r.score !== null) parts.push(`${r.score}${r.maxScore ? `/${r.maxScore}` : "점"}`);
  if (r.passed === false) parts.push("미통과");
  if (r.passed === true) parts.push("통과");
  if (r.retestRequired) parts.push("재시험 필요");
  if (r.completed === false) parts.push("미완료");
  if (r.completed === true) parts.push("완료");
  return parts.join(" · ");
}

export type StudentDetail = {
  student: StudentRow;
  dailyRecords: { date: string | null; attendance: string | null; homeworkDone: boolean; vocabResult: string | null }[];
  examScores: { date: string | null; examName: string; subject: string | null; score: number | null }[];
};

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);

export default function StudentDetailPanel({
  detail,
  loading,
  staffName,
  onChanged,
}: {
  detail: StudentDetail | null;
  loading: boolean;
  staffName: string;
  onChanged?: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [historySection, setHistorySection] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState("summary");
  const [records, setRecords] = useState<LearningRecord[] | null>(null);
  const [recordsError, setRecordsError] = useState(false);
  const studentId = detail?.student.id;

  // 학생을 열면 최근 작업에 남긴다(다른 메뉴로 갔다가 한 번에 돌아오기)
  useEffect(() => {
    if (!detail) return;
    setTab("summary");
    setRecords(null);
    setRecordsError(false);
    rememberWork({
      href: `/director/students?id=${encodeURIComponent(detail.student.id)}&q=${encodeURIComponent(detail.student.name)}`,
      title: detail.student.name,
      subtitle: "학생",
    });
  }, [detail]);

  useEffect(() => {
    if (tab !== "records" || !studentId || records) return;
    fetch(`/api/students/${studentId}/learning-records`)
      .then((r) => r.json())
      .then((d) => (Array.isArray(d?.records) ? setRecords(d.records) : setRecordsError(true)))
      .catch(() => setRecordsError(true));
  }, [tab, studentId, records]);

  function openTab(t: (typeof CONTEXT_TABS)[number]) {
    if (t.section) {
      setHistorySection(t.section);
      setShowHistory(true);
      return;
    }
    setTab(t.key);
  }

  const trendData = useMemo(() => {
    if (!detail) return [];
    return detail.dailyRecords.map((r) => ({
      date: r.date?.slice(5) ?? "",
      출석: r.attendance === "결석" ? 0 : 1,
      과제: r.homeworkDone ? 1 : 0,
    }));
  }, [detail]);

  const scoreData = useMemo(() => {
    if (!detail) return [];
    return detail.examScores.map((s) => ({
      date: s.date?.slice(5) ?? "",
      점수: s.score ?? 0,
      시험명: s.examName,
    }));
  }, [detail]);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>학생 상세</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto pt-1">
        {loading && <p className="py-10 text-center text-sm text-muted-foreground">불러오는 중...</p>}
        {!loading && !detail && (
          <p className="py-10 text-center text-sm text-muted-foreground">왼쪽에서 학생을 선택하세요.</p>
        )}
        {!loading && detail && (
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <span className="text-base font-bold text-foreground">{detail.student.name}</span>{" "}
                <span className="text-sm text-muted-foreground">
                  {detail.student.school} · {detail.student.grade}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {detail.student.status && detail.student.status !== "재원" && (
                  <Badge variant="warning">{detail.student.status}</Badge>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setHistorySection(undefined);
                    setShowHistory(true);
                  }}
                  className="rounded-md border border-border bg-transparent px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
                >
                  전체기록 보기
                </button>
              </div>
            </div>

            <div className="mt-2 text-xs text-muted-foreground">
              학생 연락처 {detail.student.phone || "-"} · 학부모 연락처 {detail.student.parentPhone || "-"}
            </div>

            <div role="tablist" aria-label={`${detail.student.name} 기록 보기`} className="mt-3 flex gap-1 overflow-x-auto border-b border-border">
              {CONTEXT_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={!t.section && tab === t.key}
                  onClick={() => openTab(t)}
                  className={`shrink-0 border-b-2 bg-transparent px-2.5 py-2 text-xs font-semibold ${
                    !t.section && tab === t.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "records" && (
              <div className="mt-3">
                {recordsError ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">학생 기록을 불러오지 못했습니다. 잠시 후 다시 눌러 주세요.</p>
                ) : records === null ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중...</p>
                ) : records.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    아직 학생 기록이 없습니다. 입력창이나 Slack에 “{detail.student.name} 단어시험 84점 재시험”처럼 남기면 여기에 쌓입니다.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {records.map((r) => (
                      <li key={r.id} className="py-2.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold text-foreground">{recordSummary(r)}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{r.date ?? ""}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {r.type}
                          {r.note ? ` · ${r.note}` : ""}
                          {r.enteredBy ? ` · 입력 ${r.enteredBy}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {tab === "summary" && (
            <>

            {detail.student.classNames && detail.student.classNames.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {detail.student.classNames.map((c) => (
                  <Badge
                    key={c}
                    variant="outline"
                    className="border-transparent text-[11px] text-white"
                    style={{ background: classColor(c) }}
                  >
                    {stripClassSuffix(c)}
                  </Badge>
                ))}
              </div>
            )}

            <div className="mt-3.5 grid grid-cols-3 gap-2.5">
              <div className="rounded-md bg-muted px-3 py-2.5 text-center">
                <div className="text-[11px] text-muted-foreground">누적출석률</div>
                <div className="mt-0.5 text-sm font-bold text-foreground">{pct(detail.student.attendanceRate)}</div>
              </div>
              <div className="rounded-md bg-muted px-3 py-2.5 text-center">
                <div className="text-[11px] text-muted-foreground">과제제출률</div>
                <div className="mt-0.5 text-sm font-bold text-foreground">{pct(detail.student.homeworkRate)}</div>
              </div>
              <div className="rounded-md bg-muted px-3 py-2.5 text-center">
                <div className="text-[11px] text-muted-foreground">단어통과율</div>
                <div className="mt-0.5 text-sm font-bold text-foreground">{pct(detail.student.vocabPassRate)}</div>
              </div>
            </div>

            <div className="mt-5 text-sm font-semibold text-foreground">출결·과제 추이</div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={trendData} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--sc-border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--sc-muted-foreground))" />
                <YAxis domain={[0, 1]} ticks={[0, 1]} tick={{ fontSize: 11 }} stroke="hsl(var(--sc-muted-foreground))" />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Line type="monotone" dataKey="출석" stroke="#004ea2" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="과제" stroke="#1a8a54" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>

            <div className="mt-4 text-sm font-semibold text-foreground">성적 추이</div>
            {scoreData.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">등록된 시험 성적이 없습니다.</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={scoreData} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--sc-border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--sc-muted-foreground))" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="hsl(var(--sc-muted-foreground))" />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Line type="monotone" dataKey="점수" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
            </>
            )}
          </div>
        )}
      </CardContent>

      {detail && showHistory && (
        <StudentHistoryModal
          studentId={detail.student.id}
          student={{
            name: detail.student.name,
            school: detail.student.school,
            grade: detail.student.grade,
            memo: detail.student.memo ?? "",
          }}
          staffName={staffName}
          staffRole="원장"
          trendData={trendData}
          scoreData={scoreData}
          initialSection={historySection}
          onClose={() => setShowHistory(false)}
          onChanged={onChanged}
        />
      )}
    </Card>
  );
}
