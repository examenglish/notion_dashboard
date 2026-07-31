import { NextRequest, NextResponse } from "next/server";
import { getAssistantBrief } from "@/lib/notion";
import { readStaffId } from "@/lib/session";
import { todayKST } from "@/lib/date";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const assistantId = readStaffId(req);
  if (!assistantId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  const date = req.nextUrl.searchParams.get("date") ?? todayKST();
  const brief = await getAssistantBrief(assistantId, date);
  return NextResponse.json(brief);
}
