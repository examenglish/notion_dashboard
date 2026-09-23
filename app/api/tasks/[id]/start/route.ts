import { NextRequest, NextResponse } from "next/server";
import { startTask } from "@/lib/notion";
import { readStaffId } from "@/lib/session";

export const dynamic = "force-dynamic";

// 조교 "진행 시작" — 내 업무(대기) 또는 업무풀(담당자 없음)의 업무를 진행중으로.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const staffId = readStaffId(req);
  if (!staffId) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const result = await startTask(params.id, staffId);
  if (!result.ok) return NextResponse.json(result, { status: 409 });
  return NextResponse.json(result);
}
