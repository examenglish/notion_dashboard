import { NextRequest, NextResponse } from "next/server";
import { acknowledgeTask } from "@/lib/notion";
import { readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// 원장 확인함(섹션12) 항목을 "확인함"으로 표시 — 원장/행정만.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const role = readStaffRole(req);
  if (role !== "원장" && role !== "행정") {
    return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 403 });
  }
  await acknowledgeTask(params.id);
  return NextResponse.json({ ok: true });
}
