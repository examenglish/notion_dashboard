import { NextRequest, NextResponse } from "next/server";
import { getStaffInBranch, resetStaffPin } from "@/lib/notion";
import { readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// 원장 전용 비밀번호(PIN) 재설정 — 기존 비밀번호를 보여주는 기능은 없고 새 값으로만 바꾼다.
// 평문 PIN은 로그/응답에 남기지 않는다. 현재 지점 직원만 대상(다른 지점 id는 404).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (readStaffRole(req) !== "원장") {
    return NextResponse.json({ error: "원장만 비밀번호를 재설정할 수 있습니다." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const newPin = typeof body?.newPin === "string" ? body.newPin : "";
  const confirmPin = typeof body?.confirmPin === "string" ? body.confirmPin : "";
  if (!/^\d{4,6}$/.test(newPin)) {
    return NextResponse.json({ error: "새 비밀번호는 숫자 4~6자리로 입력해주세요." }, { status: 400 });
  }
  if (newPin !== confirmPin) {
    return NextResponse.json({ error: "새 비밀번호와 확인이 일치하지 않습니다." }, { status: 400 });
  }
  const target = await getStaffInBranch(params.id);
  if (!target) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
  try {
    await resetStaffPin(params.id, newPin);
  } catch (err) {
    console.error("resetStaffPin failed", params.id, err instanceof Error ? err.name : "error");
    return NextResponse.json({ error: "비밀번호 재설정에 실패했습니다." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
