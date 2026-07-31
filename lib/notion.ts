import { Client } from "@notionhq/client";
import { todayKST } from "./date";
import { formatBriefingText } from "./briefingFormat";
import { stripClassSuffix } from "./format";

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
    mustChangePin: getCheckbox(page, "비번변경필요"),
  };
}

export async function updateStaffPin(staffId: string, newPin: string) {
  await notion.pages.update({
    page_id: staffId,
    properties: {
      PIN: { rich_text: [{ text: { content: newPin } }] },
      비번변경필요: { checkbox: false },
    } as any,
  });
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

// Used when a staff member types a class name directly instead of picking
// from the dropdown (e.g. a brand-new class not yet set up in DB①). Matches
// an existing class by exact name first (ignoring the "(숫자)" seed-data
// suffix some class names carry); creates a minimal DB① record only if
// nothing matches.
export async function resolveOrCreateClass(name: string): Promise<string> {
  const trimmed = name.trim();
  const classes = await listClasses();
  const exact = classes.find((c) => c.name === trimmed || stripClassSuffix(c.name) === trimmed);
  if (exact) return exact.id;

  const page = await notion.pages.create({
    parent: { data_source_id: DB.CLASS } as any,
    properties: {
      반이름: { title: [{ text: { content: trimmed } }] },
    } as any,
  });
  return page.id;
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
    actionOwner: getRichText(p, "조치담당자"),
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

// Full cumulative record for one student — 진도/과제 text (joined from the
// class-level DB③ progress page each daily record points back to), 보강
// history, and 상담 history — for the "전체기록 보기" print-friendly popup.
export async function getStudentFullHistory(studentId: string) {
  const dailyRes = await notion.dataSources.query({
    data_source_id: DB.DAILY_RECORD,
    filter: { property: "학생", relation: { contains: studentId } },
    sorts: [{ property: "날짜", direction: "ascending" }],
    page_size: 100,
  });
  const dailyRecords = dailyRes.results.map((p: any) => ({
    date: getDate(p, "날짜"),
    progress: getRichText(p, "진도내용"),
    attendance: getSelect(p, "출결"),
    homeworkDone: getCheckbox(p, "과제여부"),
    progressPageId: getRelationIds(p, "반별진도원본")[0] ?? null,
  }));

  const progressIds = Array.from(
    new Set(dailyRecords.map((r) => r.progressPageId).filter((id): id is string => !!id))
  );
  const progressPages = await Promise.all(
    progressIds.map((id) => notion.pages.retrieve({ page_id: id }))
  );
  const homeworkByProgressId = new Map(progressPages.map((p: any) => [p.id, getRichText(p, "과제내용")]));

  const progress = dailyRecords.map((r) => ({
    date: r.date,
    progress: r.progress,
    homework: r.progressPageId ? homeworkByProgressId.get(r.progressPageId) ?? "" : "",
    attendance: r.attendance,
    homeworkDone: r.homeworkDone,
  }));

  const [makeupTodos, actionTodos, counselingEntries, inboxEntries, staffMap] = await Promise.all([
    queryAllPages({
      data_source_id: DB.TODO,
      filter: {
        and: [
          { property: "유형", select: { equals: "보강" } },
          { property: "관련학생", relation: { contains: studentId } },
        ],
      },
    }),
    queryAllPages({
      data_source_id: DB.TODO,
      filter: {
        and: [
          { property: "유형", select: { equals: "조치사항" } },
          { property: "관련학생", relation: { contains: studentId } },
        ],
      },
    }),
    queryAllPages({
      data_source_id: DB.COUNSELING,
      filter: { property: "학생", relation: { contains: studentId } },
    }),
    queryAllPages({
      data_source_id: DB.ADMIN_INBOX,
      filter: { property: "대상학생", relation: { contains: studentId } },
    }),
    staffNameMap(),
  ]);

  const makeup = makeupTodos
    .map((p: any) => {
      const ownerId = getRelationIds(p, "담당자")[0];
      return {
        date: getDate(p, "예정일"),
        time: getRichText(p, "시간"),
        owner: ownerId ? staffMap.get(ownerId) ?? "-" : "-",
        done: getCheckbox(p, "완료여부"),
      };
    })
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  const actions = actionTodos
    .map((p: any) => {
      const ownerId = getRelationIds(p, "담당자")[0];
      return {
        date: getDate(p, "예정일"),
        content: getTitle(p, "제목"),
        owner: ownerId ? staffMap.get(ownerId) ?? "-" : "-",
      };
    })
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  const counseling = counselingEntries
    .map((p: any) => ({
      date: getDate(p, "날짜"),
      counselor: getRichText(p, "상담자"),
      content: getRichText(p, "상담내용"),
      followUp: getRichText(p, "후속조치"),
    }))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  const inquiries = inboxEntries
    .map((p: any) => ({
      date: getDate(p, "날짜"),
      type: getSelect(p, "입력유형"),
      content: getRichText(p, "내용"),
      done: getCheckbox(p, "처리완료"),
    }))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  return { progress, makeup, actions, counseling, inquiries };
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
  const [classes, records, counselingEntries] = await Promise.all([
    listClasses(),
    queryAllPages({
      data_source_id: DB.DAILY_RECORD,
      filter: { property: "날짜", date: { equals: date } },
    }),
    queryAllPages({
      data_source_id: DB.COUNSELING,
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

  const counseledStudentIds = new Set<string>();
  for (const entry of counselingEntries) {
    for (const studentId of getRelationIds(entry, "학생")) {
      counseledStudentIds.add(studentId);
    }
  }

  return classes.map((c) => {
    const recs = byClass.get(c.id) ?? [];
    const total = recs.length;
    const present = recs.filter((r) => getSelect(r, "출결") !== "결석").length;
    const homeworkDone = recs.filter((r) => getCheckbox(r, "과제여부")).length;
    const vocabPass = recs.filter((r) => getSelect(r, "단어테스트결과") === "통과").length;
    const rosterSize = c.studentIds.length;
    const counseledInClass = c.studentIds.filter((id) => counseledStudentIds.has(id)).length;
    return {
      classId: c.id,
      className: c.name,
      recordCount: total,
      attendanceRate: total === 0 ? null : present / total,
      homeworkRate: total === 0 ? null : homeworkDone / total,
      vocabPassRate: total === 0 ? null : vocabPass / total,
      counselingRate: rosterSize === 0 ? null : counseledInClass / rosterSize,
    };
  });
}

// Students with the worst attendance rate so far this (KST) calendar month —
// drives the dashboard's default "학생검색" view before anything is typed.
// Per-student rates for this (KST) month — the dashboard sorts/slices this
// three different ways (출석률/단어재시율/과제미이행률 tabs) rather than
// making three separate round trips.
export async function getMonthlyStudentMetrics() {
  const [y, m] = todayKST().split("-").map(Number);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;

  const [records, classes, names] = await Promise.all([
    queryAllPages({
      data_source_id: DB.DAILY_RECORD,
      filter: { property: "날짜", date: { on_or_after: monthStart } },
    }),
    listClasses(),
    studentNameMap(),
  ]);
  const classNameById = new Map(classes.map((c) => [c.id, c.name]));

  type Agg = {
    attTotal: number;
    attPresent: number;
    vocabTotal: number;
    vocabRetry: number;
    hwTotal: number;
    hwIncomplete: number;
    classId: string | null;
  };
  const byStudent = new Map<string, Agg>();
  for (const r of records) {
    const studentId = getRelationIds(r, "학생")[0];
    if (!studentId) continue;
    const cur: Agg = byStudent.get(studentId) ?? {
      attTotal: 0,
      attPresent: 0,
      vocabTotal: 0,
      vocabRetry: 0,
      hwTotal: 0,
      hwIncomplete: 0,
      classId: getRelationIds(r, "반")[0] ?? null,
    };
    cur.attTotal += 1;
    if (getSelect(r, "출결") !== "결석") cur.attPresent += 1;
    const voc = getSelect(r, "단어테스트결과");
    if (voc && voc !== "미응시") {
      cur.vocabTotal += 1;
      if (voc === "재시험") cur.vocabRetry += 1;
    }
    cur.hwTotal += 1;
    if (!getCheckbox(r, "과제여부")) cur.hwIncomplete += 1;
    byStudent.set(studentId, cur);
  }

  return Array.from(byStudent.entries()).map(([studentId, v]) => ({
    studentId,
    studentName: names.get(studentId) ?? "-",
    className: v.classId ? classNameById.get(v.classId) ?? "-" : "-",
    recordCount: v.attTotal,
    attendanceRate: v.attTotal > 0 ? v.attPresent / v.attTotal : null,
    vocabRetryRate: v.vocabTotal > 0 ? v.vocabRetry / v.vocabTotal : null,
    homeworkIncompleteRate: v.hwTotal > 0 ? v.hwIncomplete / v.hwTotal : null,
  }));
}

// Donut-chart data: this (KST) month's 출결/단어테스트결과 breakdown across
// every DB④ record, for the dashboard's "이번달 현황" pies.
export async function getMonthlyOutcomeBreakdown(month?: string) {
  const [y, m] = (month ?? todayKST().slice(0, 7)).split("-").map(Number);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const nextMonthStart = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  const dateFilter = {
    and: [
      { property: "날짜", date: { on_or_after: monthStart } },
      { property: "날짜", date: { before: nextMonthStart } },
    ],
  };

  const [records, counselingEntries] = await Promise.all([
    queryAllPages({ data_source_id: DB.DAILY_RECORD, filter: dateFilter }),
    queryAllPages({ data_source_id: DB.COUNSELING, filter: dateFilter }),
  ]);

  const attendance = { 출석: 0, 지각: 0, 결석: 0 };
  const vocab = { 통과: 0, 재시험: 0, 미응시: 0 };
  const homework = { 완료: 0, 미완료: 0 };
  for (const r of records) {
    const att = getSelect(r, "출결") as keyof typeof attendance | null;
    if (att && att in attendance) attendance[att] += 1;
    const voc = getSelect(r, "단어테스트결과") as keyof typeof vocab | null;
    if (voc && voc in vocab) vocab[voc] += 1;
    if (getCheckbox(r, "과제여부")) homework.완료 += 1;
    else homework.미완료 += 1;
  }

  const counselingByCounselor: Record<string, number> = {};
  for (const entry of counselingEntries) {
    const counselor = getRichText(entry, "상담자") || "미지정";
    counselingByCounselor[counselor] = (counselingByCounselor[counselor] ?? 0) + 1;
  }

  return { attendance, vocab, homework, counselingByCounselor };
}

// "오늘의 일정": alarms + new-student events + makeup/retest sessions due today.
// Grade strings look like "중2"/"고1" — several 오늘의 일정 sections only
// want the trailing digit ("2"/"1"), not the level prefix.
function gradeDigits(grade: string | null): string {
  return (grade ?? "").replace(/\D/g, "");
}

async function classInfoMap(): Promise<Map<string, { days: string[]; time: string }>> {
  const classes = await listClasses();
  return new Map(classes.map((c) => [c.id, { days: c.days, time: c.time }]));
}

async function staffNameMap(): Promise<Map<string, string>> {
  const results = await queryAllPages({ data_source_id: DB.STAFF });
  return new Map(results.map((p: any) => [p.id, getTitle(p, "이름")]));
}

export async function getTodaySchedule(today: string) {
  const [alarmStudents, firstDayStudents, todoResults, names, classMap, staffMap] = await Promise.all([
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
    classInfoMap(),
    staffNameMap(),
  ]);

  const alarms = alarmStudents.map((p: any) => ({
    id: p.id,
    studentName: getTitle(p, "이름"),
    school: getRichText(p, "학교"),
    content: getRichText(p, "조치"),
    counselor: getRichText(p, "조치담당자"),
    status: getSelect(p, "상태"),
  }));

  const firstDays = firstDayStudents.map((p: any) => {
    const classId = getRelationIds(p, "소속반")[0];
    const cls = classId ? classMap.get(classId) : undefined;
    return {
      id: p.id,
      studentName: getTitle(p, "이름"),
      school: getRichText(p, "학교"),
      gradeNum: gradeDigits(getSelect(p, "학년")),
      classDays: cls?.days ?? [],
      classTime: cls?.time ?? "",
      status: getSelect(p, "상태"),
    };
  });

  const byTypes = (types: string[]) =>
    todoResults
      .filter((p: any) => types.includes(getSelect(p, "유형") ?? ""))
      .map((p: any) => {
        const studentId = getRelationIds(p, "관련학생")[0];
        const ownerId = getRelationIds(p, "담당자")[0];
        return {
          id: p.id,
          title: getTitle(p, "제목"),
          time: getRichText(p, "시간"),
          studentName: studentId ? names.get(studentId) ?? "-" : "-",
          school: "", // filled in below once we know the student
          gradeNum: "",
          owner: ownerId ? staffMap.get(ownerId) ?? "-" : "-",
          done: getCheckbox(p, "완료여부"),
          _studentId: studentId as string | undefined,
        };
      });

  // byTypes only has the name from studentNameMap (id->name); pull
  // school/grade/status for those rows from a second full-student pass.
  const studentBrief = await studentBriefMap();
  const withStudentInfo = (items: ReturnType<typeof byTypes>) =>
    items.map(({ _studentId, ...rest }) => {
      const info = _studentId ? studentBrief.get(_studentId) : undefined;
      return { ...rest, school: info?.school ?? "", gradeNum: info?.gradeNum ?? "", status: info?.status ?? null };
    });

  return {
    alarms,
    firstDays,
    newStudentEvents: withStudentInfo(byTypes(["신입생상담", "레벨체크"])),
    makeupClasses: withStudentInfo(byTypes(["보강"])),
    retests: withStudentInfo(byTypes(["재시"])),
  };
}

async function studentBriefMap(): Promise<Map<string, { school: string; gradeNum: string; status: string | null }>> {
  const students = await searchStudents("");
  return new Map(students.map((s) => [s.id, { school: s.school, gradeNum: gradeDigits(s.grade), status: s.status }]));
}

// Full (not digit-only) school/grade, for the "이름 학교(학년) 내용" single-line
// list rows on 행정실/상담일지.
async function studentSchoolGradeMap(): Promise<Map<string, { school: string; grade: string | null }>> {
  const students = await searchStudents("");
  return new Map(students.map((s) => [s.id, { school: s.school, grade: s.grade }]));
}

export async function createClassProgress(input: {
  classId: string;
  date: string;
  subjects: string[];
  progress: string;
  homework: string;
  nextAssignment: string;
  notice: string;
  perStudent: Record<string, { vocabFail: boolean; homeworkIncomplete: boolean; absent: boolean }>;
  briefingTexts?: Record<string, string>;
  // Students called up from a different class for a one-off individual
  // record (e.g. a makeup or guest attendee), in addition to the class's
  // own roster.
  extraStudentIds?: string[];
}) {
  const classPage: any = await notion.pages.retrieve({ page_id: input.classId });
  const className = getTitle(classPage, "반이름");
  const classRosterIds = getRelationIds(classPage, "소속학생");
  const studentIds = Array.from(new Set([...classRosterIds, ...(input.extraStudentIds ?? [])]));

  const progressPage = await notion.pages.create({
    parent: { data_source_id: DB.CLASS_PROGRESS } as any,
    properties: {
      제목: { title: [{ text: { content: `${input.date} ${className} 진도` } }] },
      반: { relation: [{ id: input.classId }] },
      날짜: { date: { start: input.date } },
      수업과목: { multi_select: input.subjects.map((name) => ({ name })) },
      진도내용: { rich_text: [{ text: { content: input.progress } }] },
      과제내용: { rich_text: [{ text: { content: input.homework } }] },
      다음시간테스트: { rich_text: [{ text: { content: input.nextAssignment } }] },
      전달사항: { rich_text: [{ text: { content: input.notice } }] },
    } as any,
  });

  const dailyRecordIds: string[] = [];
  const briefingIds: string[] = [];
  for (const studentId of studentIds) {
    const studentPage: any = await notion.pages.retrieve({ page_id: studentId });
    const studentName = getTitle(studentPage, "이름");
    const flags = input.perStudent[studentId] ?? { vocabFail: false, homeworkIncomplete: false, absent: false };

    const daily = await notion.pages.create({
      parent: { data_source_id: DB.DAILY_RECORD } as any,
      properties: {
        제목: { title: [{ text: { content: `${studentName} ${input.date}` } }] },
        학생: { relation: [{ id: studentId }] },
        반: { relation: [{ id: input.classId }] },
        날짜: { date: { start: input.date } },
        진도내용: { rich_text: [{ text: { content: input.progress } }] },
        출결: { select: { name: flags.absent ? "결석" : "출석" } },
        과제여부: { checkbox: !flags.homeworkIncomplete },
        단어테스트결과: { select: { name: flags.vocabFail ? "재시험" : "통과" } },
        반별진도원본: { relation: [{ id: progressPage.id }] },
      } as any,
    });
    dailyRecordIds.push(daily.id);

    const briefingText =
      input.briefingTexts?.[studentId] ??
      formatBriefingText({
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

  return {
    progressPageId: progressPage.id,
    studentCount: dailyRecordIds.length,
    briefingCount: briefingIds.length,
  };
}

// Looks up an already-saved 오늘 수업 기록 for a class+date so the input
// form can load it back in for editing instead of only ever creating new
// (and duplicate) records for a class that's already been logged that day.
export async function getClassProgressForEdit(classId: string, date: string) {
  const res = await notion.dataSources.query({
    data_source_id: DB.CLASS_PROGRESS,
    filter: {
      and: [
        { property: "반", relation: { contains: classId } },
        { property: "날짜", date: { equals: date } },
      ],
    },
    page_size: 1,
  });
  const page = res.results[0] as any;
  if (!page) return null;

  const dailyRecords = await queryAllPages({
    data_source_id: DB.DAILY_RECORD,
    filter: { property: "반별진도원본", relation: { contains: page.id } },
  });

  const studentIds: string[] = [];
  const perStudent: Record<string, { absent: boolean; vocabFail: boolean; homeworkIncomplete: boolean }> = {};
  for (const dp of dailyRecords as any[]) {
    const studentId = getRelationIds(dp, "학생")[0];
    if (!studentId) continue;
    studentIds.push(studentId);
    perStudent[studentId] = {
      absent: getSelect(dp, "출결") === "결석",
      vocabFail: getSelect(dp, "단어테스트결과") === "재시험",
      homeworkIncomplete: !getCheckbox(dp, "과제여부"),
    };
  }

  return {
    progressId: page.id,
    subjects: getMultiSelect(page, "수업과목"),
    progress: getRichText(page, "진도내용"),
    homework: getRichText(page, "과제내용"),
    nextAssignment: getRichText(page, "다음시간테스트"),
    notice: getRichText(page, "전달사항"),
    studentIds,
    perStudent,
  };
}

// Updates an existing 오늘 수업 기록 in place: the shared 반별진도 page plus
// each student's 일일기록 row. Students already covered by an existing row
// are updated; any newly-called-up 다른반 student gets a fresh row appended
// (mirrors createClassProgress's row-creation, minus 브리핑 regeneration —
// briefings already generated/sent for this date are left untouched).
export async function updateClassProgress(input: {
  progressId: string;
  classId: string;
  date: string;
  subjects: string[];
  progress: string;
  homework: string;
  nextAssignment: string;
  notice: string;
  perStudent: Record<string, { vocabFail: boolean; homeworkIncomplete: boolean; absent: boolean }>;
  extraStudentIds?: string[];
}) {
  const classPage: any = await notion.pages.retrieve({ page_id: input.classId });
  const classRosterIds = getRelationIds(classPage, "소속학생");
  const studentIds = Array.from(new Set([...classRosterIds, ...(input.extraStudentIds ?? [])]));

  await notion.pages.update({
    page_id: input.progressId,
    properties: {
      반: { relation: [{ id: input.classId }] },
      수업과목: { multi_select: input.subjects.map((name) => ({ name })) },
      진도내용: { rich_text: [{ text: { content: input.progress } }] },
      과제내용: { rich_text: [{ text: { content: input.homework } }] },
      다음시간테스트: { rich_text: [{ text: { content: input.nextAssignment } }] },
      전달사항: { rich_text: [{ text: { content: input.notice } }] },
    } as any,
  });

  const existingDaily = await queryAllPages({
    data_source_id: DB.DAILY_RECORD,
    filter: { property: "반별진도원본", relation: { contains: input.progressId } },
  });
  const dailyByStudent = new Map<string, any>();
  for (const dp of existingDaily as any[]) {
    const sid = getRelationIds(dp, "학생")[0];
    if (sid) dailyByStudent.set(sid, dp);
  }

  const newDailyIds: string[] = [];
  for (const studentId of studentIds) {
    const flags = input.perStudent[studentId] ?? { vocabFail: false, homeworkIncomplete: false, absent: false };
    const properties = {
      진도내용: { rich_text: [{ text: { content: input.progress } }] },
      출결: { select: { name: flags.absent ? "결석" : "출석" } },
      과제여부: { checkbox: !flags.homeworkIncomplete },
      단어테스트결과: { select: { name: flags.vocabFail ? "재시험" : "통과" } },
    };
    const existing = dailyByStudent.get(studentId);
    if (existing) {
      await notion.pages.update({ page_id: existing.id, properties: properties as any });
    } else {
      const studentPage: any = await notion.pages.retrieve({ page_id: studentId });
      const studentName = getTitle(studentPage, "이름");
      const daily = await notion.pages.create({
        parent: { data_source_id: DB.DAILY_RECORD } as any,
        properties: {
          제목: { title: [{ text: { content: `${studentName} ${input.date}` } }] },
          학생: { relation: [{ id: studentId }] },
          반: { relation: [{ id: input.classId }] },
          날짜: { date: { start: input.date } },
          반별진도원본: { relation: [{ id: input.progressId }] },
          ...properties,
        } as any,
      });
      newDailyIds.push(daily.id);
    }
  }

  if (newDailyIds.length > 0) {
    const allIds = [...Array.from(dailyByStudent.values()).map((d: any) => d.id), ...newDailyIds];
    await notion.pages.update({
      page_id: input.progressId,
      properties: { 생성된학생기록: { relation: allIds.map((id) => ({ id })) } } as any,
    });
  }
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
  const [results, names, briefs] = await Promise.all([
    queryAllPages({
      data_source_id: DB.ADMIN_INBOX,
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    }),
    studentNameMap(),
    studentSchoolGradeMap(),
  ]);
  return results.map((p: any) => {
    const studentId = getRelationIds(p, "대상학생")[0] ?? null;
    const brief = studentId ? briefs.get(studentId) : undefined;
    return {
      id: p.id,
      date: getDate(p, "날짜"),
      endDate: getDate(p, "종료일"),
      type: getSelect(p, "입력유형"),
      studentId,
      studentName: firstRelationName(p, "대상학생", names),
      studentSchool: brief?.school ?? "",
      studentGrade: brief?.grade ?? null,
      content: getRichText(p, "내용"),
      done: getCheckbox(p, "처리완료"),
      enteredBy: getRichText(p, "입력자"),
    };
  });
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
  const [results, names, briefs] = await Promise.all([
    queryAllPages({
      data_source_id: DB.COUNSELING,
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    }),
    studentNameMap(),
    studentSchoolGradeMap(),
  ]);
  return results.map((p: any) => {
    const studentId = getRelationIds(p, "학생")[0] ?? null;
    const brief = studentId ? briefs.get(studentId) : undefined;
    return {
      id: p.id,
      date: getDate(p, "날짜"),
      studentId,
      studentName: firstRelationName(p, "학생", names),
      studentSchool: brief?.school ?? "",
      studentGrade: brief?.grade ?? null,
      counselor: getRichText(p, "상담자"),
      transcript: getRichText(p, "전사내용"),
      content: getRichText(p, "상담내용"),
      followUp: getRichText(p, "후속조치"),
      enteredBy: getRichText(p, "입력자"),
    };
  });
}

export async function updateCounselingEntry(
  id: string,
  input: { counselor?: string; date?: string; transcript?: string; summary?: string; followUp?: string }
) {
  const properties: any = {};
  if (input.counselor !== undefined) properties["상담자"] = { rich_text: [{ text: { content: input.counselor } }] };
  if (input.date) properties["날짜"] = { date: { start: input.date } };
  if (input.transcript !== undefined) properties["전사내용"] = { rich_text: [{ text: { content: input.transcript } }] };
  if (input.summary !== undefined) properties["상담내용"] = { rich_text: [{ text: { content: input.summary } }] };
  if (input.followUp !== undefined) properties["후속조치"] = { rich_text: [{ text: { content: input.followUp } }] };
  await notion.pages.update({ page_id: id, properties });
}

export async function updateAdminInboxEntry(
  id: string,
  input: { type?: string; content?: string; startDate?: string; endDate?: string }
) {
  const properties: any = {};
  if (input.type) properties["입력유형"] = { select: { name: input.type } };
  if (input.content !== undefined) properties["내용"] = { rich_text: [{ text: { content: input.content } }] };
  if (input.startDate) properties["날짜"] = { date: { start: input.startDate } };
  if (input.endDate !== undefined) {
    properties["종료일"] = input.endDate ? { date: { start: input.endDate } } : { date: null };
  }
  await notion.pages.update({ page_id: id, properties });
}

export async function createAdminInboxEntry(input: {
  type: string;
  studentId: string | null;
  content: string;
  startDate?: string;
  endDate?: string;
  enteredBy?: string;
}) {
  const studentName = input.studentId
    ? getTitle(await notion.pages.retrieve({ page_id: input.studentId }) as any, "이름")
    : "전체";
  const startDate = input.startDate || todayKST();
  await notion.pages.create({
    parent: { data_source_id: DB.ADMIN_INBOX } as any,
    properties: {
      제목: { title: [{ text: { content: `${input.type} - ${studentName}` } }] },
      입력유형: { select: { name: input.type } },
      ...(input.studentId
        ? { 대상학생: { relation: [{ id: input.studentId }] } }
        : {}),
      날짜: { date: { start: startDate } },
      ...(input.endDate ? { 종료일: { date: { start: input.endDate } } } : {}),
      내용: { rich_text: [{ text: { content: input.content } }] },
      처리완료: { checkbox: false },
      ...(input.enteredBy ? { 입력자: { rich_text: [{ text: { content: input.enteredBy } }] } } : {}),
    } as any,
  });
}

export async function updateStudentInfo(input: {
  studentId: string;
  enrolledAt?: string;
  tuitionDay?: number;
  learningLevel?: string;
  action?: string;
  actionOwner?: string;
  actionAlarmDate?: string;
}) {
  const properties: any = {};
  if (input.enrolledAt) properties["등원일"] = { date: { start: input.enrolledAt } };
  if (input.tuitionDay !== undefined) properties["회비일"] = { number: input.tuitionDay };
  if (input.learningLevel !== undefined)
    properties["학습레벨"] = { rich_text: [{ text: { content: input.learningLevel } }] };
  if (input.action !== undefined)
    properties["조치"] = { rich_text: [{ text: { content: input.action } }] };
  if (input.actionOwner !== undefined)
    properties["조치담당자"] = { rich_text: [{ text: { content: input.actionOwner } }] };
  if (input.actionAlarmDate)
    properties["조치알람일"] = { date: { start: input.actionAlarmDate } };

  await notion.pages.update({ page_id: input.studentId, properties });

  // DB②의 조치/조치담당자/조치알람일은 매번 덮어써지는 "현재 상태" 필드라
  // 이력이 남지 않는다. action이 있을 때는 DB⑱에 조치사항 유형 레코드를
  // 하나 더 남겨서, 학생별 히스토리(StudentHistoryModal)에서 언제 어떤
  // 조치가 있었는지 계속 확인할 수 있게 한다.
  if (input.action) {
    const studentPage: any = await notion.pages.retrieve({ page_id: input.studentId });
    const studentName = getTitle(studentPage, "이름");
    const ownerId = input.actionOwner ? await findStaffIdByName(input.actionOwner) : null;
    await notion.pages.create({
      parent: { data_source_id: DB.TODO } as any,
      properties: {
        제목: { title: [{ text: { content: input.action } }] },
        유형: { select: { name: "조치사항" } },
        관련학생: { relation: [{ id: input.studentId }] },
        ...(ownerId ? { 담당자: { relation: [{ id: ownerId }] } } : {}),
        예정일: { date: { start: input.actionAlarmDate || todayKST() } },
        완료여부: { checkbox: false },
        우선순위: { select: { name: "보통" } },
      } as any,
    });
  }
}

// Minimal DB② student record, created on the fly when a 자연어 입력 mentions
// a name that isn't in the roster and staff confirm it should be a new
// student rather than a typo. Everything else (학년/연락처 등) is left for
// staff to fill in later via the 학생정보수정 form — 학교 is filled in when
// the input text happened to mention it, otherwise left blank rather than
// guessed at.
export async function createMinimalStudent(name: string, school?: string): Promise<string> {
  const page = await notion.pages.create({
    parent: { data_source_id: DB.STUDENT } as any,
    properties: {
      이름: { title: [{ text: { content: name } }] },
      상태: { select: { name: "재원" } },
      등원일: { date: { start: todayKST() } },
      ...(school ? { 학교: { rich_text: [{ text: { content: school } }] } } : {}),
    } as any,
  });
  return page.id;
}

// Full 학생등록 form (행정) — unlike createMinimalStudent (auto-created from
// an AI 신규생문의 log with just a name), this captures everything staff
// enter up front: contact info, status, class assignment, tuition day, etc.
export async function createStudent(input: {
  name: string;
  school?: string;
  grade?: string;
  status: string;
  phone?: string;
  parentPhone?: string;
  registeredAt?: string;
  enrolledAt?: string;
  tuitionDay?: number;
  learningLevel?: string;
  classIds?: string[];
  memo?: string;
}): Promise<string> {
  const page = await notion.pages.create({
    parent: { data_source_id: DB.STUDENT } as any,
    properties: {
      이름: { title: [{ text: { content: input.name } }] },
      상태: { select: { name: input.status } },
      ...(input.school ? { 학교: { rich_text: [{ text: { content: input.school } }] } } : {}),
      ...(input.grade ? { 학년: { select: { name: input.grade } } } : {}),
      ...(input.phone ? { 연락처: { phone_number: input.phone } } : {}),
      ...(input.parentPhone ? { 학부모연락처: { phone_number: input.parentPhone } } : {}),
      ...(input.registeredAt ? { 등록일: { date: { start: input.registeredAt } } } : {}),
      ...(input.enrolledAt ? { 등원일: { date: { start: input.enrolledAt } } } : {}),
      ...(input.tuitionDay !== undefined ? { 회비일: { number: input.tuitionDay } } : {}),
      ...(input.learningLevel ? { 학습레벨: { rich_text: [{ text: { content: input.learningLevel } }] } } : {}),
      ...(input.classIds && input.classIds.length > 0
        ? { 소속반: { relation: input.classIds.map((id) => ({ id })) } }
        : {}),
      ...(input.memo ? { 메모: { rich_text: [{ text: { content: input.memo } }] } } : {}),
    } as any,
  });
  return page.id;
}

async function findStaffIdByName(name: string): Promise<string | null> {
  const res = await notion.dataSources.query({
    data_source_id: DB.STAFF,
    filter: { property: "이름", title: { equals: name } },
    page_size: 1,
  });
  return (res.results[0] as any)?.id ?? null;
}

export async function createScheduleEntry(input: {
  type: "보강" | "재시" | "신입생상담" | "레벨체크";
  studentId: string | null;
  date: string;
  time: string;
  note: string;
  ownerName?: string;
}) {
  const studentName = input.studentId
    ? getTitle((await notion.pages.retrieve({ page_id: input.studentId })) as any, "이름")
    : "";
  const ownerId = input.ownerName ? await findStaffIdByName(input.ownerName) : null;
  await notion.pages.create({
    parent: { data_source_id: DB.TODO } as any,
    properties: {
      제목: { title: [{ text: { content: `${input.type}${studentName ? " - " + studentName : ""}` } }] },
      유형: { select: { name: input.type } },
      ...(input.studentId ? { 관련학생: { relation: [{ id: input.studentId }] } } : {}),
      ...(ownerId ? { 담당자: { relation: [{ id: ownerId }] } } : {}),
      예정일: { date: { start: input.date } },
      시간: { rich_text: [{ text: { content: input.time } }] },
      완료여부: { checkbox: false },
      우선순위: { select: { name: "보통" } },
    } as any,
  });
}

export async function completeScheduleEntry(id: string) {
  await notion.pages.update({
    page_id: id,
    properties: { 완료여부: { checkbox: true } } as any,
  });
}

export async function updateScheduleEntry(
  id: string,
  input: { date?: string; time?: string; ownerName?: string }
) {
  const properties: any = {};
  if (input.date) properties["예정일"] = { date: { start: input.date } };
  if (input.time !== undefined) properties["시간"] = { rich_text: [{ text: { content: input.time } }] };
  if (input.ownerName !== undefined) {
    const ownerId = input.ownerName ? await findStaffIdByName(input.ownerName) : null;
    properties["담당자"] = { relation: ownerId ? [{ id: ownerId }] : [] };
  }
  await notion.pages.update({ page_id: id, properties });
}

export async function createCounselingEntry(input: {
  studentId: string;
  counselor: string;
  date: string;
  transcript: string;
  summary: string;
  followUp: string;
  enteredBy?: string;
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
      ...(input.enteredBy ? { 입력자: { rich_text: [{ text: { content: input.enteredBy } }] } } : {}),
    } as any,
  });
}
