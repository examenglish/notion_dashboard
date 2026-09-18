import { NextRequest, NextResponse } from "next/server";
import { updateManualStep, deleteManualStep } from "@/lib/notion";
import { readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

function canEdit(role: string) {
  return role === "원장" || role === "행정" || role === "강사";
}

// 개인정보 가능성이 있는 프레임 제외(섹션20)도 이 PATCH로 처리한다 —
// screenshot을 빈 문자열로 비우면 그 단계에서 스크린샷만 빠진다.
export async function PATCH(req: NextRequest, { params }: { params: { id: string; stepId: string } }) {
  const role = readStaffRole(req);
  if (!canEdit(role)) return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 403 });
  const body = await req.json().catch(() => null);
  await updateManualStep(params.stepId, {
    title: body?.title,
    description: body?.description,
    screenshot: body?.screenshot,
    warning: body?.warning,
    relatedPath: body?.relatedPath,
    order: body?.order,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string; stepId: string } }) {
  const role = readStaffRole(req);
  if (!canEdit(role)) return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 403 });
  await deleteManualStep(params.stepId);
  return NextResponse.json({ ok: true });
}
