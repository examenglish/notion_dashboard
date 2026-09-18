import { NextRequest, NextResponse } from "next/server";
import { claimTask } from "@/lib/notion";
import { readStaffId } from "@/lib/session";

export const dynamic = "force-dynamic";

// 공용업무풀 "내가 할게요"(섹션6) — 서버에서 담당자 비어있음을 다시 확인한
// 뒤에만 배정해 동시 클릭으로 두 사람에게 같은 업무가 잡히는 걸 막는다.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const staffId = readStaffId(req);
  if (!staffId) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const result = await claimTask(params.id, staffId);
  if (!result.ok) return NextResponse.json(result, { status: 409 });
  return NextResponse.json(result);
}
