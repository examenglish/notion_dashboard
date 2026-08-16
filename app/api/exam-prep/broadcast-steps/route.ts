import { NextRequest, NextResponse } from "next/server";
import { broadcastTextSourceSteps } from "@/lib/notion";
import { TEXT_CATEGORIES } from "@/lib/examPrep";

export const dynamic = "force-dynamic";

// 학생 시트에서 "전체 적용"을 누르면 호출 — 그 단원을 이미 가진 같은
// 학교·학년의 다른 학생들에게 지금 워크북 체크 상태를 한 번 복사한다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.school !== "string" ||
    typeof body.grade !== "string" ||
    typeof body.category !== "string" ||
    !TEXT_CATEGORIES.includes(body.category) ||
    typeof body.label !== "string" ||
    !body.label.trim() ||
    !Array.isArray(body.steps) ||
    !body.steps.every((s: any) => s && typeof s.label === "string" && typeof s.done === "boolean")
  ) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  try {
    const updated = await broadcastTextSourceSteps({
      school: body.school,
      grade: body.grade,
      excludeStudentId: typeof body.excludeStudentId === "string" ? body.excludeStudentId : "",
      category: body.category,
      label: body.label,
      steps: body.steps,
    });
    return NextResponse.json({ updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "적용에 실패했습니다." }, { status: 500 });
  }
}
