import { Client } from "@notionhq/client";
import { todayKST } from "./date";
import { formatBriefingText } from "./briefingFormat";

// Server-only. Never import this file from a "use client" component.
if (typeof window !== "undefined") {
  throw new Error("lib/notion.ts must only be used on the server");
}

export const notion = new Client({ auth: process.env.NOTION_TOKEN });

export const DB = {
  CLASS: process.env.NOTION_DB_CLASS!,
  STUDENT: process.env.NOTION_DB_STUDENT!,
  CLASS_PROGRESS: process.env.NOTION_DB_CLASS_PROGRESS!,
  DAILY_RECORD: process.env.NOTION_DB_DAILY_RECORD!,
  BRIEFING: process.env.NOTION_DB_BRIEFING!,
  EXAM_SCORE: process.env.NOTION_DB_EXAM_SCORE!,
  COUNSELING: process.env.NOTION_DB_COUNSELING!,
  ADMIN_INBOX: process.env.NOTION_DB_ADMIN_INBOX!,
  TODO: process.env.NOTION_DB_TODO!,
  STAFF: process.env.NOTION_DB_STAFF!,
};

// ---- Property value extraction helpers ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

export function getTitle(page: Page, prop: string): string {
  const arr = page.properties?.[prop]?.title ?? [];
  return arr.map((t: any) => t.plain_text).join("");
}

export function getRichText(page: Page, prop: string): string {
  const arr = page.properties?.[prop]?.rich_text ?? [];
  return arr.map((t: any) => t.plain_text).join("");
}

export function getSelect(page: Page, prop: string): string | null {
  return page.properties?.[prop]?.select?.name ?? null;
}

export function getMultiSelect(page: Page, prop: string): string[] {
  return (page.properties?.[prop]?.multi_select ?? []).map((o: any) => o.name);
}

export function getRelationIds(page: Page, prop: string): string[] {
  return (page.properties?.[prop]?.relation ?? []).map((r: any) => r.id);
}

export function getDate(page: Page, prop: string): string | null {
  return page.properties?.[prop]?.date?.start ?? null;
}

export function getCheckbox(page: Page, prop: string): boolean {
  return !!page.properties?.[prop]?.checkbox;
}

export function getNumber(page: Page, prop: string): number | null {
  return page.properties?.[prop]?.number ?? null;
}

export function getPhone(page: Page, prop: string): string | null {
  return page.properties?.[prop]?.phone_number ?? null;
}

// Rollups and formulas can themselves resolve to a number, or (for rollups)
// to an "array"/"incomplete"/"unsupported" shape. We only care about the
// number case here since every rollup in this app is a numeric average.
export function getRollupNumber(page: Page, prop: string): number | null {
  const rollup = page.properties?.[prop]?.rollup;
  if (!rollup) return null;
  if (rollup.type === "number") return rollup.number;
  return null;
}

export function getFormulaNumber(page: Page, prop: string): number | null {
  const formula = page.properties?.[prop]?.formula;
  if (!formula) return null;
  if (formula.type === "number") return formula.number;
  return null;
}

export function getCreatedBy(page: Page, prop: string): string | null {
  return page.properties?.[prop]?.created_by?.name ?? null;
}

// ---- Domain helpers ----

// Notion caps page_size at 100 per request. This loops through start_cursor
// until has_more is false, so callers always see the full result set
// (important once a database grows past 100 rows, e.g. 150+ students).
async function queryAllPages(params: {
  data_source_id: string;
  filter?: any;
  sorts?: any;
}) {
  const results: any[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await notion.dataSources.query({
      ...params,
      page_size: 100,
      start_cursor: cursor,
    });
    results.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

export async function listStaff() {
  const res = await notion.dataSources.query({
    data_source_id: DB.STAFF,
    page_size: 100,
  });
  return res.results.map((p: any) => ({
    id: p.id,
    name: getTitle(p, "이름"),
    role: getSelect(p, "역할"),
  }));
}

export async function findStaffByNameAndPin(name: string, pin: string) {
  const res = await notion.dataSources.query({
    data_source_id: DB.STAFF,
    filter: {
      property: "이름",
      title: { equals: name },
    },
    page_size: 1,
  });
  const page = res.results[0] as any;
  if (!page) return null;
  const actualPin = getRichText(page, "PIN");
  if (actualPin !== pin) return null;
  return {
    id: page.id,
    name: getTitle(page, "이름"),
    role: getSelect(page, "역할"),
  };
}

export async function listClasses() {
  const results = await queryAllPages({ data_source_id: DB.CLASS });
  return results.map((p: any) => ({
    id: p.id,
    name: getTitle(p, "반이름"),
    teacher: getRichText(p, "담당교사"),
    days: getMultiSelect(p, "요일"),
    time: getRichText(p, "시간"),
    level: getSelect(p, "레벨"),
    studentIds: getRelationIds(p, "소속학생"),
  }));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Compares calendar-date strings (YYYY-MM-DD) as abstract Y/M/D via Date.UTC,
// never through the server's real local timezone — see lib/date.ts.
function isWithinDays(dateStr: string | null, days: number): boolean {
  if (!dateStr) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const [ty, tm, td] = todayKST().split("-").map(Number);
  const diff = Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d);
  return diff >= 0 && diff <= days * DAY_MS;
}

// Latest exam score per student ("직전 학교시험 점수"), built from one full
// scan of DB⑦ so we don't do a per-student round trip.
async function latestExamScoreMap(): Promise<
  Map<string, { date: string; score: number | null; subject: string | null; examName: string }>
> {
  const results = await queryAllPages({ data_source_id: DB.EXAM_SCORE });
  const map = new Map<string, { date: string; score: number | null; subject: string | null; examName: string }>();
  for (const p of results) {
    const ids = getRelationIds(p, "학생");
    const date = getDate(p, "날짜");
    if (ids.length === 0 || !date) continue;
    const studentId = ids[0];
    const existing = map.get(studentId);
    if (!existing || date > existing.date) {
      map.set(studentId, {
        date,
        score: getNumber(p, "점수"),
        subject: getSelect(p, "과목"),
        examName: getRichText(p, "시험명"),
      });
    }
  }
  return map;
}

function mapStudentPage(p: any, examMap: Map<string, any>) {
  const enrolledAt = getDate(p, "등원일");
  return {
    id: p.id,
    name: getTitle(p, "이름"),
    school: getRichText(p, "학교"),
    grade: getSelect(p, "학년"),
    status: getSelect(p, "상태"),
    classIds: getRelationIds(p, "소속반"),
    attendanceRate: getRollupNumber(p, "누적출석률"),
    homeworkRate: getRollupNumber(p, "누적숙제제출률"),
    vocabPassRate: getRollupNumber(p, "누적단어테스트통과율"),
    enrolledAt,
    isNew: isWithinDays(enrolledAt, 30),
    tuitionDay: getNumber(p, "회비일"),
    learningLevel: getRichText(p, "학습레벨"),
    action: getRichText(p, "조치"),
    actionAlarmDate: getDate(p, "조치알람일"),
    latestExam: examMap.get(p.id) ?? null,
  };
}

export async function searchStudents(query: string, classId?: string) {
  const [results, examMap] = await Promise.all([
    queryAllPages({
      data_source_id: DB.STUDENT,
      filter: query ? { property: "이름", title: { contains: query } } : undefined,
    }),
    latestExamScoreMap(),
  ]);
  let mapped = results.map((p: any) => mapStudentPage(p, examMap));
  if (classId) mapped = mapped.filter((s) => s.classIds.includes(classId));
  return mapped;
}

export async function getStudent(id: string) {
  const [p, examMap]: [any, Map<string, any>] = await Promise.all([
    notion.pages.retrieve({ page_id: id }),
    latestExamScoreMap(),
  ]);
  return mapStudentPage(p, examMap);
}

export async function getStudentDailyRecords(studentId: string) {
  const res = await notion.dataSources.query({
    data_source_id: DB.DAILY_RECORD,
    filter: {
      property: "학생",
      relation: { contains: studentId },
    },
    sorts: [{ property: "날짜", direction: "ascending" }],
    page_size: 100,
  });
  return res.results.map((p: any) => ({
    id: p.id,
    date: getDate(p, "날짜"),
    attendance: getSelect(p, "출결"),
    homeworkDone: getCheckbox(p, "과제여부"),
    vocabResult: getSelect(p, "단어테스트결과"),
    achievement: getRichText(p, "성취사항"),
    progress: getRichText(p, "진도내용"),
  }));
}

export async function getStudentExamScores(studentId: string) {
  const res = await notion.dataSources.query({
    data_source_id: DB.EXAM_SCORE,
    filter: {
      property: "학생",
      relation: { contains: studentId },
    },
    sorts: [{ property: "날짜", direction: "ascending" }],
    page_size: 100,
  });
  return res.results.map((p: any) => ({
    id: p.id,
    date: getDate(p, "날짜"),
    examName: getRichText(p, "시험명"),
    subject: getSelect(p, "과목"),
    score: getNumber(p, "점수"),
  }));
}

// Aggregates 누적출석률 / 누적숙제제출률 per class, for the dashboard bar chart.
export async function getClassSummary() {
  const [classes, students] = await Promise.all([listClasses(), searchStudents("")]);
  return classes.map((c) => {
    const members = students.filter((s) => s.classIds.includes(c.id));
    const avg = (vals: (number | null)[]) => {
      const nums = vals.filter((v): v is number => v !== null);
      if (nums.length === 0) return null;
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    };
    return {
      classId: c.id,
      className: c.name,
      studentCount: members.length,
      attendanceRate: avg(members.map((m) => m.attendanceRate)),
      homeworkRate: avg(members.map((m) => m.homeworkRate)),
      vocabPassRate: avg(members.map((m) => m.vocabPassRate)),
    };
  });
}

// Per-class attendance/homework rate for one specific day (not cumulative),
// driving the ◀ 날짜 ▶ navigator on the dashboard.
export async function getClassSummaryByDate(date: string) {
  const [classes, records] = await Promise.all([
    listClasses(),
    queryAllPages({
      data_source_id: DB.DAILY_RECORD,
      filter: { property: "날짜", date: { equals: date } },
    }),
  ]);

  const byClass = new Map<string, any[]>();
  for (const r of records) {
    const classIds = getRelationIds(r, "반");
    for (const classId of classIds) {
      if (!byClass.has(classId)) byClass.set(classId, []);
      byClass.get(classId)!.push(r);
    }
  }

  return classes.map((c) => {
    const recs = byClass.get(c.id) ?? [];
    const total = recs.length;
    const present = recs.filter((r) => getSelect(r, "출결") !== "결석").length;
    const homeworkDone = recs.filter((r) => getCheckbox(r, "과제여부")).length;
    return {
      classId: c.id,
      className: c.name,
      recordCount: total,
      attendanceRate: total === 0 ? null : present / total,
      homeworkRate: total === 0 ? null : homeworkDone / total,
    };
  });
}

// "오늘의 일정": alarms + new-student events + makeup/retest sessions due today.
export async function getTodaySchedule(today: string) {
  const [alarmStudents, firstDayStudents, todoResults, names] = await Promise.all([
    queryAllPages({
      data_source_id: DB.STUDENT,
      filter: { property: "조치알람일", date: { equals: today } },
    }),
    queryAllPages({
      data_source_id: DB.STUDENT,
      filter: { property: "등원일", date: { equals: today } },
    }),
    queryAllPages({
      data_source_id: DB.TODO,
      filter: { property: "예정일", date: { equals: today } },
    }),
    studentNameMap(),
  ]);

  const alarms = alarmStudents.map((p: any) => ({
    id: p.id,
    studentName: getTitle(p, "이름"),
    learningLevel: getRichText(p, "학습레벨"),
    action: getRichText(p, "조치"),
  }));

  const firstDays = firstDayStudents.map((p: any) => ({
    id: p.id,
    studentName: getTitle(p, "이름"),
    school: getRichText(p, "학교"),
  }));

  const byType = (type: string) =>
    todoResults
      .filter((p: any) => getSelect(p, "유형") === type)
      .map((p: any) => ({
        id: p.id,
        title: getTitle(p, "제목"),
        time: getRichText(p, "시간"),
        studentName: firstRelationName(p, "관련학생", names),
        done: getCheckbox(p, "완료여부"),
      }));

  return {
    alarms,
    firstDays,
    newStudentCounseling: byType("신입생상담"),
    makeupClasses: byType("보강"),
    retests: byType("재시"),
  };
}

export async function createClassProgress(input: {
  classId: string;
  date: string;
  subjects: string[];
  progress: string;
  homework: string;
  nextAssignment: string;
  notice: string;
  perStudent: Record<string, { vocabFail: boolean; homeworkIncomplete: boolean }>;
}) {
  const classPage: any = await notion.pages.retrieve({ page_id: input.classId });
  const className = getTitle(classPage, "반이름");
  const studentIds = getRelationIds(classPage, "소속학생");

  const progressPage = await notion.pages.create({
    parent: { data_source_id: DB.CLASS_PROGRESS } as any,
    properties: {
      제목: { title: [{ text: { content: `${input.date} ${className} 진도` } }] },
      반: { relation: [{ id: input.classId }] },
      날짜: { date: { start: input.date } },
      수업과목: { multi_select: input.subjects.map((name) => ({ name })) },
      진도내용: { rich_text: [{ text: { content: input.progress } }] },
      과제내용: { rich_text: [{ text: { content: input.homework } }] },
      다음시간과제: { rich_text: [{ text: { content: input.nextAssignment } }] },
      전달사항: { rich_text: [{ text: { content: input.notice } }] },
    } as any,
  });

  const dailyRecordIds: string[] = [];
  const briefingIds: string[] = [];
  for (const studentId of studentIds) {
    const studentPage: any = await notion.pages.retrieve({ page_id: studentId });
    const studentName = getTitle(studentPage, "이름");
    const flags = input.perStudent[studentId] ?? { vocabFail: false, homeworkIncomplete: false };

    const daily = await notion.pages.create({
      parent: { data_source_id: DB.DAILY_RECORD } as any,
      properties: {
        제목: { title: [{ text: { content: `${studentName} ${input.date}` } }] },
        학생: { relation: [{ id: studentId }] },
        반: { relation: [{ id: input.classId }] },
        날짜: { date: { start: input.date } },
        진도내용: { rich_text: [{ text: { content: input.progress } }] },
        과제여부: { checkbox: !flags.homeworkIncomplete },
        단어테스트결과: { select: { name: flags.vocabFail ? "재시험" : "통과" } },
        반별진도원본: { relation: [{ id: progressPage.id }] },
      } as any,
    });
    dailyRecordIds.push(daily.id);

    const briefingText = formatBriefingText({
      date: input.date,
      className,
      studentName,
      progress: input.progress,
      homework: input.homework,
      nextAssignment: input.nextAssignment,
      notice: input.notice,
      vocabFail: flags.vocabFail,
      homeworkIncomplete: flags.homeworkIncomplete,
    });
    const briefing = await notion.pages.create({
      parent: { data_source_id: DB.BRIEFING } as any,
      properties: {
        제목: { title: [{ text: { content: `${studentName} 데일리브리핑 ${input.date}` } }] },
        학생: { relation: [{ id: studentId }] },
        날짜: { date: { start: input.date } },
        브리핑유형: { select: { name: flags.vocabFail || flags.homeworkIncomplete ? "주의" : "전달사항" } },
        브리핑내용: { rich_text: [{ text: { content: briefingText } }] },
      } as any,
    });
    briefingIds.push(briefing.id);
  }

  await notion.pages.update({
    page_id: progressPage.id,
    properties: {
      학생기록생성됨: { checkbox: true },
      생성된학생기록: { relation: dailyRecordIds.map((id) => ({ id })) },
    } as any,
  });

  return { progressPageId: progressPage.id, studentCount: dailyRecordIds.length, briefingCount: briefingIds.length };
}

// ---- Recent-activity feeds (dashboard "최근 10개 + 전체보기" widgets) ----

async function studentNameMap(): Promise<Map<string, string>> {
  const students = await searchStudents("");
  return new Map(students.map((s) => [s.id, s.name]));
}

function firstRelationName(page: Page, prop: string, names: Map<string, string>): string {
  const ids = getRelationIds(page, prop);
  if (ids.length === 0) return "-";
  return names.get(ids[0]) ?? "-";
}

export async function getRecentAdminInbox() {
  const [results, names] = await Promise.all([
    queryAllPages({
      data_source_id: DB.ADMIN_INBOX,
      sorts: [{ property: "날짜", direction: "descending" }],
    }),
    studentNameMap(),
  ]);
  return results.map((p: any) => ({
    id: p.id,
    date: getDate(p, "날짜"),
    type: getSelect(p, "입력유형"),
    studentName: firstRelationName(p, "대상학생", names),
    content: getRichText(p, "내용"),
    done: getCheckbox(p, "처리완료"),
  }));
}

export async function getRecentBriefings() {
  const [results, names] = await Promise.all([
    queryAllPages({
      data_source_id: DB.BRIEFING,
      sorts: [{ property: "날짜", direction: "descending" }],
    }),
    studentNameMap(),
  ]);
  return results.map((p: any) => ({
    id: p.id,
    date: getDate(p, "날짜"),
    type: getSelect(p, "브리핑유형"),
    studentId: getRelationIds(p, "학생")[0] ?? null,
    studentName: firstRelationName(p, "학생", names),
    content: getRichText(p, "브리핑내용"),
  }));
}

export async function getRecentCounseling() {
  const [results, names] = await Promise.all([
    queryAllPages({
      data_source_id: DB.COUNSELING,
      sorts: [{ property: "날짜", direction: "descending" }],
    }),
    studentNameMap(),
  ]);
  return results.map((p: any) => ({
    id: p.id,
    date: getDate(p, "날짜"),
    studentName: firstRelationName(p, "학생", names),
    counselor: getRichText(p, "상담자"),
    content: getRichText(p, "상담내용"),
    followUp: getRichText(p, "후속조치"),
  }));
}

export async function createAdminInboxEntry(input: {
  type: string;
  studentId: string | null;
  content: string;
}) {
  const studentName = input.studentId
    ? getTitle(await notion.pages.retrieve({ page_id: input.studentId }) as any, "이름")
    : "전체";
  const today = todayKST();
  await notion.pages.create({
    parent: { data_source_id: DB.ADMIN_INBOX } as any,
    properties: {
      제목: { title: [{ text: { content: `${input.type} - ${studentName}` } }] },
      입력유형: { select: { name: input.type } },
      ...(input.studentId
        ? { 대상학생: { relation: [{ id: input.studentId }] } }
        : {}),
      날짜: { date: { start: today } },
      내용: { rich_text: [{ text: { content: input.content } }] },
      처리완료: { checkbox: false },
    } as any,
  });
}

export async function updateStudentInfo(input: {
  studentId: string;
  enrolledAt?: string;
  tuitionDay?: number;
  learningLevel?: string;
  action?: string;
  actionAlarmDate?: string;
}) {
  const properties: any = {};
  if (input.enrolledAt) properties["등원일"] = { date: { start: input.enrolledAt } };
  if (input.tuitionDay !== undefined) properties["회비일"] = { number: input.tuitionDay };
  if (input.learningLevel !== undefined)
    properties["학습레벨"] = { rich_text: [{ text: { content: input.learningLevel } }] };
  if (input.action !== undefined)
    properties["조치"] = { rich_text: [{ text: { content: input.action } }] };
  if (input.actionAlarmDate)
    properties["조치알람일"] = { date: { start: input.actionAlarmDate } };

  await notion.pages.update({ page_id: input.studentId, properties });
}

export async function createScheduleEntry(input: {
  type: "보강" | "재시" | "신입생상담" | "레벨체크";
  studentId: string | null;
  date: string;
  time: string;
  note: string;
}) {
  const studentName = input.studentId
    ? getTitle((await notion.pages.retrieve({ page_id: input.studentId })) as any, "이름")
    : "";
  await notion.pages.create({
    parent: { data_source_id: DB.TODO } as any,
    properties: {
      제목: { title: [{ text: { content: `${input.type}${studentName ? " - " + studentName : ""}` } }] },
      유형: { select: { name: input.type } },
      ...(input.studentId ? { 관련학생: { relation: [{ id: input.studentId }] } } : {}),
      예정일: { date: { start: input.date } },
      시간: { rich_text: [{ text: { content: input.time } }] },
      완료여부: { checkbox: false },
      우선순위: { select: { name: "보통" } },
    } as any,
  });
}

export async function createCounselingEntry(input: {
  studentId: string;
  counselor: string;
  date: string;
  transcript: string;
  summary: string;
  followUp: string;
}) {
  const studentName = getTitle(
    (await notion.pages.retrieve({ page_id: input.studentId })) as any,
    "이름"
  );
  await notion.pages.create({
    parent: { data_source_id: DB.COUNSELING } as any,
    properties: {
      제목: { title: [{ text: { content: `${studentName} 상담일지` } }] },
      학생: { relation: [{ id: input.studentId }] },
      날짜: { date: { start: input.date } },
      상담자: { rich_text: [{ text: { content: input.counselor } }] },
      전사내용: { rich_text: [{ text: { content: input.transcript } }] },
      상담내용: { rich_text: [{ text: { content: input.summary } }] },
      후속조치: { rich_text: [{ text: { content: input.followUp } }] },
    } as any,
  });
}
