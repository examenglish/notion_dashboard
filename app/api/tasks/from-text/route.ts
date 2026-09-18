import { NextRequest, NextResponse } from "next/server";
import { readStaffName, readStaffId } from "@/lib/session";
import { runCreateTasksCommand } from "@/lib/nl-input";
import { notifyTaskAssignments } from "@/lib/slack";

export const dynamic = "force-dynamic";

// 대시보드 상단 대형 AI 입력창("업무 만들기")의 전용 엔드포인트. 기존
// /api/nl-input과 완전히 분리되어 있어 기존 입력창/Slack 동작에는 영향이 없다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text = (body?.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ ok: false, message: "입력 내용이 없습니다." }, { status: 400 });
  }
  if (!readStaffId(req)) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const result = await runCreateTasksCommand(text, { staffName: readStaffName(req) || undefined });

  switch (result.kind) {
    case "created":
      notifyTaskAssignments(result.tasks);
      return NextResponse.json({ ok: true, tasks: result.tasks, warnings: result.warnings });
    case "clarify":
      return NextResponse.json({ ok: false, message: result.message });
    case "ai_error":
      return NextResponse.json({ ok: false, message: result.message }, { status: 502 });
    case "save_error":
      return NextResponse.json({ ok: false, message: result.message }, { status: 500 });
  }
}
