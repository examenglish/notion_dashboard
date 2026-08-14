"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListRow } from "./ListCard";

type ClinicRow = { studentName: string; detail: string };

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function dateLabel(dateStr: string, today: string): string {
  if (dateStr === today) return `오늘 · ${dateStr}`;
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

export default function TodayClinicCard({ today, initialItems }: { today: string; initialItems: ClinicRow[] }) {
  const [date, setDate] = useState(today);
  const [items, setItems] = useState<ClinicRow[]>(initialItems);
  const [loading, setLoading] = useState(false);

  function go(days: number) {
    const nextDate = shiftDate(date, days);
    setDate(nextDate);
    setLoading(true);
    fetch(`/api/today-schedule?date=${nextDate}`)
      .then((r) => r.json())
      .then((data) => {
        const rows: ClinicRow[] = (data.clinicTasks ?? []).map((i: any) => ({
          studentName: i.studentName ?? "-",
          detail: i.time || "-",
        }));
        setItems(rows);
      })
      .finally(() => setLoading(false));
  }

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>조교 클리닉</CardTitle>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="이전 날짜"
            onClick={() => go(-1)}
            className="rounded bg-transparent p-1 text-muted-foreground hover:bg-muted"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <span className="w-20 text-center text-xs font-medium text-muted-foreground">{dateLabel(date, today)}</span>
          <button
            type="button"
            aria-label="다음 날짜"
            onClick={() => go(1)}
            className="rounded bg-transparent p-1 text-muted-foreground hover:bg-muted"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 pt-0.5">
        {loading && <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중...</p>}
        {!loading && items.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">표시할 항목이 없습니다.</p>
        )}
        {!loading && items.map((item, i) => <ListRow key={i} primary={item.studentName} secondary={item.detail} />)}
      </CardContent>
    </Card>
  );
}
