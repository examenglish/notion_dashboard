import { NextRequest, NextResponse } from "next/server";
import { listStaff, createStaff } from "@/lib/notion";
import { readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// Public endpoint (pre-login): returns staff names/roles only, never PINs.
export async function GET() {
  const staff = await listStaff();
  return NextResponse.json(
    staff.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      workHours: s.workHours,
    }))
  );
}

// 강사/조교/행정 계정 등록은 원장만 — 계정 생성·비밀번호 재설정·비활성화는 일반 조교/행정이
// 할 수 없게 서버에서 다시 확인한다(x-staff-role은 middleware가 서명 쿠키로 검증해 넣은 값).
export async function POST(req: NextRequest) {
  const role = readStaffRole(req);
  if (role !== "원장") {
    return NextResponse.json({ error: "원장만 계정을 등록할 수 있습니다." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const newRole = body?.role;
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "이름을 입력해주세요." }, { status: 400 });
  }
  if (newRole !== "강사" && newRole !== "조교" && newRole !== "행정") {
    return NextResponse.json({ error: "역할은 강사, 조교, 행정 중 하나여야 합니다." }, { status: 400 });
  }
  // 로그인(/api/login)이 4~6자리만 받으므로 같은 범위로 맞춘다(7~8자리는 로그인 불가였음).
  if (!/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: "비밀번호는 숫자 4~6자리로 입력해주세요." }, { status: 400 });
  }
  try {
    const id = await createStaff(name, newRole, pin);
    return NextResponse.json({ ok: true, id });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "등록에 실패했습니다." }, { status: 400 });
  }
}
