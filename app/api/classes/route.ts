import { NextRequest, NextResponse } from "next/server";
import { createClass, listClasses } from "@/lib/notion";
import { serializeWorkHours, type WorkHours } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET() {
  const classes = await listClasses();
  return NextResponse.json(classes);
}

// dayHours가 오면(요일별 시간 폼) 요일/시간을 그 안에서 뽑아 쓰고, 없으면
// 옛 방식의 평평한 days/time을 그대로 받는다 — 둘 다 지원해 다른 경로(예:
// 자연어 입력)로 반이 만들어지는 경우도 깨지지 않는다.
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
    time: body?.time || undefined,
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const name = (body?.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "반이름을 입력해 주세요." }, { status: 400 });
  }
  const { days, time } = resolveDaysAndTime(body);
  const classId = await createClass({
    name,
    teachers: Array.isArray(body?.teachers) ? body.teachers : undefined,
    days,
    time,
    level: body?.level || undefined,
  });
  return NextResponse.json({ ok: true, classId });
}
