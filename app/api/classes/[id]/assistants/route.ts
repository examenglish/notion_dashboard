import { NextRequest, NextResponse } from "next/server";
import { assignClassAssistants, listStaff } from "@/lib/notion";
import { readStaffId, readStaffName, readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// 반별 담당조교 배정은 원장/행정만. 새로 배정할 수 있는 사람은 이 지점의 재직(활성)
// 조교뿐이다 — 화면 체크 목록만이 아니라 서버에서도 막는다(listStaff는 현재 지점의
// 비활성 아닌 직원만 돌려준다).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const role = readStaffRole(req);
  if (role !== "원장" && role !== "행정") {
    return NextResponse.json({ error: "원장/행정만 담당 조교를 배정할 수 있습니다." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.assistantIds) ? body.assistantIds : [];
  const assistantIds = Array.from(new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0)));
  const activeAssistants = new Set((await listStaff()).filter((s) => s.role === "조교").map((s) => s.id));
  const invalid = assistantIds.filter((id) => !activeAssistants.has(id));
  if (invalid.length > 0) {
    return NextResponse.json({ error: "재직 중인 조교만 배정할 수 있습니다." }, { status: 400 });
  }
  const found = await assignClassAssistants(params.id, assistantIds, { id: readStaffId(req) || null, name: readStaffName(req) || null });
  if (!found) return NextResponse.json({ error: "반을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
