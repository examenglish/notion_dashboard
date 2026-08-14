import { NextRequest, NextResponse } from "next/server";
import { parseNaturalLanguageInput, resolveRelativeDate } from "@/lib/anthropic";
import {
  listClasses,
  listStaff,
  searchStudents,
  createAdminInboxEntry,
  createScheduleEntry,
  createCounselingEntry,
  updateStudentInfo,
  createMinimalStudent,
  createPersonalTodo,
} from "@/lib/notion";
import { todayKST } from "@/lib/date";
import { stripClassSuffix } from "@/lib/format";
import { readStaffName, readStaffId } from "@/lib/session";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

type StudentInfo = Awaited<ReturnType<typeof searchStudents>>[number];

// These sentences are inherently about someone not yet in DB②, so student
// matching is skipped entirely and the raw text is logged as-is — trying to
// fuzzy-match a name out of a 신입생 inquiry risks silently attaching it to
// an unrelated existing student.
const NEW_STUDENT_KEYWORDS = ["신입생", "신규생", "첫등원"];

// "/보강 박서재 내일 5시" 처럼 맨 앞에 카테고리를 슬래시로 직접 지정하면,
// AI 분류(어느 tool을 쓸지) 단계를 완전히 건너뛰고 그 tool을 강제 호출한다
// — "재시 일정"이 다른 카테고리로 잘못 분류될 걱정 없이 정확한 위치에
// 저장된다. 나머지(학생 이름/날짜/시간 등) 추출은 그대로 AI가 맡는다.
const SLASH_COMMANDS: Record<
  string,
  {
    tool: "log_admin_inbox" | "log_schedule_entry" | "log_counseling" | "log_student_action";
    scheduleType?: "보강" | "재시" | "신입생상담" | "레벨체크";
    inboxType?: "결석예정" | "긴급상담요청" | "신규생문의" | "기타";
  }
> = {
  보강: { tool: "log_schedule_entry", scheduleType: "보강" },
  재시: { tool: "log_schedule_entry", scheduleType: "재시" },
  신입생상담: { tool: "log_schedule_entry", scheduleType: "신입생상담" },
  레벨체크: { tool: "log_schedule_entry", scheduleType: "레벨체크" },
  상담: { tool: "log_counseling" },
  조치: { tool: "log_student_action" },
  행정실: { tool: "log_admin_inbox" },
  결석: { tool: "log_admin_inbox", inboxType: "결석예정" },
  긴급상담: { tool: "log_admin_inbox", inboxType: "긴급상담요청" },
};

function candidateLabel(s: StudentInfo, classNameById: Map<string, string>): string {
  const classNames = (s.classIds ?? []).map((id) => classNameById.get(id)).filter((n): n is string => !!n);
  const classLabel = classNames.length > 0 ? classNames.join("·") : "반 미배정";
  return `${s.name} - ${s.school || "학교미상"} ${s.grade ?? ""} / ${classLabel}`.replace(/\s+/g, " ").trim();
}

// 이름이 여러 명이면 학교 -> 학년 -> 반 순서로, 입력 문장에 언급된 단서를 이용해
// 좁혀나간다. 어느 단계에서든 필터링 결과가 빈 집합이 되면(그 단서가 문장에
// 없거나 후보 중 아무도 해당 안 되는 경우) 그 단계는 건너뛰고 이전 집합을 유지한다.
function narrowCandidates(text: string, candidates: StudentInfo[], classNameById: Map<string, string>): StudentInfo[] {
  let pool = candidates;
  if (pool.length > 1) {
    const bySchool = pool.filter((s) => s.school && text.includes(s.school));
    if (bySchool.length > 0) pool = bySchool;
  }
  if (pool.length > 1) {
    const byGrade = pool.filter((s) => s.grade && text.includes(s.grade));
    if (byGrade.length > 0) pool = byGrade;
  }
  if (pool.length > 1) {
    const byClass = pool.filter((s) =>
      (s.classIds ?? []).some((id) => {
        const cn = classNameById.get(id);
        return !!cn && text.includes(cn);
      })
    );
    if (byClass.length > 0) pool = byClass;
  }
  return pool;
}

type StudentResolution =
  | { kind: "resolved"; studentId: string }
  | { kind: "not_found"; name: string }
  | { kind: "ambiguous"; candidates: StudentInfo[] }
  | { kind: "no_name" };

async function resolveStudentForIntent(
  text: string,
  name: string | undefined,
  students: StudentInfo[],
  classNameById: Map<string, string>,
  opts: { selectedStudentId?: string; confirmNewStudent?: boolean; forceNewStudent?: boolean; school?: string }
): Promise<StudentResolution> {
  if (opts.selectedStudentId) return { kind: "resolved", studentId: opts.selectedStudentId };

  if (opts.forceNewStudent) {
    if (!name) return { kind: "no_name" };
    const studentId = await createMinimalStudent(name, opts.school);
    return { kind: "resolved", studentId };
  }

  let candidates: StudentInfo[];
  if (name) {
    const exact = students.filter((s) => s.name === name);
    candidates = exact.length > 0 ? exact : students.filter((s) => s.name.includes(name) || name.includes(s.name));
  } else {
    // The model occasionally omits studentName even when a known name is
    // clearly present in the text; scanning the raw text against the
    // roster is a deterministic fallback for that case.
    candidates = students.filter((s) => s.name.length >= 2 && text.includes(s.name));
  }

  if (candidates.length === 0) {
    if (!name) return { kind: "no_name" };
    if (opts.confirmNewStudent) {
      const studentId = await createMinimalStudent(name, opts.school);
      return { kind: "resolved", studentId };
    }
    return { kind: "not_found", name };
  }
  if (candidates.length === 1) return { kind: "resolved", studentId: candidates[0].id };

  const narrowed = narrowCandidates(text, candidates, classNameById);
  if (narrowed.length === 1) return { kind: "resolved", studentId: narrowed[0].id };
  return { kind: "ambiguous", candidates: narrowed };
}

// Wraps resolveStudentForIntent and turns the non-"resolved" outcomes
// directly into the NextResponse the route should return, so each of the 4
// intent branches below can just bail out with `if (result instanceof
// NextResponse) return result;` instead of repeating this 3-way switch.
async function resolveOrRespond(
  text: string,
  name: string | undefined,
  students: StudentInfo[],
  classNameById: Map<string, string>,
  opts: { selectedStudentId?: string; confirmNewStudent?: boolean; forceNewStudent?: boolean; school?: string }
): Promise<{ studentId: string | null } | NextResponse> {
  const resolution = await resolveStudentForIntent(text, name, students, classNameById, opts);
  if (resolution.kind === "resolved") return { studentId: resolution.studentId };
  if (resolution.kind === "no_name") return { studentId: null };
  if (resolution.kind === "not_found") {
    return NextResponse.json({
      ok: false,
      needsConfirm: true,
      message: `"${resolution.name}" 학생을 찾을 수 없는데, 신입생으로 새로 등록할까요?`,
    });
  }
  return NextResponse.json({
    ok: false,
    needsSelection: true,
    message: "동명이인이 있어 확인이 필요합니다. 누구인가요?",
    candidates: resolution.candidates.map((s) => ({ id: s.id, label: candidateLabel(s, classNameById) })),
  });
}

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

  let slashCommand: (typeof SLASH_COMMANDS)[string] | undefined;
  let slashRest = text;
  const slashMatch = text.match(/^\/\s*(\S+)\s+([\s\S]+)$/);
  if (slashMatch && SLASH_COMMANDS[slashMatch[1]]) {
    slashCommand = SLASH_COMMANDS[slashMatch[1]];
    slashRest = slashMatch[2].trim();
  }

  if (!slashCommand && NEW_STUDENT_KEYWORDS.some((k) => text.includes(k))) {
    await createAdminInboxEntry({
      type: "신규생문의",
      studentId: null,
      content: text,
      startDate: today,
      enteredBy: staffName,
    });
    return NextResponse.json({ ok: true, message: "행정실에 저장했습니다: 신규생문의" });
  }

  const [allStudents, classes, staff] = await Promise.all([searchStudents(""), listClasses(), listStaff()]);
  const activeStudents = allStudents.filter((s) => s.status === "재원" || !s.status);
  const classNameById = new Map(classes.map((c) => [c.id, stripClassSuffix(c.name)]));

  const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];

  let parsed;
  try {
    parsed = await parseNaturalLanguageInput(
      slashRest,
      {
        today,
        weekday,
        students: activeStudents.map((s) => `${s.name}(${s.school || "학교미상"})`),
        classes: classes.map((c) => stripClassSuffix(c.name)),
        staff: staff.map((s) => s.name),
      },
      slashCommand?.tool
    );
  } catch {
    return NextResponse.json({ ok: false, message: "AI 처리 중 오류가 발생했습니다." }, { status: 502 });
  }

  if (parsed.kind === "clarify") {
    return NextResponse.json({ ok: false, message: parsed.message });
  }

  // 슬래시 명령으로 tool은 이미 강제했지만, log_schedule_entry/log_admin_inbox
  // 안의 세부 type까지는 tool_choice가 못 정한다 — 지정된 값으로 덮어써서
  // 완전히 결정론적으로 만든다.
  if (slashCommand?.scheduleType && parsed.kind === "log_schedule_entry") {
    parsed.input.type = slashCommand.scheduleType;
  }
  if (slashCommand?.inboxType && parsed.kind === "log_admin_inbox") {
    parsed.input.type = slashCommand.inboxType;
  }

  const input = parsed.input;
  // Haiku is unreliable at "다음주 X요일"-style date arithmetic even with a
  // reference table in context; when the input text matches one of the
  // common explicit/relative patterns, trust the deterministic regex parse
  // over whatever date the model returned.
  const regexDate = resolveRelativeDate(slashRest, today);
  const nameById = new Map(activeStudents.map((s) => [s.id, s.name]));
  const resolveOpts = {
    selectedStudentId,
    confirmNewStudent,
    forceNewStudent,
    school: input.studentSchool || undefined,
  };

  try {
    if (parsed.kind === "log_admin_inbox") {
      const result = await resolveOrRespond(slashRest, input.studentName, activeStudents, classNameById, resolveOpts);
      if (result instanceof NextResponse) return result;
      const studentId = result.studentId;
      const studentName = studentId ? nameById.get(studentId) ?? input.studentName : undefined;
      await createAdminInboxEntry({
        type: input.type,
        studentId,
        content: input.content,
        startDate: regexDate ?? input.startDate ?? today,
        endDate: input.endDate || undefined,
        enteredBy: staffName,
      });
      return NextResponse.json({
        ok: true,
        message: `행정실에 저장했습니다: ${input.type}${studentName ? " · " + studentName : ""}`,
      });
    }

    if (parsed.kind === "log_schedule_entry") {
      const result = await resolveOrRespond(slashRest, input.studentName, activeStudents, classNameById, resolveOpts);
      if (result instanceof NextResponse) return result;
      const studentId = result.studentId;
      if (!studentId) {
        return NextResponse.json({ ok: false, message: "학생 이름을 확인할 수 없습니다. 이름을 포함해서 다시 입력해 주세요." });
      }
      const date = regexDate ?? input.date ?? today;
      await createScheduleEntry({
        type: input.type,
        studentId,
        date,
        time: input.time || "",
        note: input.note || "",
        ownerName: input.ownerName || undefined,
      });
      return NextResponse.json({
        ok: true,
        message: `${input.type} 일정으로 저장했습니다: ${nameById.get(studentId) ?? input.studentName} (${date})`,
      });
    }

    if (parsed.kind === "log_counseling") {
      const result = await resolveOrRespond(slashRest, input.studentName, activeStudents, classNameById, resolveOpts);
      if (result instanceof NextResponse) return result;
      const studentId = result.studentId;
      if (!studentId) {
        return NextResponse.json({ ok: false, message: "학생 이름을 확인할 수 없습니다. 이름을 포함해서 다시 입력해 주세요." });
      }
      const date = regexDate ?? input.date ?? today;
      await createCounselingEntry({
        studentId,
        counselor: input.counselor || "",
        date,
        transcript,
        summary: input.summary,
        followUp: input.followUp || "",
        enteredBy: staffName,
      });
      return NextResponse.json({
        ok: true,
        message: `상담일지에 저장했습니다: ${nameById.get(studentId) ?? input.studentName} (${date})`,
      });
    }

    if (parsed.kind === "log_student_action") {
      const result = await resolveOrRespond(slashRest, input.studentName, activeStudents, classNameById, resolveOpts);
      if (result instanceof NextResponse) return result;
      const studentId = result.studentId;
      if (!studentId) {
        return NextResponse.json({ ok: false, message: "학생 이름을 확인할 수 없습니다. 이름을 포함해서 다시 입력해 주세요." });
      }
      await updateStudentInfo({
        studentId,
        action: input.action,
        actionOwner: input.actionOwner || undefined,
        actionAlarmDate: regexDate ?? input.actionAlarmDate ?? today,
      });
      return NextResponse.json({
        ok: true,
        message: `학생 조치사항을 저장했습니다: ${nameById.get(studentId) ?? input.studentName}`,
      });
    }

    return NextResponse.json({ ok: false, message: "요청을 이해하지 못했습니다. 다시 입력해 주세요." });
  } catch {
    return NextResponse.json({ ok: false, message: "저장 중 오류가 발생했습니다." }, { status: 500 });
  }
}
