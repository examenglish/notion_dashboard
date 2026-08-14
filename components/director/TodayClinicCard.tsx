"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Popup from "./Popup";

type ClinicItem = {
  id: string;
  studentName: string;
  studentNames: string[];
  assistantName: string;
  content: string;
  nextPrep: string;
  checked: boolean;
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
  const assistant = item.assistantName && item.assistantName !== "-" ? item.assistantName : "담당 미배정";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-0.5 border-b border-border bg-transparent px-0 py-1.5 text-left last:border-b-0 hover:bg-muted/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-foreground">{item.studentName}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{assistant}</span>
      </div>
      <div className="truncate text-[11px] text-muted-foreground">{item.content || "작성된 내용이 없습니다."}</div>
    </button>
  );
}

// 원장 대시보드 "조교 클리닉" 카드 — DB⑱(지시된 할일)이 아니라 조교가 실제로
// 작성한 클리닉 기록(DB⑮, /api/clinic-records?date=)을 보여준다. 한 기록이
// 여러 학생을 담당학생으로 묶을 수 있어(예: 반 전체 클리닉), 학생별로 한
// 줄씩 펼쳐 보여주되 클릭하면 그 기록에 포함된 학생 전체를 팝업에 표시한다.
export default function TodayClinicCard({ today, initialItems }: { today: string; initialItems: ClinicItem[] }) {
  const [date, setDate] = useState(today);
  const [items, setItems] = useState<ClinicItem[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ClinicItem | null>(null);

  function go(days: number) {
    const nextDate = shiftDate(date, days);
    setDate(nextDate);
    setLoading(true);
    fetch(`/api/clinic-records?date=${nextDate}`)
      .then((r) => r.json())
      .then((records: any[]) => {
        const rows: ClinicItem[] = (Array.isArray(records) ? records : []).flatMap((r) =>
          (r.studentNames.length > 0 ? r.studentNames : ["-"]).map((name: string, idx: number) => ({
            id: `${r.id}:${idx}`,
            studentName: name,
            studentNames: r.studentNames,
            assistantName: r.assistantName,
            content: r.content,
            nextPrep: r.nextPrep,
            checked: r.checked,
          }))
        );
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
          <p className="py-6 text-center text-sm text-muted-foreground">작성된 클리닉 기록이 없습니다.</p>
        )}
        {!loading && items.map((item) => <ClinicRow key={item.id} item={item} onClick={() => setSelected(item)} />)}
      </CardContent>

      {selected && (
        <Popup
          title={`${selected.studentNames.join(", ") || selected.studentName} · 클리닉`}
          countLabel={dateLabel(date, today)}
          onClose={() => setSelected(null)}
        >
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-xs font-medium text-muted-foreground">담당 조교</span>
              <p className="text-foreground">{selected.assistantName && selected.assistantName !== "-" ? selected.assistantName : "미배정"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">확인 완료 여부</span>
              <p className="text-foreground">{selected.checked ? "확인완료" : "미확인"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">진행 내용</span>
              <p className="whitespace-pre-wrap text-foreground">{selected.content || "작성된 내용이 없습니다."}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">다음 준비사항</span>
              <p className="whitespace-pre-wrap text-foreground">{selected.nextPrep || "-"}</p>
            </div>
          </div>
        </Popup>
      )}
    </Card>
  );
}
