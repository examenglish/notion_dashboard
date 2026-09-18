import { NextRequest, NextResponse } from "next/server";
import { resolveRelativeDate } from "@/lib/anthropic";
import { createPersonalTodo } from "@/lib/notion";
import { todayKST } from "@/lib/date";
import { readStaffName, readStaffId } from "@/lib/session";
import { runNaturalLanguageCommand, runCreateTasksCommand, parseSlashCommand, matchToDoListShortcut } from "@/lib/nl-input";
import { notifyTaskAssignments } from "@/lib/slack";

export const dynamic = "force-dynamic";

// 대시보드 최상단 통합 AI 입력창의 엔드포인트 — 기존 /api/nl-input과
// /api/tasks/from-text를 대체하는 게 아니라 그 둘의 로직(runNaturalLanguageCommand,
// runCreateTasksCommand)을 그대로 재사용해 "한 입력창"으로 이어붙인다.
// 두 엔드포인트 자체는 남겨두므로 Slack 슬래시태그 등 기존 호출부는 안 건드린다.
//
// 순서: /to do list(결정론적) → 슬래시 명령(/보강 등, 기존 그대로 legacy로) →
// 그 외 텍스트는 먼저 업무 생성(create_tasks)을 시도하고, AI가 "실행 가능한
// 업무를 못 찾겠다"(clarify)고 답하면 그제서야 기존 학생기록 파이프라인
// (행정실/일정/상담/조치)으로 넘긴다 — 두 체계 모두 그대로 쓸 수 있다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text = (body?.text ?? "").trim();
  const confirmNewStudent = !!body?.confirmNewStudent;
  const forceNewStudent = !!body?.forceNewStudent;
  const selectedStudentId = typeof body?.selectedStudentId === "string" ? body.selectedStudentId : undefined;
  // 후보 선택/신입생 확인 라운드트립은 항상 기존 학생기록 파이프라인에서만
  // 발생하므로, 그 재요청에서는 업무 생성 시도를 또 하지 않고 바로 legacy로.
  const forceLegacy = !!body?.forceLegacy || confirmNewStudent || forceNewStudent || !!selectedStudentId;
  if (!text) {
    return NextResponse.json({ ok: false, message: "입력 내용이 없습니다." }, { status: 400 });
  }

  const today = todayKST();
  const staffName = readStaffName(req) || undefined;
  const staffId = readStaffId(req);

  const todoContent = matchToDoListShortcut(text);
  if (todoContent !== null) {
    if (!staffId) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." });
    if (!todoContent) return NextResponse.json({ ok: false, message: "/to do list 뒤에 할일 내용을 적어주세요." });
    const date = resolveRelativeDate(todoContent, today) ?? today;
    await createPersonalTodo({ staffId, content: todoContent, date });
    return NextResponse.json({ ok: true, mode: "legacy", message: `개인 할일에 저장했습니다: ${todoContent}` });
  }

  const { isSlashCommand, rest: slashRest, forceTool, forcedScheduleType, forcedInboxType } = parseSlashCommand(text);

  async function runLegacy(t: string) {
    const result = await runNaturalLanguageCommand(t, {
      staffName,
      forceTool,
      forcedScheduleType,
      forcedInboxType,
      selectedStudentId,
      confirmNewStudent,
      forceNewStudent,
    });
    switch (result.kind) {
      case "saved":
        return NextResponse.json({ ok: true, mode: "legacy", message: result.message });
      case "clarify":
        return NextResponse.json({ ok: false, mode: "legacy", message: result.message });
      case "not_found":
        return NextResponse.json({
          ok: false,
          mode: "legacy",
          needsConfirm: true,
          message: `"${result.name}" 학생을 찾을 수 없는데, 신입생으로 새로 등록할까요?`,
        });
      case "ambiguous":
        return NextResponse.json({
          ok: false,
          mode: "legacy",
          needsSelection: true,
          message: "동명이인이 있어 확인이 필요합니다. 누구인가요?",
          candidates: result.candidates,
        });
      case "missing_name":
        return NextResponse.json({ ok: false, mode: "legacy", message: "학생 이름을 확인할 수 없습니다. 이름을 포함해서 다시 입력해 주세요." });
      case "ai_error":
        return NextResponse.json({ ok: false, mode: "legacy", message: result.message }, { status: 502 });
      case "save_error":
        return NextResponse.json({ ok: false, mode: "legacy", message: result.message }, { status: 500 });
    }
  }

  // 슬래시 명령(/보강 등)은 처음부터 그 카테고리가 확정된 것이므로 업무 생성을
  // 시도할 이유가 없다 — 곧바로 기존 파이프라인으로.
  if (isSlashCommand || forceLegacy) {
    return runLegacy(slashRest);
  }

  const taskResult = await runCreateTasksCommand(text, { staffName });
  if (taskResult.kind === "created") {
    notifyTaskAssignments(taskResult.tasks);
    return NextResponse.json({ ok: true, mode: "tasks", tasks: taskResult.tasks, warnings: taskResult.warnings });
  }
  if (taskResult.kind === "clarify") {
    // 업무로 해석되지 않으면(예: 상담 기록, 행정실 문의성 문장) 기존 학생기록
    // 파이프라인이 이어받는다.
    return runLegacy(text);
  }
  // ai_error/save_error — 업무 생성 시도 자체가 실패한 경우는 그대로 반환.
  const status = taskResult.kind === "ai_error" ? 502 : 500;
  return NextResponse.json({ ok: false, mode: "tasks", message: taskResult.message }, { status });
}
