import { NextRequest, NextResponse } from "next/server";
import { readStaffName, readStaffRole } from "@/lib/session";
import { runCreateTasksCommand } from "@/lib/nl-input";
import { notifyTaskAssignments } from "@/lib/slack";

export const dynamic = "force-dynamic";

// 재지시(섹션13) — 완료된 업무 상세에서 원장이 자연어로 다시 지시하면,
// 상위업무(parentTaskId)로 연결된 후속 업무를 새로 만든다.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const role = readStaffRole(req);
  if (role !== "원장" && role !== "행정" && role !== "강사") {
    return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const text = (body?.text ?? "").trim();
  if (!text) return NextResponse.json({ ok: false, message: "입력 내용이 없습니다." }, { status: 400 });

  try {
    const result = await runCreateTasksCommand(text, { staffName: readStaffName(req) || undefined, parentTaskId: params.id });

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
  } catch (err) {
    console.error("/api/tasks/[id]/followup failed", err);
    const message = err instanceof Error ? err.message : "처리 중 오류가 발생했습니다.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
