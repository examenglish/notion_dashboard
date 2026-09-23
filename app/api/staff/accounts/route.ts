import { NextRequest, NextResponse } from "next/server";
import { listStaffAccounts } from "@/lib/notion";
import { readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// 원장 전용 직원 계정 목록(퇴사/비활성 포함). 역할은 middleware가 서명 쿠키를 검증해 넣은
// x-staff-role로만 판단한다. 비밀번호/해시는 응답에 포함하지 않는다.
export async function GET(req: NextRequest) {
  if (readStaffRole(req) !== "원장") {
    return NextResponse.json({ error: "원장만 직원 계정을 관리할 수 있습니다." }, { status: 403 });
  }
  return NextResponse.json({ accounts: await listStaffAccounts() });
}
