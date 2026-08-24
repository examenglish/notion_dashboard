import { NextRequest, NextResponse } from "next/server";
import { resolveRelativeDate } from "@/lib/anthropic";
import { createPersonalTodo } from "@/lib/notion";
import { todayKST } from "@/lib/date";
import { readStaffName, readStaffId } from "@/lib/session";
import { SLASH_COMMANDS, runNaturalLanguageCommand } from "@/lib/nl-input";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text = (body?.text ?? "").trim();
  const confirmNewStudent = !!body?.confirmNewStudent;
  const forceNewStudent = !!body?.forceNewStudent;
  const selectedStudentId = typeof body?.selectedStudentId === "string" ? body.selectedStudentId : undefined;
  const transcript = typeof body?.transcript === "string" ? body.transcript : "";
  if (!text) {
    return NextResponse.json({ ok: false, message: "입력 내용이 없습니다." }, { status: 400 });
  }

  const today = todayKST();
  const staffName = readStaffName(req) || undefined;
  const staffId = readStaffId(req);

  // "/to do list ..." — AI 분류를 거치지 않는 결정론적 명령어. 본인만 보는
  // 개인 할일에 그대로 저장한다(학생 매칭 등 다른 처리 없음).
  const todoMatch = text.match(/^\/\s*to\s*do\s*list\b\s*([\s\S]*)$/i);
  if (todoMatch) {
    if (!staffId) {
      return NextResponse.json({ ok: false, message: "로그인이 필요합니다." });
    }
    const content = todoMatch[1].trim();
    if (!content) {
      return NextResponse.json({ ok: false, message: "/to do list 뒤에 할일 내용을 적어주세요." });
    }
    const date = resolveRelativeDate(content, today) ?? today;
    await createPersonalTodo({ staffId, content, date });
    return NextResponse.json({ ok: true, message: `개인 할일에 저장했습니다: ${content}` });
  }

  let slashRest = text;
  let forceTool: (typeof SLASH_COMMANDS)[string]["tool"] | undefined;
  let forcedScheduleType: (typeof SLASH_COMMANDS)[string]["scheduleType"];
  let forcedInboxType: (typeof SLASH_COMMANDS)[string]["inboxType"];
  const slashMatch = text.match(/^\/\s*(\S+)\s+([\s\S]+)$/);
  if (slashMatch && SLASH_COMMANDS[slashMatch[1]]) {
    const cmd = SLASH_COMMANDS[slashMatch[1]];
    forceTool = cmd.tool;
    forcedScheduleType = cmd.scheduleType;
    forcedInboxType = cmd.inboxType;
    slashRest = slashMatch[2].trim();
  }

  const result = await runNaturalLanguageCommand(slashRest, {
    staffName,
    transcript,
    forceTool,
    forcedScheduleType,
    forcedInboxType,
    selectedStudentId,
    confirmNewStudent,
    forceNewStudent,
  });

  switch (result.kind) {
    case "saved":
      return NextResponse.json({ ok: true, message: result.message });
    case "clarify":
      return NextResponse.json({ ok: false, message: result.message });
    case "not_found":
      return NextResponse.json({
        ok: false,
        needsConfirm: true,
        message: `"${result.name}" 학생을 찾을 수 없는데, 신입생으로 새로 등록할까요?`,
      });
    case "ambiguous":
      return NextResponse.json({
        ok: false,
        needsSelection: true,
        message: "동명이인이 있어 확인이 필요합니다. 누구인가요?",
        candidates: result.candidates,
      });
    case "missing_name":
      return NextResponse.json({ ok: false, message: "학생 이름을 확인할 수 없습니다. 이름을 포함해서 다시 입력해 주세요." });
    case "ai_error":
      return NextResponse.json({ ok: false, message: result.message }, { status: 502 });
    case "save_error":
      return NextResponse.json({ ok: false, message: result.message }, { status: 500 });
  }
}
