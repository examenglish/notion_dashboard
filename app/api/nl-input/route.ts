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
} from "@/lib/notion";
import { todayKST } from "@/lib/date";
import { stripClassSuffix } from "@/lib/format";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

type StudentLite = { id: string; name: string; status: string | null };

// Exact name match first (unless ambiguous — same name, multiple students,
// which this app already surfaces via "(학교)" suffixes elsewhere); falls
// back to a loose contains-match only when that's unambiguous too.
function findStudentId(name: string, students: StudentLite[]): string | null {
  if (!name) return null;
  const exact = students.filter((s) => s.name === name);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return null;
  const loose = students.filter((s) => s.name.includes(name) || name.includes(s.name));
  if (loose.length === 1) return loose[0].id;
  return null;
}

// The model sometimes omits studentName even when a known name is clearly
// present in the raw text (verified in testing: ~1/3 of calls). Scanning
// the raw text against the known active-student roster is a deterministic
// fallback that doesn't depend on the model extracting it correctly.
function findStudentIdFromText(text: string, students: StudentLite[]): string | null {
  const matches = students.filter((s) => s.name.length >= 2 && text.includes(s.name));
  if (matches.length === 1) return matches[0].id;
  return null;
}

function resolveStudent(text: string, name: string | undefined, students: StudentLite[]): string | null {
  return findStudentIdFromText(text, students) ?? (name ? findStudentId(name, students) : null);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text = (body?.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ ok: false, message: "입력 내용이 없습니다." }, { status: 400 });
  }

  const [allStudents, classes, staff] = await Promise.all([searchStudents(""), listClasses(), listStaff()]);
  const activeStudents = allStudents.filter((s) => s.status === "재원" || !s.status);

  const today = todayKST();
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

  try {
    if (parsed.kind === "log_admin_inbox") {
      const studentId = resolveStudent(text, input.studentName, activeStudents);
      if (input.studentName && !studentId) {
        return NextResponse.json({ ok: false, message: `"${input.studentName}" 학생을 찾을 수 없습니다. 이름을 정확히 입력해 주세요.` });
      }
      const studentName = studentId ? nameById.get(studentId) : undefined;
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
      const studentId = resolveStudent(text, input.studentName, activeStudents);
      if (!studentId) {
        return NextResponse.json({ ok: false, message: `"${input.studentName}" 학생을 찾을 수 없습니다. 이름을 정확히 입력해 주세요.` });
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
        message: `${input.type} 일정으로 저장했습니다: ${nameById.get(studentId)} (${date})`,
      });
    }

    if (parsed.kind === "log_counseling") {
      const studentId = resolveStudent(text, input.studentName, activeStudents);
      if (!studentId) {
        return NextResponse.json({ ok: false, message: `"${input.studentName}" 학생을 찾을 수 없습니다. 이름을 정확히 입력해 주세요.` });
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
        message: `상담일지에 저장했습니다: ${nameById.get(studentId)} (${date})`,
      });
    }

    if (parsed.kind === "log_student_action") {
      const studentId = resolveStudent(text, input.studentName, activeStudents);
      if (!studentId) {
        return NextResponse.json({ ok: false, message: `"${input.studentName}" 학생을 찾을 수 없습니다. 이름을 정확히 입력해 주세요.` });
      }
      await updateStudentInfo({
        studentId,
        action: input.action,
        actionOwner: input.actionOwner || undefined,
        actionAlarmDate: regexDate ?? input.actionAlarmDate ?? today,
      });
      return NextResponse.json({ ok: true, message: `학생 조치사항을 저장했습니다: ${nameById.get(studentId)}` });
    }

    return NextResponse.json({ ok: false, message: "요청을 이해하지 못했습니다. 다시 입력해 주세요." });
  } catch {
    return NextResponse.json({ ok: false, message: "저장 중 오류가 발생했습니다." }, { status: 500 });
  }
}
