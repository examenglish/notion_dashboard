import { NextRequest, NextResponse } from "next/server";
import { readStaffName, readStaffRole } from "@/lib/session";
import { createManualDraft, createManualSteps, listManuals } from "@/lib/notion";

export const dynamic = "force-dynamic";

// GET: role이 있으면 그 역할을 대상역할로 두거나 비워둔(전체 공개) 매뉴얼만.
// 관리자 화면(role 없음)은 전체(DRAFT 포함)를 본다.
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope"); // "published" | undefined(관리자 전체)
  const role = readStaffRole(req);
  const manuals = await listManuals(scope === "published" ? { status: "PUBLISHED", role } : {});
  return NextResponse.json({ manuals });
}

// 관리자 검토 화면에서 "등록" — AI 분석 결과(요약 + 단계들)를 사람이 수정한
// 뒤 여기서 한 번에 Manual + ManualStep들을 만든다. 상태는 항상 DRAFT로
// 시작한다(섹션21, AI 결과 자동 공개 금지) — 게시는 별도 PATCH로만.
export async function POST(req: NextRequest) {
  const role = readStaffRole(req);
  if (role !== "원장" && role !== "행정" && role !== "강사") {
    return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const title = (body?.title ?? "").trim();
  const sourceVideoUrl = (body?.sourceVideoUrl ?? "").trim();
  const steps = Array.isArray(body?.steps) ? body.steps : [];
  if (!title || steps.length === 0) {
    return NextResponse.json({ ok: false, message: "제목과 최소 1개의 단계가 필요합니다." }, { status: 400 });
  }

  try {
    const manualId = await createManualDraft({
      title,
      category: body?.category ?? "기타",
      targetRoles: Array.isArray(body?.targetRoles) ? body.targetRoles : [],
      sourceVideoUrl,
      summary: body?.summary ?? "",
      createdBy: readStaffName(req) || "",
    });
    await createManualSteps(
      manualId,
      steps.map((s: any, i: number) => ({
        order: i + 1,
        title: s.title ?? `${i + 1}단계`,
        description: s.description ?? "",
        screenshot: s.screenshot ?? "",
        videoTimestamp: s.videoTimestamp ?? "",
        warning: s.warning ?? "",
        relatedPath: s.relatedPath ?? "",
        keywords: s.keywords ?? "",
      }))
    );
    return NextResponse.json({ ok: true, id: manualId });
  } catch (err) {
    console.error("createManualDraft failed", err);
    const message = err instanceof Error ? err.message : "저장에 실패했습니다.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
