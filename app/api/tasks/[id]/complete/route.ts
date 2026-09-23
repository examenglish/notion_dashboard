import { NextRequest, NextResponse } from "next/server";
import { completeTaskEntry, getTask, hasPriorFailure, pendingDependenciesForTask } from "@/lib/notion";
import { classifyFeedback } from "@/lib/tasks";
import { readStaffId } from "@/lib/session";
import { postSlackMessage } from "@/lib/slack";

export const dynamic = "force-dynamic";

// 결과보고(섹션10) — 완료 체크 하나가 아니라 유형별 결과값 + 메모를 받는다.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const staffId = readStaffId(req);
  if (!staffId) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const outcome = (body?.outcome ?? "").trim();
  if (!outcome) return NextResponse.json({ ok: false, message: "결과를 선택해주세요." }, { status: 400 });
  const memo = typeof body?.memo === "string" ? body.memo : undefined;
  const urgentFlag = !!body?.urgent;

  const task = await getTask(params.id);
  if (!task) return NextResponse.json({ ok: false, message: "업무를 찾을 수 없습니다." }, { status: 404 });
  // 선행 업무(workflow.dependsOn)가 끝나기 전에는 완료 처리할 수 없다.
  const waiting = await pendingDependenciesForTask(params.id);
  if (waiting.length > 0) {
    return NextResponse.json({ ok: false, message: `먼저 끝나야 하는 업무가 있습니다: ${waiting.join(", ")}` }, { status: 409 });
  }

  // 같은 학생·같은 업무유형에서 실패가 반복되면(섹션11) 직원이 긴급 표시를
  // 안 했어도 자동으로 URGENT로 올라가도록, 이전 이력을 확인한다.
  const repeatFailure = await hasPriorFailure(task.studentId, task.typeLabel, params.id);
  // repeatFailure로 인한 URGENT 승격은 원장 확인함이 다시 계산하지 않고도
  // 그대로 유지되도록 긴급여부 자체에 반영해둔다.
  await completeTaskEntry(params.id, { outcome, memo, urgent: urgentFlag || repeatFailure, completedBy: staffId });

  const tier = classifyFeedback({ outcome, urgentFlag, repeatFailure });
  // NORMAL 완료는 절대 발신하지 않는다(섹션15, 알림 폭탄 방지) — REVIEW/URGENT만.
  if (tier !== "NORMAL") {
    void postSlackMessage(
      process.env.SLACK_TASK_CHANNEL_ID,
      `${tier === "URGENT" ? "🚨" : "👀"} [${tier}] ${task.typeLabel}${task.studentName !== "-" ? " · " + task.studentName : ""} — 결과: ${outcome}${memo ? " (" + memo + ")" : ""}`
    );
  }
  return NextResponse.json({ ok: true, tier });
}
