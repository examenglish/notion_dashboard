import { NextRequest, NextResponse } from "next/server";
import { deleteClass, findClassByName, listClasses, updateClass } from "@/lib/notion";
import { serializeWorkHours, type WorkHours, type DayTeachers } from "@/lib/format";
import { readStaffRole } from "@/lib/session";

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

// 요일별·교시별 담당교사(day -> {교시: 이름})를 받아 빈 값을 걸러낸다.
// 지정 안 한 요일/교시는 반 전체 담당교사(teachers)를 따르는 것으로 취급.
function resolveDayTeachers(body: any): DayTeachers | undefined {
  const raw = body?.dayTeachers;
  if (!raw || typeof raw !== "object") return undefined;
  const dayTeachers: DayTeachers = {};
  for (const [day, periods] of Object.entries(raw as Record<string, any>)) {
    if (!periods || typeof periods !== "object") continue;
    const cleaned: Record<string, string> = {};
    for (const [period, name] of Object.entries(periods as Record<string, any>)) {
      if (typeof name === "string" && name.trim()) cleaned[period] = name.trim();
    }
    if (Object.keys(cleaned).length > 0) dayTeachers[day] = cleaned;
  }
  return dayTeachers;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { name, teachers, level, type } = body;
  if (name !== undefined && !String(name).trim()) {
    return NextResponse.json({ error: "반이름을 입력해 주세요." }, { status: 400 });
  }
  if (name !== undefined && (await findClassByName(String(name), params.id))) {
    return NextResponse.json({ error: "이미 같은 이름의 반이 있습니다." }, { status: 400 });
  }
  const { days, time } = resolveDaysAndTime(body);
  await updateClass(params.id, {
    name: name !== undefined ? String(name).trim() : undefined,
    teachers: Array.isArray(teachers) ? teachers : undefined,
    dayTeachers: resolveDayTeachers(body),
    days,
    time,
    level,
    type: type !== undefined ? (type === "시험대비" ? "시험대비" : "정규") : undefined,
  });
  return NextResponse.json({ ok: true });
}

// 소속학생이 없는 반만 삭제(보관 처리) 가능 — 학생이 있으면 먼저 반을
// 옮기거나 빼야 한다. 원장/행정만 가능(다른 파괴적 작업들과 동일한 권한).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const role = readStaffRole(req);
  if (role !== "원장" && role !== "행정") {
    return NextResponse.json({ error: "삭제는 원장/행정만 할 수 있습니다." }, { status: 403 });
  }
  const classes = await listClasses();
  const cls = classes.find((c) => c.id === params.id);
  if (!cls) {
    return NextResponse.json({ error: "반을 찾을 수 없습니다." }, { status: 404 });
  }
  if (cls.studentIds.length > 0) {
    return NextResponse.json({ error: "소속 학생이 있는 반은 삭제할 수 없습니다." }, { status: 400 });
  }
  await deleteClass(params.id);
  return NextResponse.json({ ok: true });
}
