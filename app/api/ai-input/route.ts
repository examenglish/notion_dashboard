import { NextRequest, NextResponse } from "next/server";
import { resolveRelativeDate } from "@/lib/anthropic";
import { createPersonalTodo } from "@/lib/notion";
import { todayKST } from "@/lib/date";
import { readStaffName, readStaffId, readStaffRole } from "@/lib/session";
import {
  runNaturalLanguageCommand,
  runUnifiedNlInput,
  continuePendingInput,
  parseSlashCommand,
  matchToDoListShortcut,
  type PendingAction,
  type ClassContext,
  EXPLICIT_NEW_STUDENT,
} from "@/lib/nl-input";
import { notifyTaskAssignments } from "@/lib/slack";
import { mark } from "@/lib/timing";

export const dynamic = "force-dynamic";

// 대시보드 최상단 통합 AI 입력창의 엔드포인트 — 기존 /api/nl-input과
// /api/tasks/from-text를 대체하는 게 아니라 그 둘의 로직(runNaturalLanguageCommand,
// 자유 텍스트는 runUnifiedNlInput)을 재사용해 "한 입력창"으로 이어붙인다.
// 두 엔드포인트 자체는 남겨두므로 Slack 슬래시태그 등 기존 호출부는 안 건드린다.
//
// 순서: /to do list(결정론적) → 슬래시 명령(/보강 등, 기존 그대로 legacy로) →
// 그 외 자유 텍스트는 runUnifiedNlInput 한 번으로 처리한다. 2026-09-19 이전엔
// 여기서 먼저 업무 생성(create_tasks)을 시도하고 clarify면 기존 4-tool
// 파이프라인으로 다시 LLM을 불렀는데(요청당 LLM 2회, 실측 총 9.9초 중
// 7.1초가 LLM), 그 waterfall을 없애고 LLM 1회로 문장을 여러 intent로 나눠
// 한 번에 처리한다(staff.md PART 8). runNaturalLanguageCommand 자체는
// 슬래시 명령/Slack이 계속 쓰므로 그대로 둔다.
export async function POST(req: NextRequest) {
  mark("route:start");
  const body = await req.json().catch(() => null);
  const text = (body?.text ?? "").trim();
  // 대화형 보완: 앞 요청에서 "정보가 더 필요합니다"로 돌려준 pending(구조화된
  // draft + 부족 항목)과 이번 답변을 합쳐 이어서 처리한다. 답변은 전체 명령으로
  // 재해석하지 않는다(lib/nl-input.ts continuePendingInput).
  const pending = body?.pending;
  if (pending && typeof pending === "object" && pending.draft && Array.isArray(pending.missing)) {
    const choiceId = typeof body?.choiceId === "string" ? body.choiceId : undefined;
    if (!text && !choiceId) return NextResponse.json({ ok: false, message: "답변을 입력해 주세요." }, { status: 400 });
    try {
      const result = await continuePendingInput(pending as PendingAction, text, {
        choiceId,
        staffName: readStaffName(req) || undefined,
        role: readStaffRole(req) || undefined,
      });
      if (result.tasks.length > 0) notifyTaskAssignments(result.tasks);
      return NextResponse.json({
        ok: result.ok,
        mode: "multi",
        message: result.outcomes.map((o) => o.message).join("\n"),
        outcomes: result.outcomes,
        context: result.context ?? null,
      });
    } catch (err) {
      console.error("/api/ai-input pending failed", err);
      const message = err instanceof Error ? err.message : "처리 중 오류가 발생했습니다.";
      return NextResponse.json({ ok: false, message }, { status: 500 });
    }
  }
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

  async function runLegacy(t: string, forceTool?: ReturnType<typeof parseSlashCommand>["forceTool"], forcedScheduleType?: ReturnType<typeof parseSlashCommand>["forcedScheduleType"], forcedInboxType?: ReturnType<typeof parseSlashCommand>["forcedInboxType"]) {
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
        // 명단에 없다는 사실만으로 신입생 등록을 제안하지 않는다 — 문장이나 선택한 명령이
        // 신입생/신규 의미일 때만 등록 확인을 띄운다.
        if (!EXPLICIT_NEW_STUDENT.test(t) && forcedScheduleType !== "신입생상담" && forcedInboxType !== "신규생문의") {
          return NextResponse.json({
            ok: false,
            mode: "legacy",
            message: `명단에서 "${result.name}" 학생을 찾지 못했습니다. 이름을 확인해 주세요(신입생이면 '신입생'이라고 함께 적어 주세요).`,
          });
        }
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

  // 이 아래 전체를 감싼다 — runCreateTasksCommand/runNaturalLanguageCommand
  // 양쪽 다 자기 안에서 던지는 예외까지 전부 막지는 않으므로(예: 학생/직원
  // 목록을 처음 불러오는 시점의 Notion 오류), 여기서 최종적으로 한 번 더
  // 막아 항상 사람이 읽을 수 있는 JSON을 돌려준다("오류발생"으로만 보이던
  // 문제 대응).
  try {
    const todoContent = matchToDoListShortcut(text);
    if (todoContent !== null) {
      if (!staffId) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." });
      if (!todoContent) return NextResponse.json({ ok: false, message: "/to do list 뒤에 할일 내용을 적어주세요." });
      const date = resolveRelativeDate(todoContent, today) ?? today;
      await createPersonalTodo({ staffId, content: todoContent, date });
      return NextResponse.json({ ok: true, mode: "legacy", message: `개인 할일에 저장했습니다: ${todoContent}` });
    }

    const { isSlashCommand, rest: slashRest, forceTool, forcedScheduleType, forcedInboxType } = parseSlashCommand(text);

    // 슬래시 명령(/보강 등)은 처음부터 그 카테고리가 확정된 것이므로 업무
    // 생성을 시도할 이유가 없다 — 곧바로 기존 파이프라인으로.
    if (isSlashCommand || forceLegacy) {
      return await runLegacy(slashRest, forceTool, forcedScheduleType, forcedInboxType);
    }

    mark("route:before_unified");
    // 직전 입력의 반 문맥(화면이 보관). 형태가 맞을 때만 쓰고, 실제 사용 여부는
    // runUnifiedNlInput이 날짜·반 존재·학생 소속으로 다시 검증한다.
    const rawCtx = body?.context;
    const context: ClassContext | null =
      rawCtx && typeof rawCtx.classId === "string" && typeof rawCtx.date === "string"
        ? { classId: rawCtx.classId, className: String(rawCtx.className ?? ""), date: rawCtx.date, period: String(rawCtx.period ?? "") }
        : null;
    // 입력 이력 조회 결과 번호 토큰 — 서버 서명(HMAC) + 조회한 직원 id가 들어 있어, 현재
    // 세션 직원과 다르거나 위·변조되면 runUnifiedNlInput이 무시한다.
    const historyToken = typeof body?.history === "string" ? body.history : null;
    const result = await runUnifiedNlInput(text, { staffName, staffId: staffId || undefined, role: readStaffRole(req) || undefined, context, historyToken });
    mark("route:after_unified");
    if (result.tasks.length > 0) notifyTaskAssignments(result.tasks);
    const summary =
      result.outcomes.length === 1
        ? result.outcomes[0].message
        : result.outcomes.map((o) => `${o.status === "완료" ? "✅" : o.status === "확인필요" ? "❓" : "⚠️"} ${o.message}`).join("\n");
    mark("route:before_response");
    return NextResponse.json({
      ok: result.ok,
      mode: "multi",
      message: summary,
      outcomes: result.outcomes,
      context: result.context ?? null,
      history: result.history ?? null,
    });
  } catch (err) {
    console.error("/api/ai-input failed", err);
    const message = err instanceof Error ? err.message : "처리 중 오류가 발생했습니다.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
