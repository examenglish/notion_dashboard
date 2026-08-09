import { NextRequest, NextResponse } from "next/server";
import { updateClass } from "@/lib/notion";
import { serializeWorkHours, type WorkHours } from "@/lib/format";

export const dynamic = "force-dynamic";

// dayHours가 오면(요일별 시간 폼) 요일/시간을 그 안에서 뽑아 쓰고, 없으면
// 옛 방식의 평평한 days/time을 그대로 받는다.
function resolveDaysAndTime(body: any): { days?: string[]; time?: string } {
  const raw = body?.dayHours;
  if (raw && typeof raw === "object") {
    const dayHours: WorkHours = {};
    for (const [day, range] of Object.entries(raw as Record<string, any>)) {
      const start = typeof (range as any)?.start === "string" ? (range as any).start : "";
      const end = typeof (range as any)?.end === "string" ? (range as any).end : "";
      if (start && end) dayHours[day] = { start, end };
    }
    return { days: Object.keys(dayHours), time: serializeWorkHours(dayHours) };
  }
  return {
    days: Array.isArray(body?.days) ? body.days : undefined,
    time: body?.time !== undefined ? body.time : undefined,
  };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { name, teachers, level } = body;
  if (name !== undefined && !String(name).trim()) {
    return NextResponse.json({ error: "반이름을 입력해 주세요." }, { status: 400 });
  }
  const { days, time } = resolveDaysAndTime(body);
  await updateClass(params.id, {
    name: name !== undefined ? String(name).trim() : undefined,
    teachers: Array.isArray(teachers) ? teachers : undefined,
    days,
    time,
    level,
  });
  return NextResponse.json({ ok: true });
}
