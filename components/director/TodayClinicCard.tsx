"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Popup from "./Popup";

type ClinicItem = {
  id: string;
  studentName: string;
  time: string;
  memo: string;
  owner: string;
  done: boolean;
  school: string;
  gradeNum: string;
};

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

function ClinicRow({ item, onClick }: { item: ClinicItem; onClick: () => void }) {
  const ownerLabel = item.owner && item.owner !== "-" ? item.owner : "담당 미배정";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-0.5 border-b border-border bg-transparent px-0 py-1.5 text-left last:border-b-0 hover:bg-muted/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-foreground">{item.studentName}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{item.time || "시간 미정"}</span>
      </div>
      <div className="truncate text-[11px] text-muted-foreground">
        {ownerLabel}
        {item.memo ? ` · ${item.memo}` : ""}
      </div>
    </button>
  );
}

export default function TodayClinicCard({ today, initialItems }: { today: string; initialItems: ClinicItem[] }) {
  const [date, setDate] = useState(today);
  const [items, setItems] = useState<ClinicItem[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ClinicItem | null>(null);

  function go(days: number) {
    const nextDate = shiftDate(date, days);
    setDate(nextDate);
    setLoading(true);
    fetch(`/api/today-schedule?date=${nextDate}`)
      .then((r) => r.json())
      .then((data) => setItems(Array.isArray(data.clinicTasks) ? data.clinicTasks : []))
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
        {!loading && items.map((item) => <ClinicRow key={item.id} item={item} onClick={() => setSelected(item)} />)}
      </CardContent>

      {selected && (
        <Popup title={`${selected.studentName} · 클리닉`} countLabel={dateLabel(date, today)} onClose={() => setSelected(null)}>
          <div className="space-y-2 text-sm">
            <div className="text-xs text-muted-foreground">
              {selected.school} {selected.gradeNum && `${selected.gradeNum}학년`}
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">담당 조교</span>
              <p className="text-foreground">{selected.owner && selected.owner !== "-" ? selected.owner : "미배정"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">시간</span>
              <p className="text-foreground">{selected.time || "미정"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">완료 여부</span>
              <p className="text-foreground">{selected.done ? "완료" : "예정"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">학습 내용</span>
              <p className="whitespace-pre-wrap text-foreground">{selected.memo || "메모가 없습니다."}</p>
            </div>
          </div>
        </Popup>
      )}
    </Card>
  );
}
