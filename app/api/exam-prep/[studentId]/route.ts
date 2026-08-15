import { NextRequest, NextResponse } from "next/server";
import { getExamPrepSheet, saveExamPrepSheet } from "@/lib/notion";
import { readStaffName } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { studentId: string } }) {
  const sheet = await getExamPrepSheet(params.studentId);
  return NextResponse.json(sheet);
}

export async function PUT(req: NextRequest, { params }: { params: { studentId: string } }) {
  const body = await req.json().catch(() => null);
  if (!body || (body.level !== "중등" && body.level !== "고등") || !body.data) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  try {
    const result = await saveExamPrepSheet({
      id: typeof body.id === "string" ? body.id : null,
      studentId: params.studentId,
      level: body.level,
      examTitle: typeof body.examTitle === "string" ? body.examTitle : "",
      examRange: typeof body.examRange === "string" ? body.examRange : "",
      examDate: typeof body.examDate === "string" && body.examDate ? body.examDate : null,
      teachers: Array.isArray(body.teachers)
        ? body.teachers.filter((t: unknown) => typeof t === "string")
        : [readStaffName(req)].filter(Boolean),
      weakPoints: typeof body.weakPoints === "string" ? body.weakPoints : "",
      data: body.data,
    });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "저장에 실패했습니다." }, { status: 500 });
  }
}
