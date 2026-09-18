import { NextRequest, NextResponse } from "next/server";
import { getManual, listManualSteps, updateManual } from "@/lib/notion";
import { readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const manual = await getManual(params.id);
  if (!manual) return NextResponse.json({ error: "매뉴얼을 찾을 수 없습니다." }, { status: 404 });
  const steps = await listManualSteps(params.id);
  return NextResponse.json({ manual, steps });
}

// 관리자 검토(섹션21) — 제목/카테고리/대상역할/요약/상태(게시 포함) 수정.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const role = readStaffRole(req);
  if (role !== "원장" && role !== "행정" && role !== "강사") {
    return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  try {
    await updateManual(params.id, {
      title: body?.title,
      category: body?.category,
      targetRoles: body?.targetRoles,
      status: body?.status,
      summary: body?.summary,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "저장에 실패했습니다.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
