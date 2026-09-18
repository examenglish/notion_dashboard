import { NextRequest, NextResponse } from "next/server";
import { getTaskThread } from "@/lib/notion";

export const dynamic = "force-dynamic";

// 업무 상세 + 지시→처리→결과→재지시 히스토리(섹션13).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const thread = await getTaskThread(params.id);
  if (thread.length === 0) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ task: thread[0], thread });
}
