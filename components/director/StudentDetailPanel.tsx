"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { classColor, stripClassSuffix } from "@/lib/format";
import type { StudentRow } from "@/components/StudentTable";

export type StudentDetail = {
  student: StudentRow;
  dailyRecords: { date: string | null; attendance: string | null; homeworkDone: boolean; vocabResult: string | null }[];
  examScores: { date: string | null; examName: string; subject: string | null; score: number | null }[];
};

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);

export default function StudentDetailPanel({
  detail,
  loading,
}: {
  detail: StudentDetail | null;
  loading: boolean;
}) {
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
              {detail.student.status && detail.student.status !== "재원" && (
                <Badge variant="warning">{detail.student.status}</Badge>
              )}
            </div>

            <div className="mt-2 text-xs text-muted-foreground">
              학생 연락처 {detail.student.phone || "-"} · 학부모 연락처 {detail.student.parentPhone || "-"}
            </div>

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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
