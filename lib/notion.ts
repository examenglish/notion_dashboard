import { Client } from "@notionhq/client";

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

export async function searchStudents(query: string) {
  const results = await queryAllPages({
    data_source_id: DB.STUDENT,
    filter: query ? { property: "이름", title: { contains: query } } : undefined,
  });
  return results.map((p: any) => ({
    id: p.id,
    name: getTitle(p, "이름"),
    school: getRichText(p, "학교"),
    grade: getSelect(p, "학년"),
    status: getSelect(p, "상태"),
    classIds: getRelationIds(p, "소속반"),
    attendanceRate: getRollupNumber(p, "누적출석률"),
    homeworkRate: getRollupNumber(p, "누적숙제제출률"),
    vocabPassRate: getRollupNumber(p, "누적단어테스트통과율"),
  }));
}

export async function getStudent(id: string) {
  const p: any = await notion.pages.retrieve({ page_id: id });
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
  };
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
    homeworkDone: getCheckbox(p, "숙제여부"),
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

export async function createClassProgress(input: {
  classId: string;
  date: string;
  progress: string;
  homework: string;
  vocabRange: string;
  notes: string;
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
      진도내용: { rich_text: [{ text: { content: input.progress } }] },
      숙제내용: { rich_text: [{ text: { content: input.homework } }] },
      단어시험범위: { rich_text: [{ text: { content: input.vocabRange } }] },
      특이사항: { rich_text: [{ text: { content: input.notes } }] },
    } as any,
  });

  const dailyRecordIds: string[] = [];
  for (const studentId of studentIds) {
    const studentPage: any = await notion.pages.retrieve({ page_id: studentId });
    const studentName = getTitle(studentPage, "이름");
    const daily = await notion.pages.create({
      parent: { data_source_id: DB.DAILY_RECORD } as any,
      properties: {
        제목: { title: [{ text: { content: `${studentName} ${input.date}` } }] },
        학생: { relation: [{ id: studentId }] },
        반: { relation: [{ id: input.classId }] },
        날짜: { date: { start: input.date } },
        진도내용: { rich_text: [{ text: { content: input.progress } }] },
        반별진도원본: { relation: [{ id: progressPage.id }] },
      } as any,
    });
    dailyRecordIds.push(daily.id);
  }

  await notion.pages.update({
    page_id: progressPage.id,
    properties: {
      학생기록생성됨: { checkbox: true },
      생성된학생기록: { relation: dailyRecordIds.map((id) => ({ id })) },
    } as any,
  });

  return { progressPageId: progressPage.id, studentCount: dailyRecordIds.length };
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

export async function getRecentAdminInbox(limit = 100) {
  const [res, names] = await Promise.all([
    notion.dataSources.query({
      data_source_id: DB.ADMIN_INBOX,
      sorts: [{ property: "날짜", direction: "descending" }],
      page_size: limit,
    }),
    studentNameMap(),
  ]);
  return res.results.map((p: any) => ({
    id: p.id,
    date: getDate(p, "날짜"),
    type: getSelect(p, "입력유형"),
    studentName: firstRelationName(p, "대상학생", names),
    content: getRichText(p, "내용"),
    done: getCheckbox(p, "처리완료"),
  }));
}

export async function getRecentBriefings(limit = 100) {
  const [res, names] = await Promise.all([
    notion.dataSources.query({
      data_source_id: DB.BRIEFING,
      sorts: [{ property: "날짜", direction: "descending" }],
      page_size: limit,
    }),
    studentNameMap(),
  ]);
  return res.results.map((p: any) => ({
    id: p.id,
    date: getDate(p, "날짜"),
    type: getSelect(p, "브리핑유형"),
    studentName: firstRelationName(p, "학생", names),
    content: getRichText(p, "브리핑내용"),
  }));
}

export async function getRecentCounseling(limit = 100) {
  const [res, names] = await Promise.all([
    notion.dataSources.query({
      data_source_id: DB.COUNSELING,
      sorts: [{ property: "날짜", direction: "descending" }],
      page_size: limit,
    }),
    studentNameMap(),
  ]);
  return res.results.map((p: any) => ({
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
  const today = new Date().toISOString().slice(0, 10);
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
