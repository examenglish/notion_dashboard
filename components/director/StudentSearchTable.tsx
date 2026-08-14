"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { classColor, stripClassSuffix } from "@/lib/format";
import type { StudentRow, MonthlyMetricRow, MetricKey } from "@/components/StudentTable";

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);

const STATUS_TONE: Record<string, "success" | "default" | "warning" | "secondary"> = {
  재원: "success",
  대기생: "default",
  휴원: "warning",
  퇴원: "secondary",
};

const METRIC_TABS: { key: MetricKey; label: string }[] = [
  { key: "attendanceRate", label: "출석률" },
  { key: "vocabPassRate", label: "단어통과율" },
  { key: "homeworkRate", label: "과제수행률" },
];

type SortKey = "attendanceRate" | "homeworkRate" | "vocabPassRate" | "tuitionDay";

function BottomMetricsPanel({ onSelect }: { onSelect: (id: string) => void }) {
  const [rows, setRows] = useState<MonthlyMetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<MetricKey>("homeworkRate");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetch("/api/students/monthly-bottom")
      .then((r) => r.json())
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const sorted = useMemo(() => {
    return [...rows]
      .filter((r) => r[metric] !== null)
      .sort((a, b) => (a[metric] as number) - (b[metric] as number));
  }, [rows, metric]);

  const visible = sorted.slice(0, showAll ? 30 : 8);
  const activeLabel = METRIC_TABS.find((t) => t.key === metric)?.label ?? "";

  return (
    <div>
      <div className="flex gap-1.5">
        {METRIC_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setMetric(t.key)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              metric === t.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground">
        이번 달 {activeLabel} 하위 {visible.length}명
      </p>

      {loading && <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중...</p>}
      {!loading && sorted.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">이번 달 기록이 없습니다.</p>
      )}
      {!loading && sorted.length > 0 && (
        <div className="mt-2">
          {visible.map((r) => (
            <button
              key={r.studentId}
              type="button"
              onClick={() => onSelect(r.studentId)}
              className="flex w-full items-center justify-between gap-3 border-b border-border py-2.5 text-left text-sm last:border-b-0 hover:bg-muted/40"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-medium text-foreground">{r.studentName}</span>
                <Badge
                  variant="outline"
                  className="shrink-0 border-transparent text-[11px] text-white"
                  style={{ background: classColor(r.className) }}
                >
                  {stripClassSuffix(r.className)}
                </Badge>
              </div>
              <span className="shrink-0 text-xs font-semibold text-foreground">{pct(r[metric])}</span>
            </button>
          ))}
        </div>
      )}
      {!showAll && sorted.length > 8 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2.5 text-xs font-medium text-primary hover:underline"
        >
          더보기 (하위 30명까지)
        </button>
      )}
    </div>
  );
}

export default function StudentSearchTable({
  students,
  query,
  onQueryChange,
  onSelect,
  selectedId,
}: {
  students: StudentRow[];
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (id: string) => void;
  selectedId?: string | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return students;
    const withVal = students.map((s) => ({ s, v: s[sortKey] }));
    withVal.sort((a, b) => {
      if (a.v === null && b.v === null) return 0;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      return sortDir === "asc" ? a.v - b.v : b.v - a.v;
    });
    return withVal.map((x) => x.s);
  }, [students, sortKey, sortDir]);

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-col items-stretch gap-2.5">
        <CardTitle>학생 검색</CardTitle>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="학생 이름으로 검색"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="pl-9"
          />
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto pt-1">
        {query === "" ? (
          <BottomMetricsPanel onSelect={onSelect} />
        ) : sorted.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">검색 결과가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-1.5 text-left font-medium">이름</th>
                  {(
                    [
                      ["attendanceRate", "출석률"],
                      ["homeworkRate", "과제제출률"],
                      ["vocabPassRate", "단어통과율"],
                    ] as const
                  ).map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => toggleSort(key)}
                      className={cn(
                        "cursor-pointer select-none py-1.5 text-right font-medium hover:text-foreground",
                        sortKey === key && "text-primary"
                      )}
                    >
                      {label}
                      {arrow(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => onSelect(s.id)}
                    className={cn(
                      "cursor-pointer border-b border-border last:border-b-0 hover:bg-muted/40",
                      selectedId === s.id && "bg-accent"
                    )}
                  >
                    <td className="py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground">{s.name}</span>
                        {s.isNew && (
                          <Badge variant="default" className="px-1.5 py-0 text-[10px]">
                            신
                          </Badge>
                        )}
                        {s.status && s.status !== "재원" && (
                          <Badge variant={STATUS_TONE[s.status] ?? "secondary"} className="px-1.5 py-0 text-[10px]">
                            {s.status}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {s.school} {s.grade}
                      </div>
                    </td>
                    <td className="py-2 text-right text-foreground">{pct(s.attendanceRate)}</td>
                    <td className="py-2 text-right text-foreground">{pct(s.homeworkRate)}</td>
                    <td className="py-2 text-right text-foreground">{pct(s.vocabPassRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
