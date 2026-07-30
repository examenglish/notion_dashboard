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
} from "@/lib/notion";
import { todayKST } from "@/lib/date";
import { stripClassSuffix } from "@/lib/format";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

type StudentInfo = Awaited<ReturnType<typeof searchStudents>>[number];

// These sentences are inherently about someone not yet in DB②, so student
// matching is skipped entirely and the raw text is logged as-is — trying to
// fuzzy-match a name out of a 신입생 inquiry risks silently attaching it to
// an unrelated existing student.
const NEW_STUDENT_KEYWORDS = ["신입생", "신규생", "첫등원"];

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
  opts: { selectedStudentId?: string; confirmNewStudent?: boolean; forceNewStudent?: boolean }
): Promise<StudentResolution> {
  if (opts.selectedStudentId) return { kind: "resolved", studentId: opts.selectedStudentId };

  if (opts.forceNewStudent) {
    if (!name) return { kind: "no_name" };
    const studentId = await createMinimalStudent(name);
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
      const studentId = await createMinimalStudent(name);
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
  opts: { selectedStudentId?: string; confirmNewStudent?: boolean; forceNewStudent?: boolean }
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
  if (!text) {
    return NextResponse.json({ ok: false, message: "입력 내용이 없습니다." }, { status: 400 });
  }

  const today = todayKST();

  if (NEW_STUDENT_KEYWORDS.some((k) => text.includes(k))) {
    await createAdminInboxEntry({
      type: "신규생문의",
      studentId: null,
      content: text,
      startDate: today,
    });
    return NextResponse.json({ ok: true, message: "행정입력함에 저장했습니다: 신규생문의" });
  }

  const [allStudents, classes, staff] = await Promise.all([searchStudents(""), listClasses(), listStaff()]);
  const activeStudents = allStudents.filter((s) => s.status === "재원" || !s.status);
  const classNameById = new Map(classes.map((c) => [c.id, stripClassSuffix(c.name)]));

  const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];

  let parsed;
  try {
    parsed = await parseNaturalLanguageInput(text, {
      today,
      weekday,
      students: activeStudents.map((s) => `${s.name}(${s.school || "학교미상"})`),
      classes: classes.map((c) => stripClassSuffix(c.name)),
      staff: staff.map((s) => s.name),
    });
  } catch {
    return NextResponse.json({ ok: false, message: "AI 처리 중 오류가 발생했습니다." }, { status: 502 });
  }

  if (parsed.kind === "clarify") {
    return NextResponse.json({ ok: false, message: parsed.message });
  }

  const input = parsed.input;
  // Haiku is unreliable at "다음주 X요일"-style date arithmetic even with a
  // reference table in context; when the input text matches one of the
  // common explicit/relative patterns, trust the deterministic regex parse
  // over whatever date the model returned.
  const regexDate = resolveRelativeDate(text, today);
  const nameById = new Map(activeStudents.map((s) => [s.id, s.name]));
  const resolveOpts = { selectedStudentId, confirmNewStudent, forceNewStudent };

  try {
    if (parsed.kind === "log_admin_inbox") {
      const result = await resolveOrRespond(text, input.studentName, activeStudents, classNameById, resolveOpts);
      if (result instanceof NextResponse) return result;
      const studentId = result.studentId;
      const studentName = studentId ? nameById.get(studentId) ?? input.studentName : undefined;
      await createAdminInboxEntry({
        type: input.type,
        studentId,
        content: input.content,
        startDate: regexDate ?? input.startDate ?? today,
        endDate: input.endDate || undefined,
      });
      return NextResponse.json({
        ok: true,
        message: `행정입력함에 저장했습니다: ${input.type}${studentName ? " · " + studentName : ""}`,
      });
    }

    if (parsed.kind === "log_schedule_entry") {
      const result = await resolveOrRespond(text, input.studentName, activeStudents, classNameById, resolveOpts);
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
      const result = await resolveOrRespond(text, input.studentName, activeStudents, classNameById, resolveOpts);
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
        transcript: "",
        summary: input.summary,
        followUp: input.followUp || "",
      });
      return NextResponse.json({
        ok: true,
        message: `상담일지에 저장했습니다: ${nameById.get(studentId) ?? input.studentName} (${date})`,
      });
    }

    if (parsed.kind === "log_student_action") {
      const result = await resolveOrRespond(text, input.studentName, activeStudents, classNameById, resolveOpts);
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
