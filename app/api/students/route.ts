import { NextRequest, NextResponse } from "next/server";
import { createStudent, findStudentByName, searchStudents } from "@/lib/notion";
import { todayKST } from "@/lib/date";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const classId = req.nextUrl.searchParams.get("classId") ?? undefined;
  const students = await searchStudents(q, classId);
  return NextResponse.json(students);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const name = (body?.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "이름을 입력해 주세요." }, { status: 400 });
  }
  if (await findStudentByName(name)) {
    return NextResponse.json({ error: "이미 같은 이름의 학생이 등록되어 있습니다." }, { status: 400 });
  }
  const studentId = await createStudent({
    name,
    school: body?.school || undefined,
    grade: body?.grade || undefined,
    status: body?.status || "재원",
    phone: body?.phone || undefined,
    parentPhone: body?.parentPhone || undefined,
    registeredAt: body?.registeredAt || todayKST(),
    enrolledAt: body?.enrolledAt || undefined,
    tuitionDay: body?.tuitionDay ? Number(body.tuitionDay) : undefined,
    learningLevel: body?.learningLevel || undefined,
    classIds: Array.isArray(body?.classIds) ? body.classIds : undefined,
    memo: body?.memo || undefined,
  });
  return NextResponse.json({ ok: true, studentId });
}
