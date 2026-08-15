import { Client } from "@notionhq/client";
import { unstable_cache, revalidateTag } from "next/cache";
import { todayKST } from "./date";
import { formatBriefingText } from "./briefingFormat";
import {
  stripClassSuffix,
  parseWorkHours,
  serializeWorkHours,
  formatClassSchedule,
  parseDayTeachers,
  serializeDayTeachers,
  type WorkHours,
  type DayTeachers,
} from "./format";
import {
  type ExamPrepData,
  type ExamPrepSheet,
  type ExamPrepTemplate,
  type SchoolLevel,
  type HighData,
  type MiddleData,
  type TextSource,
  type TextCategory,
  type PracticeCategory,
  MIDDLE_PRACTICE_CATEGORIES,
  computeCategoryBreakdown,
  computeProgress,
  defaultDataFor,
  emptyPracticeItems,
  joinTeachers,
  levelFromGrade,
  newTextSource,
  newMiddleTextSource,
  splitTeachers,
} from "./examPrep";

const STAFF_CACHE_TAG = "staff-list";

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
  CLINIC: process.env.NOTION_DB_CLINIC!,
  MATERIAL: process.env.NOTION_DB_MATERIAL!,
  EXAM_PREP: process.env.NOTION_DB_EXAM_PREP!,
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

// Notion rich_text 블록 하나는 2000자를 넘길 수 없다 — 그보다 긴 문자열은
// 여러 블록으로 쪼개서 써야 한다(읽을 때는 getRichText가 이어붙여준다).
const NOTION_RICH_TEXT_LIMIT = 2000;
function chunkRichText(content: string): { text: { content: string } }[] {
  if (content.length <= NOTION_RICH_TEXT_LIMIT) return [{ text: { content } }];
  const chunks: { text: { content: string } }[] = [];
  for (let i = 0; i < content.length; i += NOTION_RICH_TEXT_LIMIT) {
    chunks.push({ text: { content: content.slice(i, i + NOTION_RICH_TEXT_LIMIT) } });
  }
  return chunks;
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

export function getUrl(page: Page, prop: string): string | null {
  return page.properties?.[prop]?.url ?? null;
}

export function getFiles(page: Page, prop: string): { name: string; url: string }[] {
  const files = page.properties?.[prop]?.files ?? [];
  return files.map((f: any) => ({
    name: f.name ?? "파일",
    url: (f.type === "file" ? f.file?.url : f.external?.url) ?? "",
  }));
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

// 로그인 화면(직원 목록 조회 + PIN 확인)에서 매번 Notion을 직접 조회하면
// 요청마다 왕복 지연이 그대로 로그인 속도로 이어진다. 직원 명단/PIN은
// 자주 바뀌지 않으므로 짧은 TTL로 캐싱해 두 API가 같은 캐시를 공유하게 한다.
const getCachedStaffList = unstable_cache(
  async () => {
    const res = await notion.dataSources.query({
      data_source_id: DB.STAFF,
      page_size: 100,
    });
    return res.results.map((p: any) => ({
      id: p.id,
      name: getTitle(p, "이름"),
      role: getSelect(p, "역할"),
      pin: getRichText(p, "PIN"),
      mustChangePin: getCheckbox(p, "비번변경필요"),
      // 요일마다 근무시간이 다를 수 있어(월 14~18시, 수 16~20시 등) 압축
      // 문자열 하나(근무시간표)에 담아 저장 — parseWorkHours가 요일별
      // {start,end} 맵으로 풀어준다. 예전에 쓰던 근무요일(멀티셀렉트)/
      // 근무시작/근무종료(전체 요일 공통 한 세트)는 더는 쓰지 않는다.
      workHours: parseWorkHours(getRichText(p, "근무시간표")),
    }));
  },
  ["staff-list"],
  { revalidate: 30, tags: [STAFF_CACHE_TAG] }
);

export async function listStaff() {
  const all = await getCachedStaffList();
  return all.map(({ id, name, role, workHours }) => ({
    id,
    name,
    role,
    workHours,
  }));
}

// 조교(주로)의 요일별 근무시간을 설정한다 — 보강/재시/클리닉 배정 시 그
// 날짜·시간에 실제로 근무하는 조교인지 확인하는 데 쓰인다. 비워두면(기본값)
// 요일/시간 제한 없이 항상 가능한 것으로 취급한다(기존 강사/원장/행정 계정과
// 호환 유지).
export async function updateStaffSchedule(staffId: string, workHours: WorkHours) {
  await notion.pages.update({
    page_id: staffId,
    properties: {
      근무시간표: { rich_text: [{ text: { content: serializeWorkHours(workHours) } }] },
      근무요일: { multi_select: Object.keys(workHours).map((d) => ({ name: d })) },
    } as any,
  });
  revalidateTag(STAFF_CACHE_TAG);
}

export async function findStaffByNameAndPin(name: string, pin: string) {
  const all = await getCachedStaffList();
  const staff = all.find((s) => s.name === name);
  if (!staff || staff.pin !== pin) return null;
  return {
    id: staff.id,
    name: staff.name,
    role: staff.role,
    mustChangePin: staff.mustChangePin,
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
  // PIN 변경 직후에도 캐시가 옛 PIN을 들고 있으면 안 되므로 즉시 무효화.
  revalidateTag(STAFF_CACHE_TAG);
}

export async function listClasses() {
  const results = await queryAllPages({ data_source_id: DB.CLASS });
  return results.map((p: any) => ({
    id: p.id,
    name: getTitle(p, "반이름"),
    teachers: splitTeachers(getRichText(p, "담당교사")),
    dayTeachers: parseDayTeachers(getRichText(p, "요일별담당교사")),
    days: getMultiSelect(p, "요일"),
    time: getRichText(p, "시간"),
    level: getSelect(p, "레벨"),
    studentIds: getRelationIds(p, "소속학생"),
    assistantIds: getRelationIds(p, "담당조교"),
  }));
}

// 반 단위로 조교를 배정 — 개별 학생을 매번 검색해서 고르는 대신, 원장/행정이
// "이 조교는 이 반을 담당한다"를 미리 설정해두면 조교 쪽에서 그 반 명단을
// 한 번에 불러올 수 있다.
export async function assignClassAssistants(classId: string, assistantIds: string[]) {
  await notion.pages.update({
    page_id: classId,
    properties: { 담당조교: { relation: assistantIds.map((id) => ({ id })) } } as any,
  });
}

export async function createClass(input: {
  name: string;
  teachers?: string[];
  dayTeachers?: DayTeachers;
  days?: string[];
  time?: string;
  level?: string;
}): Promise<string> {
  const page = await notion.pages.create({
    parent: { data_source_id: DB.CLASS } as any,
    properties: {
      반이름: { title: [{ text: { content: input.name } }] },
      ...(input.teachers && input.teachers.length > 0
        ? { 담당교사: { rich_text: [{ text: { content: joinTeachers(input.teachers) } }] } }
        : {}),
      ...(input.dayTeachers && Object.keys(input.dayTeachers).length > 0
        ? { 요일별담당교사: { rich_text: [{ text: { content: serializeDayTeachers(input.dayTeachers) } }] } }
        : {}),
      ...(input.days && input.days.length > 0 ? { 요일: { multi_select: input.days.map((d) => ({ name: d })) } } : {}),
      ...(input.time ? { 시간: { rich_text: [{ text: { content: input.time } }] } } : {}),
      ...(input.level ? { 레벨: { select: { name: input.level } } } : {}),
    } as any,
  });
  return page.id;
}

// 반명 변경을 포함한 반 정보 수정 — 반이름(title) 수정은 기존에 이 반을
// 참조하는 다른 레코드들(학생 소속반 relation 등)에 영향을 주지 않는다.
// Notion relation은 페이지 id로 연결되므로 제목만 바뀌어도 관계는 그대로 유지됨.
export async function updateClass(
  classId: string,
  input: {
    name?: string;
    teachers?: string[];
    dayTeachers?: DayTeachers;
    days?: string[];
    time?: string;
    level?: string;
  }
) {
  const properties: any = {};
  if (input.name) properties["반이름"] = { title: [{ text: { content: input.name } }] };
  if (input.teachers !== undefined)
    properties["담당교사"] = { rich_text: [{ text: { content: joinTeachers(input.teachers) } }] };
  if (input.dayTeachers !== undefined)
    properties["요일별담당교사"] = { rich_text: [{ text: { content: serializeDayTeachers(input.dayTeachers) } }] };
  if (input.days !== undefined) properties["요일"] = { multi_select: input.days.map((d) => ({ name: d })) };
  if (input.time !== undefined) properties["시간"] = { rich_text: [{ text: { content: input.time } }] };
  if (input.level !== undefined) properties["레벨"] = input.level ? { select: { name: input.level } } : { select: null };
  await notion.pages.update({ page_id: classId, properties });
}

// 반 삭제(보관 처리) — 학생이 한 명도 등록되지 않은 반을 정리할 때 쓴다.
// 소속학생/진도기록 등이 이미 있는 반을 실수로 지우는 걸 막기 위해 호출
// 전에 studentIds가 비어있는지 라우트에서 확인한다.
export async function deleteClass(classId: string) {
  await notion.pages.update({ page_id: classId, archived: true });
}

// 반이름 중복 생성/개명을 막을 때 쓴다 — "(숫자)" seed-data 접미사를 떼고
// 비교해 "파닉스"와 "파닉스 (2)"도 같은 이름으로 취급한다. excludeId를 주면
// (수정 중인 반 자기 자신) 비교에서 제외한다.
export async function findClassByName(name: string, excludeId?: string) {
  const trimmed = stripClassSuffix(name).trim();
  const classes = await listClasses();
  return classes.find((c) => c.id !== excludeId && stripClassSuffix(c.name).trim() === trimmed) ?? null;
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

function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
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

async function classNameMap(): Promise<Map<string, string>> {
  const classes = await listClasses();
  return new Map(classes.map((c) => [c.id, stripClassSuffix(c.name)]));
}

function mapStudentPage(p: any, examMap: Map<string, any>, classNameById: Map<string, string>) {
  const enrolledAt = getDate(p, "등원일");
  const classIds = getRelationIds(p, "소속반");
  return {
    id: p.id,
    name: getTitle(p, "이름"),
    school: getRichText(p, "학교"),
    grade: getSelect(p, "학년"),
    status: getSelect(p, "상태"),
    phone: getPhone(p, "연락처"),
    parentPhone: getPhone(p, "학부모연락처"),
    classIds,
    classNames: classIds.map((id) => classNameById.get(id) ?? "알수없음"),
    attendanceRate: getRollupNumber(p, "누적출석률"),
    homeworkRate: getRollupNumber(p, "누적숙제제출률"),
    vocabPassRate: getRollupNumber(p, "누적단어테스트통과율"),
    registeredAt: getDate(p, "등록일"),
    enrolledAt,
    isNew: isWithinDays(enrolledAt, 30),
    tuitionDay: getNumber(p, "회비일"),
    learningLevel: getRichText(p, "학습레벨"),
    levelOverride: getNumber(p, "레벨Lv"),
    memo: getRichText(p, "메모"),
    action: getRichText(p, "조치"),
    actionOwner: getRichText(p, "조치담당자"),
    actionAlarmDate: getDate(p, "조치알람일"),
    latestExam: examMap.get(p.id) ?? null,
  };
}

export async function searchStudents(query: string, classId?: string, includeInactive = false) {
  const [results, examMap, classById] = await Promise.all([
    queryAllPages({
      data_source_id: DB.STUDENT,
      filter: query ? { property: "이름", title: { contains: query } } : undefined,
    }),
    latestExamScoreMap(),
    classNameMap(),
  ]);
  let mapped = results.map((p: any) => mapStudentPage(p, examMap, classById));
  // 퇴원/휴원 학생은 검색/명단/피커 등 모든 노출 화면에서 제외한다. 학습
  // 기록(DB④일일기록·성적 등)은 학생 페이지 자체를 지우지 않는 한 그대로
  // 보존되므로 데이터 손실은 없다. 예외적으로 학생 정보수정 화면처럼
  // 상태를 되돌리기 위해 퇴원/휴원 학생 본인을 찾아야 하는 곳만
  // includeInactive=true로 이 필터를 건너뛴다.
  if (!includeInactive) mapped = mapped.filter((s) => s.status !== "퇴원" && s.status !== "휴원");
  if (classId) mapped = mapped.filter((s) => s.classIds.includes(classId));
  return mapped;
}

export async function getStudent(id: string) {
  const [p, examMap, classById]: [any, Map<string, any>, Map<string, string>] = await Promise.all([
    notion.pages.retrieve({ page_id: id }),
    latestExamScoreMap(),
    classNameMap(),
  ]);
  return mapStudentPage(p, examMap, classById);
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
    id: p.id,
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
    id: r.id,
    date: r.date,
    progress: r.progress,
    homework: r.progressPageId ? homeworkByProgressId.get(r.progressPageId) ?? "" : "",
    attendance: r.attendance,
    homeworkDone: r.homeworkDone,
  }));

  const [makeupTodos, actionTodos, reviewTodos, clinicTasks, counselingEntries, inboxEntries, clinicEntries, staffMap, examPrepSheet] = await Promise.all([
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
      data_source_id: DB.TODO,
      filter: {
        and: [
          { property: "유형", select: { equals: "복습" } },
          { property: "관련학생", relation: { contains: studentId } },
        ],
      },
    }),
    // "조교 클리닉 지시"(AssignClinicTaskForm)로 만든 DB⑱할일관리의 유형="클리닉"
    // 항목 — 조교가 실제 클리닉 진행 내용을 여기 메모에 적는다. DB⑮조교클리닉기록
    // (AssistantClinicForm으로 만든 별도 기록)과는 다른 데이터라 지금까지 전체기록의
    // "클리닉 기록" 섹션에서 완전히 빠져 있었다 — 아래에서 함께 합쳐준다.
    queryAllPages({
      data_source_id: DB.TODO,
      filter: {
        and: [
          { property: "유형", select: { equals: "클리닉" } },
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
    queryAllPages({
      data_source_id: DB.CLINIC,
      filter: { property: "담당학생", relation: { contains: studentId } },
    }),
    staffNameMap(),
    getExamPrepSheet(studentId),
  ]);

  const makeup = makeupTodos
    .map((p: any) => {
      const ownerId = getRelationIds(p, "담당자")[0];
      return {
        id: p.id,
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
        id: p.id,
        date: getDate(p, "예정일"),
        content: getTitle(p, "제목"),
        owner: ownerId ? staffMap.get(ownerId) ?? "-" : "-",
      };
    })
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  const counseling = counselingEntries
    .map((p: any) => ({
      id: p.id,
      date: getDate(p, "날짜"),
      counselor: getRichText(p, "상담자"),
      content: getRichText(p, "상담내용"),
      followUp: getRichText(p, "후속조치"),
      enteredBy: getRichText(p, "입력자"),
    }))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  const inquiries = inboxEntries
    .map((p: any) => ({
      id: p.id,
      date: getDate(p, "날짜"),
      type: getSelect(p, "입력유형"),
      content: getRichText(p, "내용"),
      done: getCheckbox(p, "처리완료"),
      enteredBy: getRichText(p, "입력자"),
    }))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  const clinicFromRecords = clinicEntries.map((p: any) => {
    const assistantId = getRelationIds(p, "조교")[0];
    return {
      id: p.id,
      date: getDate(p, "날짜"),
      assistant: assistantId ? staffMap.get(assistantId) ?? "-" : "-",
      content: getRichText(p, "진행내용"),
      nextPrep: getRichText(p, "다음준비사항"),
      source: "record" as const,
    };
  });
  const clinicFromTasks = clinicTasks.map((p: any) => {
    const ownerId = getRelationIds(p, "담당자")[0];
    return {
      id: p.id,
      date: getDate(p, "예정일"),
      assistant: ownerId ? staffMap.get(ownerId) ?? "-" : "-",
      content: getRichText(p, "메모"),
      nextPrep: "",
      source: "task" as const,
    };
  });
  const clinic = [...clinicFromRecords, ...clinicFromTasks].sort((a, b) =>
    (a.date ?? "").localeCompare(b.date ?? "")
  );

  const review = reviewTodos
    .map((p: any) => ({
      id: p.id,
      date: getDate(p, "예정일"),
      content: getRichText(p, "메모"),
      done: getCheckbox(p, "완료여부"),
    }))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  // 고등은 텍스트(교과서/부교재/모의고사/학교프린트)별로, 중등은 과(Lesson)
  // 별로 워크북 9단계·단어암기를 따로 관리하므로, 전체기록에서도 카테고리
  // 합산 뿐 아니라 텍스트/과별 진행 상황을 바로 볼 수 있게 함께 내려준다.
  const textSourcesRaw =
    examPrepSheet.data.level === "고등" ? examPrepSheet.data.high.textSources : examPrepSheet.data.middle.textSources;
  const textSources = textSourcesRaw.map((t) => ({
    id: t.id,
    category: t.category,
    label: t.label,
    detail: t.detail,
    stepsDone: t.steps.filter((s) => s.done).length,
    stepsTotal: t.steps.length,
    vocabDone: t.vocab.filter((v) => v.done).length,
    vocabTotal: t.vocab.length,
  }));

  const examPrep = examPrepSheet.id
    ? {
        level: examPrepSheet.level,
        examTitle: examPrepSheet.examTitle,
        examRange: examPrepSheet.examRange,
        examDate: examPrepSheet.examDate,
        teachers: examPrepSheet.teachers,
        progress: examPrepSheet.progress,
        weakPoints: examPrepSheet.weakPoints,
        updatedAt: examPrepSheet.updatedAt,
        categories: computeCategoryBreakdown(examPrepSheet.data),
        textSources,
      }
    : null;

  return { progress, makeup, actions, counseling, inquiries, clinic, review, examPrep };
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
// three different ways (출석률/단어통과율/과제수행률 tabs) rather than
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
    vocabPass: number;
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
      vocabPass: 0,
      hwTotal: 0,
      hwIncomplete: 0,
      classId: getRelationIds(r, "반")[0] ?? null,
    };
    cur.attTotal += 1;
    if (getSelect(r, "출결") !== "결석") cur.attPresent += 1;
    const voc = getSelect(r, "단어테스트결과");
    if (voc && voc !== "미응시") {
      cur.vocabTotal += 1;
      if (voc === "통과") cur.vocabPass += 1;
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
    vocabPassRate: v.vocabTotal > 0 ? v.vocabPass / v.vocabTotal : null,
    homeworkRate: v.hwTotal > 0 ? (v.hwTotal - v.hwIncomplete) / v.hwTotal : null,
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

// 원장 대시보드용 — getMonthlyOutcomeBreakdown과 동일한 집계 로직을 한 날짜
// (기본: 오늘)로만 좁힌 것. 기존 함수는 건드리지 않고 나란히 추가한 읽기전용
// 헬퍼로, DB⑤일일기록 하나만 조회한다(쓰기 없음).
export async function getDailyOutcomeBreakdown(date: string) {
  const records = await queryAllPages({
    data_source_id: DB.DAILY_RECORD,
    filter: { property: "날짜", date: { equals: date } },
  });

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
  return { attendance, vocab, homework };
}

export type DailyOutcomeStudent = {
  studentId: string;
  studentName: string;
  school: string;
  grade: string | null;
  className: string;
  status?: string;
};

// 원장 대시보드 "오늘 결석"/"미완료 과제" 타일의 더보기 팝업용 — 이름까지
// 필요해서 집계 카운트만 내는 getDailyOutcomeBreakdown과는 별도로 둔다.
// getAbsenceReviewData와 달리 순수 조회만 하고 보강요청을 만들지 않는다.
export async function getDailyOutcomeDetail(date: string): Promise<{
  absentStudents: DailyOutcomeStudent[];
  incompleteHomeworkStudents: DailyOutcomeStudent[];
  vocabRetestStudents: DailyOutcomeStudent[];
  attendedStudents: DailyOutcomeStudent[];
}> {
  const [records, students, classes] = await Promise.all([
    queryAllPages({
      data_source_id: DB.DAILY_RECORD,
      filter: { property: "날짜", date: { equals: date } },
    }),
    searchStudents(""),
    listClasses(),
  ]);
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const classMap = new Map(classes.map((c) => [c.id, c]));

  function resolve(r: any): DailyOutcomeStudent | null {
    const studentId = getRelationIds(r, "학생")[0];
    if (!studentId) return null;
    const student = studentMap.get(studentId);
    const classId = getRelationIds(r, "반")[0];
    const cls = classId ? classMap.get(classId) : undefined;
    return {
      studentId,
      studentName: student?.name ?? "-",
      school: student?.school ?? "",
      grade: student?.grade ?? null,
      className: cls ? stripClassSuffix(cls.name) : "-",
    };
  }

  const absentStudents: DailyOutcomeStudent[] = [];
  const incompleteHomeworkStudents: DailyOutcomeStudent[] = [];
  const vocabRetestStudents: DailyOutcomeStudent[] = [];
  const attendedStudents: DailyOutcomeStudent[] = [];
  for (const r of records as any[]) {
    const status = getSelect(r, "출결");
    if (status === "결석") {
      const s = resolve(r);
      if (s) absentStudents.push(s);
    }
    if (status === "출석" || status === "지각") {
      const s = resolve(r);
      if (s) attendedStudents.push({ ...s, status });
    }
    if (!getCheckbox(r, "과제여부")) {
      const s = resolve(r);
      if (s) incompleteHomeworkStudents.push(s);
    }
    if (getSelect(r, "단어테스트결과") === "재시험") {
      const s = resolve(r);
      if (s) vocabRetestStudents.push(s);
    }
  }
  return { absentStudents, incompleteHomeworkStudents, vocabRetestStudents, attendedStudents };
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

export async function getTodaySchedule(today: string, viewerStaffId?: string) {
  const [alarmStudents, firstDayStudents, todoResults, counselingResults, inquiriesByDate, inquiriesByRange, names, classMap, staffMap] =
    await Promise.all([
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
      queryAllPages({
        data_source_id: DB.COUNSELING,
        filter: { property: "날짜", date: { equals: today } },
      }),
      queryAllPages({
        data_source_id: DB.ADMIN_INBOX,
        filter: { property: "날짜", date: { equals: today } },
      }),
      // 결석예정처럼 시작일~종료일로 걸쳐있는 문의는 시작일이 오늘이 아니어도
      // 오늘이 그 구간에 포함되면 "오늘의 일정"에 나와야 한다.
      queryAllPages({
        data_source_id: DB.ADMIN_INBOX,
        filter: {
          and: [
            { property: "날짜", date: { on_or_before: today } },
            { property: "종료일", date: { on_or_after: today } },
          ],
        },
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
      classTime: cls ? formatClassSchedule(cls.days, cls.time) : "",
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
          memo: getRichText(p, "메모"),
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

  const counseling = counselingResults.map((p: any) => {
    const studentId = getRelationIds(p, "학생")[0] ?? null;
    const brief = studentId ? studentBrief.get(studentId) : undefined;
    return {
      id: p.id,
      date: getDate(p, "날짜"),
      studentId,
      studentName: studentId ? names.get(studentId) ?? "-" : "-",
      school: brief?.school ?? "",
      grade: brief?.grade ?? null,
      gradeNum: brief?.gradeNum ?? "",
      counselor: getRichText(p, "상담자"),
      transcript: getRichText(p, "전사내용"),
      content: getRichText(p, "상담내용"),
      followUp: getRichText(p, "후속조치"),
      enteredBy: getRichText(p, "입력자"),
      status: brief?.status ?? null,
    };
  });

  const inquiryMap = new Map<string, any>();
  for (const p of [...inquiriesByDate, ...inquiriesByRange] as any[]) {
    const studentId = getRelationIds(p, "대상학생")[0] ?? null;
    const brief = studentId ? studentBrief.get(studentId) : undefined;
    inquiryMap.set(p.id, {
      id: p.id,
      date: getDate(p, "날짜"),
      endDate: getDate(p, "종료일"),
      studentId,
      studentName: studentId ? names.get(studentId) ?? "-" : "전체",
      school: brief?.school ?? "",
      grade: brief?.grade ?? null,
      gradeNum: brief?.gradeNum ?? "",
      type: getSelect(p, "입력유형"),
      content: getRichText(p, "내용"),
      done: getCheckbox(p, "처리완료"),
      owner: getRichText(p, "담당자"),
      enteredBy: getRichText(p, "입력자"),
      status: brief?.status ?? null,
    });
  }

  // 본인만 보는 개인 할일 — 같은 DB⑱를 쓰되 유형="개인할일" + 담당자=조회한
  // 본인으로 걸러낸다. viewerStaffId는 항상 세션에서 읽은 값만 받으므로(클라
  // 이언트가 다른 사람 id를 넘겨도 서버가 무시), 다른 직원의 목록이 섞여
  // 보일 일이 없다.
  const personalTodos = viewerStaffId
    ? (todoResults as any[])
        .filter((p) => getSelect(p, "유형") === "개인할일" && getRelationIds(p, "담당자").includes(viewerStaffId))
        .map((p) => ({ id: p.id, title: getTitle(p, "제목"), done: getCheckbox(p, "완료여부") }))
    : [];

  return {
    alarms,
    firstDays,
    newStudentEvents: withStudentInfo(byTypes(["신입생상담", "레벨체크"])),
    makeupClasses: withStudentInfo(byTypes(["보강"])),
    retests: withStudentInfo(byTypes(["재시"])),
    clinicTasks: withStudentInfo(byTypes(["클리닉"])),
    reviewTasks: withStudentInfo(byTypes(["복습"])),
    personalTodos,
    counseling,
    inquiries: Array.from(inquiryMap.values()),
  };
}

// ---- 개인 할일 (DB⑱, 유형=개인할일) ----
// 본인만 보이는 체크리스트 — 자연어 입력의 "/to do list" 명령이나 오늘의
// 일정 카드의 빠른등록에서 만든다.
export async function createPersonalTodo(input: { staffId: string; content: string; date: string }) {
  await notion.pages.create({
    parent: { data_source_id: DB.TODO } as any,
    properties: {
      제목: { title: [{ text: { content: input.content } }] },
      유형: { select: { name: "개인할일" } },
      담당자: { relation: [{ id: input.staffId }] },
      예정일: { date: { start: input.date } },
      완료여부: { checkbox: false },
      우선순위: { select: { name: "보통" } },
    } as any,
  });
}

export async function updatePersonalTodo(id: string, input: { content?: string; date?: string }) {
  const properties: any = {};
  if (input.content !== undefined) properties["제목"] = { title: [{ text: { content: input.content } }] };
  if (input.date) properties["예정일"] = { date: { start: input.date } };
  await notion.pages.update({ page_id: id, properties });
}

async function studentBriefMap(): Promise<
  Map<string, { school: string; grade: string | null; gradeNum: string; status: string | null }>
> {
  const students = await searchStudents("");
  return new Map(
    students.map((s) => [s.id, { school: s.school, grade: s.grade, gradeNum: gradeDigits(s.grade), status: s.status }])
  );
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
  perStudent: Record<
    string,
    { vocabFail: boolean; homeworkIncomplete: boolean; absent: boolean; late?: boolean; individualNotice?: string }
  >;
  briefingTexts?: Record<string, string>;
  // Students called up from a different class for a one-off individual
  // record (e.g. a makeup or guest attendee), in addition to the class's
  // own roster.
  extraStudentIds?: string[];
  // 학생 복습 자동화: 0/undefined면 생성하지 않고, N이면 오늘 배운 내용을
  // N일 뒤 "복습" 할일로 자동 예약해 "오늘의 일정"에 뜨게 한다.
  reviewDays?: number;
  // 같은 반을 같은 날 여러 선생님이 교시를 나눠 들어갈 때, 각 교시의 진도
  // 기록이 서로 덮어쓰지 않도록 구분하는 값("1교시"/"2교시" 등). 대부분의
  // 반(교시를 나누지 않는)은 비워두면 기존과 동일하게 동작한다.
  period?: string;
}) {
  const classPage: any = await notion.pages.retrieve({ page_id: input.classId });
  const className = getTitle(classPage, "반이름");
  const classRosterIds = getRelationIds(classPage, "소속학생");
  const studentIds = Array.from(new Set([...classRosterIds, ...(input.extraStudentIds ?? [])]));

  const progressPage = await notion.pages.create({
    parent: { data_source_id: DB.CLASS_PROGRESS } as any,
    properties: {
      제목: { title: [{ text: { content: `${input.date} ${className}${input.period ? ` ${input.period}` : ""} 진도` } }] },
      반: { relation: [{ id: input.classId }] },
      날짜: { date: { start: input.date } },
      수업과목: { multi_select: input.subjects.map((name) => ({ name })) },
      진도내용: { rich_text: [{ text: { content: input.progress } }] },
      과제내용: { rich_text: [{ text: { content: input.homework } }] },
      다음시간테스트: { rich_text: [{ text: { content: input.nextAssignment } }] },
      전달사항: { rich_text: [{ text: { content: input.notice } }] },
      ...(input.period ? { 교시: { select: { name: input.period } } } : {}),
    } as any,
  });

  const dailyRecordIds: string[] = [];
  const briefingIds: string[] = [];
  for (const studentId of studentIds) {
    const studentPage: any = await notion.pages.retrieve({ page_id: studentId });
    const studentName = getTitle(studentPage, "이름");
    const flags = input.perStudent[studentId] ?? { vocabFail: false, homeworkIncomplete: false, absent: false, late: false };

    const daily = await notion.pages.create({
      parent: { data_source_id: DB.DAILY_RECORD } as any,
      properties: {
        제목: { title: [{ text: { content: `${studentName} ${input.date}` } }] },
        학생: { relation: [{ id: studentId }] },
        반: { relation: [{ id: input.classId }] },
        날짜: { date: { start: input.date } },
        진도내용: { rich_text: [{ text: { content: input.progress } }] },
        출결: { select: { name: flags.absent ? "결석" : flags.late ? "지각" : "출석" } },
        과제여부: { checkbox: !flags.homeworkIncomplete },
        단어테스트결과: { select: { name: flags.vocabFail ? "재시험" : "통과" } },
        반별진도원본: { relation: [{ id: progressPage.id }] },
        비고: { rich_text: [{ text: { content: flags.individualNotice ?? "" } }] },
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
        absent: flags.absent,
        individualNotice: flags.individualNotice,
      });
    const briefing = await notion.pages.create({
      parent: { data_source_id: DB.BRIEFING } as any,
      properties: {
        제목: { title: [{ text: { content: `${studentName} 데일리브리핑 ${input.date}` } }] },
        학생: { relation: [{ id: studentId }] },
        날짜: { date: { start: input.date } },
        브리핑유형: { select: { name: !flags.absent && (flags.vocabFail || flags.homeworkIncomplete) ? "주의" : "전달사항" } },
        브리핑내용: { rich_text: [{ text: { content: briefingText } }] },
      } as any,
    });
    briefingIds.push(briefing.id);

    if (input.reviewDays && input.reviewDays > 0) {
      await notion.pages.create({
        parent: { data_source_id: DB.TODO } as any,
        properties: {
          제목: { title: [{ text: { content: `복습 - ${studentName}` } }] },
          유형: { select: { name: "복습" } },
          관련학생: { relation: [{ id: studentId }] },
          관련반: { relation: [{ id: input.classId }] },
          예정일: { date: { start: addDaysToDate(input.date, input.reviewDays) } },
          메모: { rich_text: [{ text: { content: input.progress } }] },
          완료여부: { checkbox: false },
          우선순위: { select: { name: "보통" } },
        } as any,
      });
    }
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
// period가 있으면 그 교시 기록만, 없으면(교시를 나누지 않는 반) 교시가
// 비어있는 기록만 찾는다 — 그래야 1교시/2교시로 나뉜 반의 기록이 서로
// 섞이지 않는다.
export async function getClassProgressForEdit(classId: string, date: string, period?: string) {
  const res = await notion.dataSources.query({
    data_source_id: DB.CLASS_PROGRESS,
    filter: {
      and: [
        { property: "반", relation: { contains: classId } },
        { property: "날짜", date: { equals: date } },
        period ? { property: "교시", select: { equals: period } } : { property: "교시", select: { is_empty: true } },
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
  const perStudent: Record<
    string,
    { absent: boolean; late: boolean; vocabFail: boolean; homeworkIncomplete: boolean; individualNotice: string }
  > = {};
  for (const dp of dailyRecords as any[]) {
    const studentId = getRelationIds(dp, "학생")[0];
    if (!studentId) continue;
    studentIds.push(studentId);
    perStudent[studentId] = {
      absent: getSelect(dp, "출결") === "결석",
      late: getSelect(dp, "출결") === "지각",
      vocabFail: getSelect(dp, "단어테스트결과") === "재시험",
      homeworkIncomplete: !getCheckbox(dp, "과제여부"),
      // DB④학생별일일기록의 기존 "비고" 필드를 그대로 재사용 — 새 Notion
      // 속성을 만들지 않고 학생별 개별 안내사항을 저장한다.
      individualNotice: getRichText(dp, "비고"),
    };
  }

  return {
    progressId: page.id,
    period: getSelect(page, "교시"),
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
// (mirrors createClassProgress's row-creation).
//
// subjects/progress/homework/nextAssignment/notice는 선택값이다 — 조교·행정이
// checkInAttendance로 출결/단어통과만 먼저 체크해둘 때는 이 필드들을 아예
// 넘기지 않아, 아직 비어있는(또는 담당교사가 이미 채워둔) 진도/과제 내용을
// 실수로 지우지 않는다. progress가 실제로 채워져 들어오면(=담당교사가 저장한
// 시점) 그 학생에게 아직 브리핑이 없는 경우에 한해 새로 생성한다 — 조교가
// 먼저 체크인해 브리핑 없이 레코드만 만들어진 경우를 보정하기 위함. 이미
// 브리핑이 있는 학생(기존처럼 교사가 처음부터 다 채워 저장한 경우, 또는 오타
// 수정 등으로 재저장하는 경우)은 중복 생성하지 않는다.
export async function updateClassProgress(input: {
  progressId: string;
  classId: string;
  date: string;
  subjects?: string[];
  progress?: string;
  homework?: string;
  nextAssignment?: string;
  notice?: string;
  perStudent: Record<
    string,
    { vocabFail: boolean; homeworkIncomplete: boolean; absent: boolean; late?: boolean; individualNotice?: string }
  >;
  extraStudentIds?: string[];
}) {
  const classPage: any = await notion.pages.retrieve({ page_id: input.classId });
  const className = getTitle(classPage, "반이름");
  const classRosterIds = getRelationIds(classPage, "소속학생");
  const studentIds = Array.from(new Set([...classRosterIds, ...(input.extraStudentIds ?? [])]));

  const progressPageProperties: any = { 반: { relation: [{ id: input.classId }] } };
  if (input.subjects !== undefined) progressPageProperties.수업과목 = { multi_select: input.subjects.map((name) => ({ name })) };
  if (input.progress !== undefined) progressPageProperties.진도내용 = { rich_text: [{ text: { content: input.progress } }] };
  if (input.homework !== undefined) progressPageProperties.과제내용 = { rich_text: [{ text: { content: input.homework } }] };
  if (input.nextAssignment !== undefined) progressPageProperties.다음시간테스트 = { rich_text: [{ text: { content: input.nextAssignment } }] };
  if (input.notice !== undefined) progressPageProperties.전달사항 = { rich_text: [{ text: { content: input.notice } }] };
  await notion.pages.update({ page_id: input.progressId, properties: progressPageProperties });

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
    const flags = input.perStudent[studentId] ?? { vocabFail: false, homeworkIncomplete: false, absent: false, late: false };
    const properties: any = {
      출결: { select: { name: flags.absent ? "결석" : flags.late ? "지각" : "출석" } },
      과제여부: { checkbox: !flags.homeworkIncomplete },
      단어테스트결과: { select: { name: flags.vocabFail ? "재시험" : "통과" } },
      비고: { rich_text: [{ text: { content: flags.individualNotice ?? "" } }] },
    };
    if (input.progress !== undefined) properties.진도내용 = { rich_text: [{ text: { content: input.progress } }] };
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
      properties: { 학생기록생성됨: { checkbox: true }, 생성된학생기록: { relation: allIds.map((id) => ({ id })) } } as any,
    });
  }

  if (input.progress !== undefined && input.progress.trim() !== "") {
    await Promise.all(
      studentIds.map(async (studentId) => {
        const existingBriefing = await notion.dataSources.query({
          data_source_id: DB.BRIEFING,
          filter: { and: [{ property: "학생", relation: { contains: studentId } }, { property: "날짜", date: { equals: input.date } }] },
          page_size: 1,
        });
        if (existingBriefing.results.length > 0) return;

        const studentPage: any = await notion.pages.retrieve({ page_id: studentId });
        const studentName = getTitle(studentPage, "이름");
        const flags = input.perStudent[studentId] ?? { vocabFail: false, homeworkIncomplete: false, absent: false, late: false };
        const briefingText = formatBriefingText({
          date: input.date,
          className,
          studentName,
          progress: input.progress!,
          homework: input.homework ?? "",
          nextAssignment: input.nextAssignment ?? "",
          notice: input.notice ?? "",
          vocabFail: flags.vocabFail,
          homeworkIncomplete: flags.homeworkIncomplete,
          absent: flags.absent,
          individualNotice: flags.individualNotice,
        });
        await notion.pages.create({
          parent: { data_source_id: DB.BRIEFING } as any,
          properties: {
            제목: { title: [{ text: { content: `${studentName} 데일리브리핑 ${input.date}` } }] },
            학생: { relation: [{ id: studentId }] },
            날짜: { date: { start: input.date } },
            브리핑유형: { select: { name: !flags.absent && (flags.vocabFail || flags.homeworkIncomplete) ? "주의" : "전달사항" } },
            브리핑내용: { rich_text: [{ text: { content: briefingText } }] },
          } as any,
        });
      })
    );
  }
}

// 조교·행정이 진도 내용 없이 결석/단어통과여부만 빠르게 체크하는 경로.
// 이미 그 반/날짜의 수업 기록(DB③)이 있으면 그 위에 출결/단어테스트결과만
// 얹어 업데이트하고(updateClassProgress에 진도 관련 필드는 아예 넘기지 않아
// 기존 내용을 지우지 않음), 없으면 진도/과제가 빈 채로 골격만 만들어둔다 —
// 담당교사가 나중에 같은 반/날짜로 "오늘 수업 기록"을 열면 그대로 불러와
// 진도를 채워 저장할 수 있고(getClassProgressForEdit), 그 시점에 브리핑이
// 생성된다(updateClassProgress의 브리핑 보정 로직).
export async function checkInAttendance(input: {
  classId: string;
  date: string;
  perStudent: Record<string, { vocabFail: boolean; homeworkIncomplete: boolean; absent: boolean; late?: boolean }>;
  extraStudentIds?: string[];
  // createClassProgress 참고 — 같은 반이 교시로 나뉜 경우에만 지정.
  period?: string;
}): Promise<{ progressId: string; created: boolean }> {
  const existing = await getClassProgressForEdit(input.classId, input.date, input.period);
  if (existing) {
    await updateClassProgress({
      progressId: existing.progressId,
      classId: input.classId,
      date: input.date,
      perStudent: input.perStudent,
      extraStudentIds: input.extraStudentIds,
    });
    return { progressId: existing.progressId, created: false };
  }

  const classPage: any = await notion.pages.retrieve({ page_id: input.classId });
  const className = getTitle(classPage, "반이름");
  const classRosterIds = getRelationIds(classPage, "소속학생");
  const studentIds = Array.from(new Set([...classRosterIds, ...(input.extraStudentIds ?? [])]));

  const progressPage = await notion.pages.create({
    parent: { data_source_id: DB.CLASS_PROGRESS } as any,
    properties: {
      제목: { title: [{ text: { content: `${input.date} ${className}${input.period ? ` ${input.period}` : ""} 진도` } }] },
      반: { relation: [{ id: input.classId }] },
      날짜: { date: { start: input.date } },
      ...(input.period ? { 교시: { select: { name: input.period } } } : {}),
    } as any,
  });

  const dailyRecordIds: string[] = [];
  for (const studentId of studentIds) {
    const studentPage: any = await notion.pages.retrieve({ page_id: studentId });
    const studentName = getTitle(studentPage, "이름");
    const flags = input.perStudent[studentId] ?? { vocabFail: false, homeworkIncomplete: false, absent: false, late: false };
    const daily = await notion.pages.create({
      parent: { data_source_id: DB.DAILY_RECORD } as any,
      properties: {
        제목: { title: [{ text: { content: `${studentName} ${input.date}` } }] },
        학생: { relation: [{ id: studentId }] },
        반: { relation: [{ id: input.classId }] },
        날짜: { date: { start: input.date } },
        출결: { select: { name: flags.absent ? "결석" : flags.late ? "지각" : "출석" } },
        과제여부: { checkbox: !flags.homeworkIncomplete },
        단어테스트결과: { select: { name: flags.vocabFail ? "재시험" : "통과" } },
        반별진도원본: { relation: [{ id: progressPage.id }] },
      } as any,
    });
    dailyRecordIds.push(daily.id);
  }

  await notion.pages.update({
    page_id: progressPage.id,
    properties: { 학생기록생성됨: { checkbox: true }, 생성된학생기록: { relation: dailyRecordIds.map((id) => ({ id })) } } as any,
  });

  return { progressId: progressPage.id, created: true };
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

// 원장 대시보드 "긴급상담" 카드용 — 입력유형=긴급상담요청 중 아직 처리 안 된
// 것만, 전체 이력을 훑는 getRecentAdminInbox와 달리 날짜 무관하게(급한 건은
// 하루만 보여주면 놓칠 수 있어) 필터링해서 가져온다.
export async function getUrgentCounselingRequests() {
  const [results, names, briefs] = await Promise.all([
    queryAllPages({
      data_source_id: DB.ADMIN_INBOX,
      filter: {
        and: [
          { property: "입력유형", select: { equals: "긴급상담요청" } },
          { property: "처리완료", checkbox: { equals: false } },
        ],
      },
      sorts: [{ property: "날짜", direction: "descending" }],
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
      studentId,
      studentName: firstRelationName(p, "대상학생", names),
      school: brief?.school ?? "",
      grade: brief?.grade ?? null,
      content: getRichText(p, "내용"),
      owner: getRichText(p, "담당자"),
      enteredBy: getRichText(p, "입력자"),
    };
  });
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
      owner: getRichText(p, "담당자"),
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

export async function deleteCounselingEntry(id: string) {
  await notion.pages.update({ page_id: id, archived: true });
}

export async function updateAdminInboxEntry(
  id: string,
  input: { type?: string; content?: string; startDate?: string; endDate?: string; owner?: string; done?: boolean }
) {
  const properties: any = {};
  if (input.type) properties["입력유형"] = { select: { name: input.type } };
  if (input.content !== undefined) properties["내용"] = { rich_text: [{ text: { content: input.content } }] };
  if (input.startDate) properties["날짜"] = { date: { start: input.startDate } };
  if (input.endDate !== undefined) {
    properties["종료일"] = input.endDate ? { date: { start: input.endDate } } : { date: null };
  }
  if (input.owner !== undefined) properties["담당자"] = { rich_text: [{ text: { content: input.owner } }] };
  if (input.done !== undefined) properties["처리완료"] = { checkbox: input.done };
  await notion.pages.update({ page_id: id, properties });
}

export async function deleteAdminInboxEntry(id: string) {
  await notion.pages.update({ page_id: id, archived: true });
}

// "결석예정"으로 등록된 날짜에 이미 저장된 "오늘 수업 기록"(DB⑥ 일별기록)이
// 있으면, 그 학생의 출결을 결석으로 맞춰 자연어/수동 입력 어느 쪽으로 결석을
// 알려도 실제 출결 통계에 곧바로 반영되게 한다. 아직 그 반의 수업 기록 자체가
// 없는 날짜(수업 전에 미리 알린 경우)는 업데이트할 대상이 없으므로 그냥 지나가고,
// 대신 ClassRecordForm이 결석예정 명단을 조회해 체크박스 기본값으로 반영한다
// (getPlannedAbsentStudentIds 참고).
async function syncAttendanceForPlannedAbsence(studentId: string, date: string) {
  const records = await queryAllPages({
    data_source_id: DB.DAILY_RECORD,
    filter: {
      and: [
        { property: "학생", relation: { contains: studentId } },
        { property: "날짜", date: { equals: date } },
      ],
    },
  });
  await Promise.all(
    (records as any[]).map((r) =>
      notion.pages.update({ page_id: r.id, properties: { 출결: { select: { name: "결석" } } } as any })
    )
  );
}

// ClassRecordForm이 아직 저장된 적 없는 반/날짜를 열었을 때도 결석 체크박스를
// 미리 체크해 보여줄 수 있도록, 주어진 날짜에 "결석예정"으로 등록된 학생 id
// 목록을 돌려준다.
export async function getPlannedAbsentStudentIds(date: string): Promise<string[]> {
  const [byDate, byRange] = await Promise.all([
    queryAllPages({
      data_source_id: DB.ADMIN_INBOX,
      filter: {
        and: [
          { property: "입력유형", select: { equals: "결석예정" } },
          { property: "날짜", date: { equals: date } },
        ],
      },
    }),
    queryAllPages({
      data_source_id: DB.ADMIN_INBOX,
      filter: {
        and: [
          { property: "입력유형", select: { equals: "결석예정" } },
          { property: "날짜", date: { on_or_before: date } },
          { property: "종료일", date: { on_or_after: date } },
        ],
      },
    }),
  ]);
  const ids = new Set<string>();
  for (const p of [...byDate, ...byRange] as any[]) {
    const sid = getRelationIds(p, "대상학생")[0];
    if (sid) ids.add(sid);
  }
  return Array.from(ids);
}

export async function createAdminInboxEntry(input: {
  type: string;
  studentId: string | null;
  content: string;
  startDate?: string;
  endDate?: string;
  enteredBy?: string;
  owner?: string;
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
      ...(input.owner ? { 담당자: { rich_text: [{ text: { content: input.owner } }] } } : {}),
    } as any,
  });

  if (input.type === "결석예정" && input.studentId) {
    const endDate = input.endDate || startDate;
    // 날짜 오입력으로 범위가 지나치게 넓어지는 경우에 대비한 안전장치 —
    // 결석예정은 통상 며칠 내 기간이라 90일이면 충분하다.
    for (let d = startDate, i = 0; d <= endDate && i < 90; d = addDaysToDate(d, 1), i++) {
      await syncAttendanceForPlannedAbsence(input.studentId, d);
    }
  }
}

// 등원일이 오늘이거나 이미 지났는데 상태가 아직 대기생이면 그 자리에서
// 바로 재원으로 전환한다. 매일 새벽 크론(promoteWaitlistedStudents)이
// 놓친 학생을 다음날까지 기다리지 않도록, 등원일을 입력/수정하는 모든
// 경로(학생등록, 학생정보수정, 오늘의 일정 "신입생 첫등원" 수정)에서
// 즉시 반영한다. 상태를 캐시 없이 매번 다시 읽는 이유: 이 함수를 부르는
// 쪽은 보통 상태를 같이 넘기지 않으므로(등원일만 입력) 최신값을 확인해야
// "이미 재원/휴원/퇴원인 학생을 실수로 되돌리지" 않는다.
async function autoPromoteFromEnrolledAt(studentId: string, enrolledAt: string | undefined) {
  if (!enrolledAt || enrolledAt > todayKST()) return;
  const page: any = await notion.pages.retrieve({ page_id: studentId });
  if (getSelect(page, "상태") === "대기생") {
    await notion.pages.update({ page_id: studentId, properties: { 상태: { select: { name: "재원" } } } as any });
  }
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
  await autoPromoteFromEnrolledAt(input.studentId, input.enrolledAt);

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
  // 대기생으로 등록하면서 등원일을 오늘 이전/오늘로 잡으면(예: 지난주부터
  // 다니기 시작한 학생을 뒤늦게 입력하는 경우), 굳이 대기생을 거쳤다가
  // 크론을 기다릴 필요 없이 바로 재원으로 저장한다.
  const effectiveStatus =
    input.status === "대기생" && input.enrolledAt && input.enrolledAt <= todayKST() ? "재원" : input.status;
  const page = await notion.pages.create({
    parent: { data_source_id: DB.STUDENT } as any,
    properties: {
      이름: { title: [{ text: { content: input.name } }] },
      상태: { select: { name: effectiveStatus } },
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

// Full-record edit for an existing student (학생등록 화면에서 검색으로 불러온
// 뒤 수정하는 경로) — createStudent와 달리 각 필드는 명시적으로 넘어온
// 것만 갱신하고, 빈 문자열/빈 배열도 "지운다"는 의미로 그대로 반영한다.
export async function updateStudentFull(
  studentId: string,
  input: {
    name?: string;
    school?: string;
    grade?: string;
    status?: string;
    phone?: string;
    parentPhone?: string;
    registeredAt?: string;
    enrolledAt?: string;
    tuitionDay?: number;
    learningLevel?: string;
    // Lv를 학년 기본값에서 벗어나게 직접 지정할 때만 넘긴다. null이면
    // override를 지워 다시 학년 기본값을 쓰게 한다(effectiveLevel 참고).
    levelOverride?: number | null;
    classIds?: string[];
    memo?: string;
  }
) {
  const properties: any = {};
  if (input.name) properties["이름"] = { title: [{ text: { content: input.name } }] };
  if (input.school !== undefined) properties["학교"] = { rich_text: [{ text: { content: input.school } }] };
  if (input.grade !== undefined) properties["학년"] = input.grade ? { select: { name: input.grade } } : { select: null };
  if (input.status) properties["상태"] = { select: { name: input.status } };
  if (input.phone !== undefined) properties["연락처"] = { phone_number: input.phone || null };
  if (input.parentPhone !== undefined) properties["학부모연락처"] = { phone_number: input.parentPhone || null };
  if (input.registeredAt !== undefined) {
    properties["등록일"] = input.registeredAt ? { date: { start: input.registeredAt } } : { date: null };
  }
  if (input.enrolledAt !== undefined) {
    properties["등원일"] = input.enrolledAt ? { date: { start: input.enrolledAt } } : { date: null };
  }
  if (input.tuitionDay !== undefined) properties["회비일"] = { number: input.tuitionDay };
  if (input.learningLevel !== undefined) {
    properties["학습레벨"] = { rich_text: [{ text: { content: input.learningLevel } }] };
  }
  if (input.levelOverride !== undefined) {
    properties["레벨Lv"] = { number: input.levelOverride };
  }
  if (input.classIds !== undefined) properties["소속반"] = { relation: input.classIds.map((id) => ({ id })) };
  if (input.memo !== undefined) properties["메모"] = { rich_text: [{ text: { content: input.memo } }] };
  await notion.pages.update({ page_id: studentId, properties });

  // status를 이 호출에서 명시적으로 같이 바꾸는 중이면(예: 관리자가 직접
  // 휴원/퇴원으로 바꾸는 경우) 그 판단을 그대로 존중하고 자동 승격을 하지
  // 않는다 — enrolledAt만 바뀌었을 때만(= 등원일 수정/반 이동 등) 대기생
  // 여부를 확인해 자동 전환한다.
  if (input.status === undefined) {
    await autoPromoteFromEnrolledAt(studentId, input.enrolledAt);
  }
}

// 대기생을 등원일에 맞춰 자동으로 재원 전환 — 매일 새벽 크론(app/api/cron/
// promote-waitlist)이 호출한다. "신입생" 표시는 별도 상태값이 아니라
// StudentTable의 isNew 배지(등원일 기준 30일 이내)가 맡고 있으므로, 여기서는
// 상태만 재원으로 바꿔주면 등원일 당일부터 그 배지가 자동으로 함께 뜬다.
export async function promoteWaitlistedStudents(today: string): Promise<{ id: string; name: string }[]> {
  const results = await queryAllPages({
    data_source_id: DB.STUDENT,
    filter: {
      and: [
        { property: "상태", select: { equals: "대기생" } },
        { property: "등원일", date: { on_or_before: today } },
        { property: "등원일", date: { is_not_empty: true } },
      ],
    },
  });
  const promoted: { id: string; name: string }[] = [];
  for (const p of results as any[]) {
    await notion.pages.update({ page_id: p.id, properties: { 상태: { select: { name: "재원" } } } as any });
    promoted.push({ id: p.id, name: getTitle(p, "이름") });
  }
  return promoted;
}

// 학생등록 시 동명이인 중복 등록을 막는 데 쓴다 — 이름이 정확히 같은 학생이
// 이미 있는지(재원/퇴원 등 상태와 무관하게) 확인한다.
export async function findStudentByName(name: string): Promise<{ id: string; name: string } | null> {
  const res = await notion.dataSources.query({
    data_source_id: DB.STUDENT,
    filter: { property: "이름", title: { equals: name } },
    page_size: 1,
  });
  const page = res.results[0] as any;
  return page ? { id: page.id, name: getTitle(page, "이름") } : null;
}

export async function findStaffIdByName(name: string): Promise<string | null> {
  const res = await notion.dataSources.query({
    data_source_id: DB.STAFF,
    filter: { property: "이름", title: { equals: name } },
    page_size: 1,
  });
  return (res.results[0] as any)?.id ?? null;
}

export async function createScheduleEntry(input: {
  type: "보강" | "재시" | "신입생상담" | "레벨체크" | "클리닉";
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
      ...(input.note ? { 메모: { rich_text: [{ text: { content: input.note } }] } } : {}),
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
  input: { date?: string; time?: string; ownerName?: string; note?: string; title?: string }
) {
  const properties: any = {};
  if (input.date) properties["예정일"] = { date: { start: input.date } };
  if (input.time !== undefined) properties["시간"] = { rich_text: [{ text: { content: input.time } }] };
  if (input.note !== undefined) properties["메모"] = { rich_text: [{ text: { content: input.note } }] };
  if (input.title !== undefined) properties["제목"] = { title: [{ text: { content: input.title } }] };
  if (input.ownerName !== undefined) {
    const ownerId = input.ownerName ? await findStaffIdByName(input.ownerName) : null;
    // 이름이 목록과 정확히 일치하지 않으면(오타, 드롭다운을 못 고르고 텍스트만
    // 남은 경우 등) 조용히 "담당자 없음"으로 저장하지 않고 여기서 걸러
    // 알려준다 — 예전에는 이 경우 그냥 relation을 비워 저장해, 사용자에게는
    // "지정했는데 처리 후에도 계속 미지정으로 남는" 원인 모를 실패로 보였다.
    if (input.ownerName && !ownerId) {
      throw new Error(`"${input.ownerName}" 이름을 직원 목록에서 찾을 수 없습니다. 검색 결과에서 선택해주세요.`);
    }
    properties["담당자"] = { relation: ownerId ? [{ id: ownerId }] : [] };
  }
  await notion.pages.update({ page_id: id, properties });
}

// 학생별 전체기록(StudentHistoryModal)에서 보강/조치사항/복습 이력을 지울 때
// 쓰인다 — 삭제는 원장만 가능(권한 확인은 라우트에서).
// 조치사항(DB⑱) 이력 하나를 지울 때, 그게 학생 마스터(DB②)의 "현재 조치"
// 상태와 같은 내용이면("오늘의 일정 > 학습레벨/조치사항"에 그대로 뜨는 값)
// 그 현재상태도 같이 비워서 두 화면이 따로 놀지 않게 한다. 다른 유형
// (보강/복습)은 이 매칭 대상이 아니라 그냥 지운다.
export async function deleteScheduleEntry(id: string) {
  const page: any = await notion.pages.retrieve({ page_id: id });
  if (getSelect(page, "유형") === "조치사항") {
    const content = getTitle(page, "제목");
    const studentId = getRelationIds(page, "관련학생")[0];
    if (studentId && content) {
      const studentPage: any = await notion.pages.retrieve({ page_id: studentId });
      if (getRichText(studentPage, "조치") === content) {
        await notion.pages.update({
          page_id: studentId,
          properties: { 조치: { rich_text: [] }, 조치담당자: { rich_text: [] }, 조치알람일: { date: null } },
        });
      }
    }
  }
  await notion.pages.update({ page_id: id, archived: true });
}

// "오늘의 일정 > 학습레벨/조치사항"에서 알람을 지울 때 — 학생 마스터의
// 현재상태를 비우고, 같은 내용으로 남아있는 DB⑱ 조치사항 이력도 함께
// archive해 전체기록의 "조치사항 이력"에 죽은 기록이 남지 않게 한다.
export async function deleteStudentActionAlarm(studentId: string) {
  const studentPage: any = await notion.pages.retrieve({ page_id: studentId });
  const currentAction = getRichText(studentPage, "조치");
  await notion.pages.update({
    page_id: studentId,
    properties: { 조치: { rich_text: [] }, 조치담당자: { rich_text: [] }, 조치알람일: { date: null } },
  });
  if (currentAction) {
    const matches = await queryAllPages({
      data_source_id: DB.TODO,
      filter: {
        and: [
          { property: "유형", select: { equals: "조치사항" } },
          { property: "관련학생", relation: { contains: studentId } },
          { property: "제목", title: { equals: currentAction } },
        ],
      },
    });
    await Promise.all(matches.map((m: any) => notion.pages.update({ page_id: m.id, archived: true })));
  }
}

// DB⑥ 일별기록의 학생별 행 하나를 지운다. 반 전체 진도(반별진도원본)는
// 건드리지 않으므로 같은 반 다른 학생의 기록에는 영향이 없다 — 삭제는
// 원장만 가능(권한 확인은 라우트에서).
export async function deleteDailyRecordEntry(id: string) {
  await notion.pages.update({ page_id: id, archived: true });
}

// ---- 조교 클리닉 (DB⑮) ----
// 조교는 정규수업이 아니라 강사를 도와 학생을 1:1~1:다수로 코칭하는 "클리닉"
// 시간을 운영한다. 이 섹션은 그 세션 기록(누구를, 무엇을, 다음엔 뭘 준비할지)과
// 조교 개인의 "오늘 할 일 / 다음 준비사항" 브리핑, 담당강사의 점검 기능을 담당한다.

export async function createClinicRecord(input: {
  assistantId: string;
  studentIds: string[];
  teacherId?: string;
  date: string;
  content: string;
  nextPrep: string;
  relatedTaskId?: string;
}) {
  // 학생 이름은 학생마다 notion.pages.retrieve를 개별 호출하지 않고
  // studentNameMap()(전체 학생을 한 번의 쿼리로 조회)에서 찾는다 — 조교가
  // "담당반 전체 추가"로 학생을 한 번에 여러 명(10명 이상) 담아 저장하면
  // 개별 retrieve가 그 수만큼 동시에 Notion API를 두드려 레이트리밋(429)에
  // 걸리기 쉬웠고, 그 예외가 라우트에서 잡히지 않아 "네트워크 오류"로 보였다.
  const [assistantPage, names] = await Promise.all([
    notion.pages.retrieve({ page_id: input.assistantId }),
    studentNameMap(),
  ]);
  const assistantName = getTitle(assistantPage as any, "이름");
  const studentNamesJoined = input.studentIds.map((id) => names.get(id) ?? "-").join(", ");
  await notion.pages.create({
    parent: { data_source_id: DB.CLINIC } as any,
    properties: {
      제목: {
        title: [
          { text: { content: `${assistantName} 클리닉 ${input.date}${studentNamesJoined ? " - " + studentNamesJoined : ""}` } },
        ],
      },
      조교: { relation: [{ id: input.assistantId }] },
      ...(input.studentIds.length > 0 ? { 담당학생: { relation: input.studentIds.map((id) => ({ id })) } } : {}),
      ...(input.teacherId ? { 담당강사: { relation: [{ id: input.teacherId }] } } : {}),
      ...(input.relatedTaskId ? { 관련업무: { relation: [{ id: input.relatedTaskId }] } } : {}),
      날짜: { date: { start: input.date } },
      진행내용: { rich_text: [{ text: { content: input.content } }] },
      ...(input.nextPrep ? { 다음준비사항: { rich_text: [{ text: { content: input.nextPrep } }] } } : {}),
      확인완료: { checkbox: false },
    } as any,
  });
  // 지시받은 할일을 보고로 연결했으면, 지시자가 "완료여부"만 보고도 이행됐다는
  // 걸 바로 알 수 있게 그 할일을 자동으로 완료 처리한다. 지시사항(메모)
  // 자체는 건드리지 않는다 — 원본이 남아 있어야 지시-보고 비교가 가능하다.
  if (input.relatedTaskId) {
    await completeScheduleEntry(input.relatedTaskId);
  }
}

export async function updateClinicRecord(
  id: string,
  input: { checked?: boolean; content?: string; nextPrep?: string }
) {
  const properties: any = {};
  if (input.checked !== undefined) properties["확인완료"] = { checkbox: input.checked };
  if (input.content !== undefined) properties["진행내용"] = { rich_text: [{ text: { content: input.content } }] };
  if (input.nextPrep !== undefined) properties["다음준비사항"] = { rich_text: [{ text: { content: input.nextPrep } }] };
  await notion.pages.update({ page_id: id, properties });
}

export async function deleteClinicRecord(id: string) {
  await notion.pages.update({ page_id: id, archived: true });
}

// "출근했을 때 오늘 뭘 해야 하는지" — 담당자(조교)로 지정된 오늘자 할일.
// "다음 준비사항" — 본인이 직전 클리닉 기록에 남긴 다음준비사항을 학생별로
// 최신 것만 모아서 보여준다(같은 학생을 여러 번 봤으면 가장 최근 메모만 유효).
export async function getAssistantBrief(assistantId: string, date: string) {
  const [todayTodos, recentClinicRecords, names, classes] = await Promise.all([
    queryAllPages({
      data_source_id: DB.TODO,
      filter: {
        and: [
          { property: "담당자", relation: { contains: assistantId } },
          { property: "예정일", date: { equals: date } },
        ],
      },
    }),
    queryAllPages({
      data_source_id: DB.CLINIC,
      filter: { property: "조교", relation: { contains: assistantId } },
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    }),
    studentNameMap(),
    listClasses(),
  ]);

  const myClasses = classes
    .filter((c) => c.assistantIds.includes(assistantId))
    .map((c) => ({
      id: c.id,
      name: stripClassSuffix(c.name),
      students: c.studentIds.map((id) => ({ id, name: names.get(id) ?? "-" })),
    }));

  const todayTasks = todayTodos
    .map((p: any) => ({
      id: p.id,
      title: getTitle(p, "제목"),
      type: getSelect(p, "유형"),
      time: getRichText(p, "시간"),
      studentId: getRelationIds(p, "관련학생")[0] ?? null,
      studentName: firstRelationName(p, "관련학생", names),
      memo: getRichText(p, "메모"),
      done: getCheckbox(p, "완료여부"),
    }))
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  const prepByStudent = new Map<string, { studentName: string; date: string | null; content: string }>();
  for (const p of recentClinicRecords as any[]) {
    const nextPrep = getRichText(p, "다음준비사항");
    if (!nextPrep) continue;
    const recordDate = getDate(p, "날짜");
    for (const sid of getRelationIds(p, "담당학생")) {
      if (prepByStudent.has(sid)) continue; // sorted desc, so first hit per student is the latest
      prepByStudent.set(sid, { studentName: names.get(sid) ?? "-", date: recordDate, content: nextPrep });
    }
  }

  return {
    todayTasks,
    upcomingPrep: Array.from(prepByStudent.values()),
    myClasses,
    recentClinic: recentClinicRecords.slice(0, 5).map((p: any) => ({
      id: p.id,
      date: getDate(p, "날짜"),
      studentNames: getRelationIds(p, "담당학생").map((id) => names.get(id) ?? "-"),
      content: getRichText(p, "진행내용"),
      nextPrep: getRichText(p, "다음준비사항"),
    })),
  };
}

// 조교 본인의 클리닉 기록을 날짜로 검색 — getAssistantBrief의 "최근 5건"에는
// 없는 지나간 날짜의 기록도 조교 스스로 찾아서 고칠 수 있게 한다.
export async function getAssistantClinicRecordsByDate(assistantId: string, date: string) {
  const [records, names] = await Promise.all([
    queryAllPages({
      data_source_id: DB.CLINIC,
      filter: {
        and: [
          { property: "조교", relation: { contains: assistantId } },
          { property: "날짜", date: { equals: date } },
        ],
      },
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    }),
    studentNameMap(),
  ]);
  return records.map((p: any) => ({
    id: p.id,
    date: getDate(p, "날짜"),
    studentNames: getRelationIds(p, "담당학생").map((id) => names.get(id) ?? "-"),
    content: getRichText(p, "진행내용"),
    nextPrep: getRichText(p, "다음준비사항"),
  }));
}

// 원장 대시보드 "조교 클리닉" 카드용 — 특정 날짜에 조교들이 실제로 작성한
// 클리닉 기록(진행내용/다음준비사항)을 전체 조교 대상으로 조회한다.
// getAssistantClinicRecordsByDate와 달리 조교 한 명으로 필터하지 않고,
// getRecentClinicRecords와 달리 날짜로 걸러서 전체 이력을 다 훑지 않는다.
export async function getClinicRecordsByDate(date: string) {
  const [records, staffMap, names] = await Promise.all([
    queryAllPages({
      data_source_id: DB.CLINIC,
      filter: { property: "날짜", date: { equals: date } },
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    }),
    staffNameMap(),
    studentNameMap(),
  ]);
  return records.map((p: any) => ({
    id: p.id,
    date: getDate(p, "날짜"),
    assistantName: firstRelationName(p, "조교", staffMap),
    studentNames: getRelationIds(p, "담당학생").map((id) => names.get(id) ?? "-"),
    content: getRichText(p, "진행내용"),
    nextPrep: getRichText(p, "다음준비사항"),
    checked: getCheckbox(p, "확인완료"),
  }));
}

// 담당강사/원장/행정이 조교들의 클리닉 활동 전체를 훑어보고 확인 체크하는 용도.
export async function getRecentClinicRecords() {
  const [results, staffMap, studentNames] = await Promise.all([
    queryAllPages({
      data_source_id: DB.CLINIC,
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    }),
    staffNameMap(),
    studentNameMap(),
  ]);
  return results.map((p: any) => ({
    id: p.id,
    date: getDate(p, "날짜"),
    assistantName: firstRelationName(p, "조교", staffMap),
    teacherName: firstRelationName(p, "담당강사", staffMap),
    studentNames: getRelationIds(p, "담당학생").map((id) => studentNames.get(id) ?? "-"),
    content: getRichText(p, "진행내용"),
    nextPrep: getRichText(p, "다음준비사항"),
    checked: getCheckbox(p, "확인완료"),
  }));
}

// 강사/원장/행정이 "내가 지시한 클리닉이 실제로 이행됐는지"를 확인하는 뷰.
// DB⑱할일관리(유형=클리닉)의 지시사항(메모)은 조교가 덮어쓰지 않으므로 그대로
// 유지되고, 조교가 "클리닉 기록 작성"에서 이 할일과 연결해 남긴 보고는
// DUAL relation의 역방향 프로퍼티("클리닉보고")로 같은 페이지에서 바로 읽힌다.
export async function getClinicCompliance(sinceDays = 14) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const tasks = await queryAllPages({
    data_source_id: DB.TODO,
    filter: {
      and: [
        { property: "유형", select: { equals: "클리닉" } },
        { property: "예정일", date: { on_or_after: since } },
      ],
    },
    sorts: [{ property: "예정일", direction: "descending" }],
  });
  const reportIds = Array.from(
    new Set(tasks.flatMap((p: any) => getRelationIds(p, "클리닉보고")))
  );
  const [names, staffMap, reportPages] = await Promise.all([
    studentNameMap(),
    staffNameMap(),
    Promise.all(reportIds.map((id) => notion.pages.retrieve({ page_id: id }))),
  ]);
  const reportById = new Map(
    reportPages.map((p: any) => [
      p.id,
      { content: getRichText(p, "진행내용"), nextPrep: getRichText(p, "다음준비사항") },
    ])
  );
  const today = todayKST();
  return tasks.map((p: any) => {
    const studentId = getRelationIds(p, "관련학생")[0];
    const ownerId = getRelationIds(p, "담당자")[0];
    const reportId = getRelationIds(p, "클리닉보고")[0];
    const date = getDate(p, "예정일");
    const done = getCheckbox(p, "완료여부");
    return {
      id: p.id,
      date,
      studentName: studentId ? names.get(studentId) ?? "-" : "-",
      assistant: ownerId ? staffMap.get(ownerId) ?? "-" : "-",
      instruction: getRichText(p, "메모"),
      done,
      report: reportId ? reportById.get(reportId) ?? null : null,
      overdue: !done && !!date && date < today,
    };
  });
}

// "누락된 학생관리" 파악용 — 재원생 중 최근 N일간 클리닉 케어(자율 기록
// DB⑮ 또는 지시받아 완료한 DB⑱ 클리닉)가 전혀 없는 학생을 찾는다. 미이행
// 지시(getClinicCompliance의 overdue)는 "지시했는데 안 함"이고, 이건 그보다
// 넓은 "아예 아무도 이 학생을 안 챙겼다"를 잡기 위한 것이라 별도로 둔다.
// 출결/과제/상담 등 클리닉 이외의 케어는 범위 밖 — 필요하면 추후 확장.
export async function getClinicCoverageGaps(sinceDays = 14) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [activeStudents, recentRecords, recentTasks, classById] = await Promise.all([
    queryAllPages({
      data_source_id: DB.STUDENT,
      filter: { property: "상태", select: { equals: "재원" } },
    }),
    queryAllPages({
      data_source_id: DB.CLINIC,
      filter: { property: "날짜", date: { on_or_after: since } },
    }),
    queryAllPages({
      data_source_id: DB.TODO,
      filter: {
        and: [
          { property: "유형", select: { equals: "클리닉" } },
          { property: "완료여부", checkbox: { equals: true } },
          { property: "예정일", date: { on_or_after: since } },
        ],
      },
    }),
    classNameMap(),
  ]);

  const coveredIds = new Set<string>();
  for (const p of recentRecords as any[]) {
    for (const id of getRelationIds(p, "담당학생")) coveredIds.add(id);
  }
  for (const p of recentTasks as any[]) {
    for (const id of getRelationIds(p, "관련학생")) coveredIds.add(id);
  }

  return activeStudents
    .map((p: any) => ({
      id: p.id,
      name: getTitle(p, "이름"),
      school: getRichText(p, "학교"),
      grade: getSelect(p, "학년"),
      classNames: getRelationIds(p, "소속반").map((id) => classById.get(id) ?? "알수없음"),
    }))
    .filter((s) => !coveredIds.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name));
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

// ---- 교재·시험자료 제작관리 (DB⑥) ----
// 교사가 요청 → 담당자가 작업률/원본파일을 채워가는 흐름. 행정실(DB⑭)처럼
// 전체 이력을 검색할 수 있어야 하고, 오늘의 일정에는 마감일 기준으로 노출된다.

export type MaterialTask = {
  id: string;
  title: string;
  requesterName: string;
  ownerName: string;
  content: string;
  progress: number;
  status: string;
  dueDate: string | null;
  fileLocation: string | null;
  files: { name: string; url: string }[];
};

function toMaterialTask(p: any, staffMap: Map<string, string>): MaterialTask {
  const requesterId = getRelationIds(p, "요청자")[0];
  const ownerId = getRelationIds(p, "담당자")[0];
  return {
    id: p.id,
    title: getTitle(p, "제목"),
    requesterName: requesterId ? staffMap.get(requesterId) ?? "-" : "-",
    ownerName: ownerId ? staffMap.get(ownerId) ?? "-" : "-",
    content: getRichText(p, "작업내용"),
    progress: getNumber(p, "작업률") ?? 0,
    status: getSelect(p, "상태") ?? "요청됨",
    dueDate: getDate(p, "마감일"),
    fileLocation: getUrl(p, "파일저장위치"),
    files: getFiles(p, "원본파일"),
  };
}

// 전체보기(행정실과 동일한 RecentListCard 재사용)용 — 마감일이 가까운 순.
export async function listMaterialTasks(): Promise<MaterialTask[]> {
  const [results, staffMap] = await Promise.all([
    queryAllPages({ data_source_id: DB.MATERIAL }),
    staffNameMap(),
  ]);
  return results
    .map((p: any) => toMaterialTask(p, staffMap))
    .sort((a, b) => (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99"));
}

// 오늘의 일정 섹션용 — 마감일이 정확히 그 날짜인 항목만.
export async function getMaterialTasksForDate(date: string): Promise<MaterialTask[]> {
  const [results, staffMap] = await Promise.all([
    queryAllPages({
      data_source_id: DB.MATERIAL,
      filter: { property: "마감일", date: { equals: date } },
    }),
    staffNameMap(),
  ]);
  return results.map((p: any) => toMaterialTask(p, staffMap));
}

// 교사가 작업요청 — 담당자는 비워둔 채 등록 가능(나중에 배정).
export async function createMaterialTask(input: {
  title: string;
  requesterName?: string;
  ownerName?: string;
  content: string;
  dueDate: string;
  fileLocation?: string;
  fileUploadId?: string;
  fileName?: string;
}) {
  const [requesterId, ownerId] = await Promise.all([
    input.requesterName ? findStaffIdByName(input.requesterName) : null,
    input.ownerName ? findStaffIdByName(input.ownerName) : null,
  ]);
  await notion.pages.create({
    parent: { data_source_id: DB.MATERIAL } as any,
    properties: {
      제목: { title: [{ text: { content: input.title } }] },
      ...(requesterId ? { 요청자: { relation: [{ id: requesterId }] } } : {}),
      ...(ownerId ? { 담당자: { relation: [{ id: ownerId }] } } : {}),
      작업내용: { rich_text: [{ text: { content: input.content } }] },
      작업률: { number: 0 },
      상태: { select: { name: "요청됨" } },
      마감일: { date: { start: input.dueDate } },
      ...(input.fileLocation ? { 파일저장위치: { url: input.fileLocation } } : {}),
      ...(input.fileUploadId
        ? { 원본파일: { files: [{ type: "file_upload", file_upload: { id: input.fileUploadId }, name: input.fileName } as any] } }
        : {}),
    } as any,
  });
}

export async function updateMaterialTask(
  id: string,
  input: {
    ownerName?: string;
    progress?: number;
    status?: string;
    fileLocation?: string;
    content?: string;
    dueDate?: string;
  }
) {
  const properties: any = {};
  if (input.ownerName !== undefined) {
    const ownerId = input.ownerName ? await findStaffIdByName(input.ownerName) : null;
    properties["담당자"] = { relation: ownerId ? [{ id: ownerId }] : [] };
  }
  if (input.progress !== undefined) properties["작업률"] = { number: input.progress };
  if (input.status !== undefined) properties["상태"] = { select: { name: input.status } };
  if (input.fileLocation !== undefined) properties["파일저장위치"] = { url: input.fileLocation || null };
  if (input.content !== undefined) properties["작업내용"] = { rich_text: [{ text: { content: input.content } }] };
  if (input.dueDate) properties["마감일"] = { date: { start: input.dueDate } };
  await notion.pages.update({ page_id: id, properties });
}

// 원본파일 업로드 — 이 작업의 최신 원본으로 교체한다(누적 첨부는 지원하지
// 않음: Notion API가 돌려주는 기존 파일은 "file"(만료 URL) 타입이라
// file_upload로 재첨부할 수 없어, 여러 개를 유지하려는 시도 자체가 신뢰할
// 수 없다).
// Notion에 바이트를 올려두기만 하고(create + send), 아직 어느 페이지에도
// 붙이지 않은 file_upload id를 돌려준다. 새 작업요청은 페이지가 생기기
// 전에 파일부터 선택하는 경우가 많아서, 업로드 자체는 미리 해두고 그
// id를 createMaterialTask에 실어 페이지 생성과 동시에 붙인다.
export async function createFileUploadDraft(filename: string, contentType: string, data: Blob) {
  const created = await notion.fileUploads.create({
    mode: "single_part",
    filename,
    content_type: contentType,
  });
  await notion.fileUploads.send({ file_upload_id: created.id, file: { filename, data } });
  return { fileUploadId: created.id, filename };
}

// 기존 작업의 원본파일을 새로 올린 것으로 교체한다.
export async function uploadMaterialFile(
  pageId: string,
  filename: string,
  contentType: string,
  data: Blob
) {
  const { fileUploadId } = await createFileUploadDraft(filename, contentType, data);
  await notion.pages.update({
    page_id: pageId,
    properties: {
      원본파일: { files: [{ type: "file_upload", file_upload: { id: fileUploadId }, name: filename } as any] },
    } as any,
  });
}

// ---- 학생별 시험대비 (DB⑨) ----
// Lesson별 암기여부, 워크북/기출모의고사 체크리스트처럼 학생마다 구조가
// 가변적인 항목이 많아 Notion 속성을 30개 넘게 쪼개는 대신 "데이터" 필드
// 하나에 JSON으로 저장하고, 이 앱이 구조화된 폼으로 읽고 쓴다(lib/examPrep.ts
// 참고). 학생당 시험대비 시트는 하나만 유지 — 새 시험을 준비할 때는 시험명/
// 범위를 바꿔가며 같은 시트를 이어서 편집한다(진도/기출 DB③④처럼 날짜별
// 이력을 남기지 않음).

// 고등 데이터 구조를 "텍스트(교과서/부교재/모의고사/학교프린트)마다 워크북
// 9단계+단어암기를 각각 추적"하는 형태로 재설계하면서 예전에 저장된 시트
// (textbook/supplementary가 단일 문자열, mockExams/schoolPrints가 워크북과
// 무관한 평평한 목록)를 새 구조로 옮겨준다. 예전엔 이 세분화 자체가 없었으므로
// 완료 여부를 지어내지 않고 텍스트 이름/범위만 옮기고 9단계는 전부 미완료로
// 시작한다 — 그래서 마이그레이션 직후 진행률이 예전보다 낮게 보일 수 있는데,
// 이건 새로 생긴 더 세밀한 기준을 적용한 정직한 결과다.
function migrateHighData(rawHigh: any): HighData {
  if (rawHigh && Array.isArray(rawHigh.textSources)) {
    return { textSources: rawHigh.textSources as TextSource[], textAnalysisProgress: rawHigh.textAnalysisProgress ?? "" };
  }
  const sources: TextSource[] = [];
  if (rawHigh?.textbook) sources.push(newTextSource("교과서", rawHigh.textbook));
  if (rawHigh?.supplementary) sources.push(newTextSource("부교재", rawHigh.supplementary));
  for (const list of [rawHigh?.mockExams, rawHigh?.mockExams2]) {
    for (const item of Array.isArray(list) ? list : []) {
      if (!item?.label) continue;
      sources.push({ ...newTextSource("모의고사", item.label), detail: item.detail ?? "" });
    }
  }
  for (const item of Array.isArray(rawHigh?.schoolPrints) ? rawHigh.schoolPrints : []) {
    if (!item?.label) continue;
    sources.push({ ...newTextSource("학교프린트", item.label), detail: item.detail ?? "" });
  }
  return { textSources: sources, textAnalysisProgress: rawHigh?.textAnalysisProgress ?? "" };
}

// 중등도 고등과 같은 이유로 재설계: 교과서/부교재를 단일 문자열이 아니라
// 과(Lesson)마다 워크북 9단계+단어암기를 추적하는 TextSource 배열로,
// 연습문제 5종(자주틀리는문제/기출문제/추가문제/백발백중/적중백)은
// 카테고리별 체크리스트(Record)로 바꾼다. 예전 lessons의 본문암기/
// 대화문암기/성취도/진도메모는 각 과 TextSource로, practiceItems(단일
// NamedItem 5개)는 매칭되는 카테고리의 첫 항목으로 그대로 옮긴다 —
// 워크북 9단계는 예전에 없던 기준이라 고등과 동일하게 미체크로 시작한다.
function migrateMiddleData(rawMiddle: any): MiddleData {
  if (rawMiddle && Array.isArray(rawMiddle.textSources) && rawMiddle.practiceItems && !Array.isArray(rawMiddle.practiceItems)) {
    return {
      textSources: rawMiddle.textSources as TextSource[],
      schoolPrint: rawMiddle.schoolPrint ?? "",
      practiceItems: { ...emptyPracticeItems(), ...rawMiddle.practiceItems },
    };
  }

  const textSources: TextSource[] = [];
  for (const lesson of Array.isArray(rawMiddle?.lessons) ? rawMiddle.lessons : []) {
    textSources.push({
      ...newMiddleTextSource("교과서", lesson?.name ?? ""),
      detail: rawMiddle?.textbook ?? "",
      memo: lesson?.progress ?? "",
      bodyMemorized: !!lesson?.bodyMemorized,
      dialogueMemorized: !!lesson?.dialogueMemorized,
      achievement: lesson?.achievement ?? "",
    });
  }

  const practiceItems = emptyPracticeItems();
  for (const item of Array.isArray(rawMiddle?.practiceItems) ? rawMiddle.practiceItems : []) {
    const cat = (MIDDLE_PRACTICE_CATEGORIES as readonly string[]).includes(item?.label) ? (item.label as PracticeCategory) : null;
    if (cat) practiceItems[cat].push({ ...item, label: "" });
  }

  return { textSources, schoolPrint: rawMiddle?.schoolPrint ?? "", practiceItems };
}

function parseExamPrepData(raw: string, level: SchoolLevel): ExamPrepData {
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.level === "중등") return { level: "중등", middle: migrateMiddleData(parsed.middle) };
      if (parsed?.level === "고등") return { level: "고등", high: migrateHighData(parsed.high) };
    } catch {
      // 손상된 JSON이면 빈 시트로 대체
    }
  }
  return defaultDataFor(level);
}

export async function getExamPrepSheet(studentId: string): Promise<ExamPrepSheet> {
  const [student, res] = await Promise.all([
    getStudent(studentId),
    notion.dataSources.query({
      data_source_id: DB.EXAM_PREP,
      filter: { property: "학생", relation: { contains: studentId } },
      sorts: [{ property: "갱신일", direction: "descending" }],
      page_size: 1,
    }),
  ]);

  const fallbackLevel = levelFromGrade(student.grade) ?? "중등";
  const page = (res.results[0] as any) ?? null;
  if (!page) {
    return {
      id: null,
      studentId,
      studentName: student.name,
      school: student.school,
      grade: student.grade,
      level: fallbackLevel,
      examTitle: "",
      examRange: "",
      examDate: null,
      teachers: [],
      progress: 0,
      weakPoints: "",
      updatedAt: null,
      data: defaultDataFor(fallbackLevel),
    };
  }

  const level = (getSelect(page, "학교급") as SchoolLevel | null) ?? fallbackLevel;
  return {
    id: page.id,
    studentId,
    studentName: student.name,
    school: student.school,
    grade: student.grade,
    level,
    examTitle: getRichText(page, "시험명"),
    examRange: getRichText(page, "시험범위"),
    examDate: getDate(page, "시험일"),
    teachers: splitTeachers(getRichText(page, "담당교사")),
    progress: getNumber(page, "진행률") ?? 0,
    weakPoints: getRichText(page, "취약부분"),
    updatedAt: getDate(page, "갱신일"),
    data: parseExamPrepData(getRichText(page, "데이터"), level),
  };
}

export async function saveExamPrepSheet(input: {
  id: string | null;
  studentId: string;
  level: SchoolLevel;
  examTitle: string;
  examRange: string;
  examDate: string | null;
  teachers: string[];
  weakPoints: string;
  data: ExamPrepData;
}): Promise<{ id: string; progress: number }> {
  const progress = computeProgress(input.data);
  const properties: any = {
    학교급: { select: { name: input.level } },
    시험명: { rich_text: [{ text: { content: input.examTitle } }] },
    시험범위: { rich_text: [{ text: { content: input.examRange } }] },
    담당교사: { rich_text: [{ text: { content: joinTeachers(input.teachers) } }] },
    진행률: { number: progress },
    취약부분: { rich_text: [{ text: { content: input.weakPoints } }] },
    // 텍스트별 워크북 9단계 체크리스트를 전부 담다 보니 Notion의 rich_text
    // 블록당 2000자 제한을 쉽게 넘어 저장이 실패했다 — 2000자씩 여러 블록으로
    // 나눠 담는다(getRichText가 읽을 때 이미 여러 블록을 이어붙이도록 돼 있음).
    데이터: { rich_text: chunkRichText(JSON.stringify(input.data)) },
    갱신일: { date: { start: todayKST() } },
    시험일: input.examDate ? { date: { start: input.examDate } } : { date: null },
  };

  if (input.id) {
    await notion.pages.update({ page_id: input.id, properties });
    return { id: input.id, progress };
  }

  const studentPage: any = await notion.pages.retrieve({ page_id: input.studentId });
  const studentName = getTitle(studentPage, "이름");
  const page = await notion.pages.create({
    parent: { data_source_id: DB.EXAM_PREP } as any,
    properties: {
      제목: { title: [{ text: { content: `${studentName} ${input.examTitle || "시험대비"}` } }] },
      학생: { relation: [{ id: input.studentId }] },
      ...properties,
    } as any,
  });
  return { id: page.id, progress };
}

// 학생별 최신 시험대비 시트 하나씩(페이지 + 학생 정보) — 현황판과
// getExamPrepTemplate(동일 학교/학년 자동입력)이 공통으로 쓴다.
async function getAllExamPrepEntries(): Promise<{ page: any; student: Awaited<ReturnType<typeof getStudent>> }[]> {
  const results = await queryAllPages({
    data_source_id: DB.EXAM_PREP,
    sorts: [{ property: "갱신일", direction: "descending" }],
  });

  // 갱신일 내림차순이라 학생별로 먼저 만난 것이 최신 시트.
  const byStudent = new Map<string, any>();
  for (const p of results as any[]) {
    const studentId = getRelationIds(p, "학생")[0];
    if (!studentId || byStudent.has(studentId)) continue;
    byStudent.set(studentId, p);
  }

  const studentIds = Array.from(byStudent.keys());
  const students = await Promise.all(studentIds.map((id) => getStudent(id)));
  return studentIds.map((id, i) => ({ page: byStudent.get(id), student: students[i] }));
}

// 현황판/진도표 — 시험대비 시트가 있는 모든 학생을 한 번에 모아온다.
export async function listExamPrepOverview() {
  const [entries, examMap] = await Promise.all([getAllExamPrepEntries(), latestExamScoreMap()]);

  return entries.map(({ page: p, student: s }) => {
    const level = (getSelect(p, "학교급") as SchoolLevel | null) ?? "중등";
    const data = parseExamPrepData(getRichText(p, "데이터"), level);
    return {
      studentId: s.id,
      studentName: s.name,
      school: s.school,
      grade: s.grade,
      level,
      examTitle: getRichText(p, "시험명"),
      examRange: getRichText(p, "시험범위"),
      examDate: getDate(p, "시험일"),
      teachers: splitTeachers(getRichText(p, "담당교사")),
      progress: getNumber(p, "진행률") ?? 0,
      weakPoints: getRichText(p, "취약부분"),
      updatedAt: getDate(p, "갱신일"),
      latestExam: examMap.get(s.id) ?? null,
      categories: computeCategoryBreakdown(data),
    };
  });
}

// 같은 학교+학년 학생들의 시험대비 시트를 모아 시험대비명/교과서/부교재/
// 학교프린트/시험범위/담당교사 표기를 통일할 수 있도록 자동입력 값과
// 자동완성 후보를 만든다. 대상이 하나도 없으면 null.
export async function getExamPrepTemplate(input: {
  school: string;
  grade: string;
  excludeStudentId: string;
}): Promise<ExamPrepTemplate> {
  const entries = await getAllExamPrepEntries();
  const matches = entries.filter(
    (e) => e.student.id !== input.excludeStudentId && e.student.school === input.school && e.student.grade === input.grade
  );
  if (matches.length === 0) return null;

  const parsed = matches.map((e) => {
    const level = (getSelect(e.page, "학교급") as SchoolLevel | null) ?? "중등";
    return { page: e.page, level, data: parseExamPrepData(getRichText(e.page, "데이터"), level) };
  });

  const uniq = (vals: (string | null | undefined)[]) =>
    Array.from(new Set(vals.filter((v): v is string => !!v && v.trim() !== "")));

  // 중등(과 단위)/고등(교재 단위) 둘 다 이제 교과서/부교재는 textSources
  // 배열이라, 카테고리별 텍스트 이름만 뽑아 자동입력/자동완성 후보로 쓴다.
  // 학교프린트는 중등은 아직 단일 문자열 필드라 별도로 처리한다.
  const textSourcesOf = (data: ExamPrepData): TextSource[] => (data.level === "중등" ? data.middle.textSources : data.high.textSources);
  const labelsOf = (data: ExamPrepData, category: TextCategory): string[] =>
    textSourcesOf(data)
      .filter((t) => t.category === category)
      .map((t) => t.label);
  const schoolPrintOf = (data: ExamPrepData): string =>
    data.level === "중등" ? data.middle.schoolPrint : labelsOf(data, "학교프린트").join(", ");

  // getAllExamPrepEntries()는 갱신일 내림차순이므로 matches[0]/parsed[0]가 최신.
  const latest = parsed[0];
  return {
    level: latest.level,
    latest: {
      examTitle: getRichText(latest.page, "시험명"),
      examRange: getRichText(latest.page, "시험범위"),
      teachers: splitTeachers(getRichText(latest.page, "담당교사")),
      textbook: labelsOf(latest.data, "교과서").join(", "),
      supplementary: labelsOf(latest.data, "부교재").join(", "),
      schoolPrint: schoolPrintOf(latest.data),
    },
    examTitleOptions: uniq(parsed.map((p) => getRichText(p.page, "시험명"))),
    examRangeOptions: uniq(parsed.map((p) => getRichText(p.page, "시험범위"))),
    textbookOptions: uniq(parsed.flatMap((p) => labelsOf(p.data, "교과서"))),
    supplementaryOptions: uniq(parsed.flatMap((p) => labelsOf(p.data, "부교재"))),
    schoolPrintOptions: uniq(parsed.map((p) => schoolPrintOf(p.data))),
    schoolPrintItemLabels: uniq(parsed.flatMap((p) => labelsOf(p.data, "학교프린트"))),
  };
}

// 같은 학교+학년은 학교에서 내려주는 시험범위가 원래 하나뿐이라, 한 학생
// 시트에서 정리한 시험범위를 나머지 학생들에게도 밀어 넣을 수 있게 한다.
// getAllExamPrepEntries()가 이미 "시험대비 시트가 실제로 존재하는 학생"만
// 반환하므로, 아직 시트를 만든 적 없는 학생은 자동으로 제외되고(새 페이지를
// 만들어버리는 일이 없음) — 시험범위 외 다른 필드(체크리스트/시험명 등)는
// 건드리지 않아 기존 데이터 손실을 최소화한다.
async function getExamRangeSyncTargets(input: { school: string; grade: string; excludeStudentId: string }) {
  const entries = await getAllExamPrepEntries();
  return entries.filter(
    (e) => e.student.id !== input.excludeStudentId && e.student.school === input.school && e.student.grade === input.grade
  );
}

// 실제로 적용하기 전에 "누가 어떤 값에서 바뀌는지" 미리 보여주기 위한 목록.
export async function getExamRangeSyncPreview(input: {
  school: string;
  grade: string;
  excludeStudentId: string;
}): Promise<{ studentId: string; studentName: string; examRange: string }[]> {
  const targets = await getExamRangeSyncTargets(input);
  return targets.map((e) => ({
    studentId: e.student.id,
    studentName: e.student.name,
    examRange: getRichText(e.page, "시험범위"),
  }));
}

export async function syncExamRange(input: {
  school: string;
  grade: string;
  excludeStudentId: string;
  examRange: string;
}): Promise<{ studentId: string; studentName: string }[]> {
  const targets = await getExamRangeSyncTargets(input);
  await Promise.all(
    targets.map((e) =>
      notion.pages.update({
        page_id: e.page.id,
        properties: {
          시험범위: { rich_text: chunkRichText(input.examRange) },
          갱신일: { date: { start: todayKST() } },
        },
      })
    )
  );
  return targets.map((e) => ({ studentId: e.student.id, studentName: e.student.name }));
}

// 시험결과 입력/저장 — 기존 DB⑦시험성적에 이어서 기록한다(대시보드의
// "직전 학교시험 점수"/성적 추이 차트가 그대로 이 데이터를 함께 사용).
export async function createExamScore(input: {
  studentId: string;
  examName: string;
  subject?: string;
  score: number;
  date: string;
}) {
  const studentPage: any = await notion.pages.retrieve({ page_id: input.studentId });
  const studentName = getTitle(studentPage, "이름");
  await notion.pages.create({
    parent: { data_source_id: DB.EXAM_SCORE } as any,
    properties: {
      제목: { title: [{ text: { content: `${studentName} ${input.examName}` } }] },
      학생: { relation: [{ id: input.studentId }] },
      시험명: { rich_text: [{ text: { content: input.examName } }] },
      ...(input.subject ? { 과목: { select: { name: input.subject } } } : {}),
      점수: { number: input.score },
      날짜: { date: { start: input.date } },
    } as any,
  });
}

// ---- 전날 결석자 → 보강 자동 요청 ----
// 결석 처리된 학생을 "보강" 유형 DB⑱ 항목으로 자동 옮겨주되, 이미 만든 적
// 있으면 다시 만들지 않는다. 제목에 결석일(YYYY-MM-DD)을 항상 박아 넣어서,
// 그 문자열이 제목에 포함돼 있는지로 중복 여부를 판단한다 — 별도 relation/
// checkbox 속성을 새로 만들지 않아도 되고(금정·사직 두 Notion 워크스페이스
// 스키마를 똑같이 안 건드려도 됨), 항상 Notion의 실제 상태를 그대로 조회해
// 판단하므로 별도로 "확인함" 플래그를 관리할 필요도 없다.
function makeupRequestTitle(studentName: string, absenceDate: string) {
  return `보강요청 - ${studentName} (${absenceDate} 결석)`;
}

async function findMakeupRequestForAbsence(studentId: string, absenceDate: string) {
  const res = await notion.dataSources.query({
    data_source_id: DB.TODO,
    filter: {
      and: [
        { property: "유형", select: { equals: "보강" } },
        { property: "관련학생", relation: { contains: studentId } },
        { property: "제목", title: { contains: `(${absenceDate} 결석)` } },
      ],
    },
    page_size: 1,
  });
  return (res.results[0] as any) ?? null;
}

// 주어진 날짜(보통 "어제")에 출결이 "결석"으로 기록된 DB④ 일일기록을 모두
// 가져온다. 반/학생 relation만 뽑아 돌려주고, 이름 등 표시용 정보는 호출부가
// 배치 조회해서 붙인다.
async function getAbsentDailyRecords(date: string) {
  const records = await queryAllPages({
    data_source_id: DB.DAILY_RECORD,
    filter: {
      and: [
        { property: "날짜", date: { equals: date } },
        { property: "출결", select: { equals: "결석" } },
      ],
    },
  });
  return (records as any[])
    .map((r) => ({
      dailyRecordId: r.id as string,
      studentId: getRelationIds(r, "학생")[0] as string | undefined,
      classId: getRelationIds(r, "반")[0] as string | undefined,
    }))
    .filter((r): r is { dailyRecordId: string; studentId: string; classId: string | undefined } => !!r.studentId);
}

// 결석 학생의 보강요청에 "그날 수업한 내용"을 함께 담아 보강 담당자가
// 무엇을 가르쳐야 하는지 바로 알 수 있게 한다. 담당교사가 이미 그날 진도
// (DB③)를 저장해뒀으면 수업과목/진도/과제/다음시간테스트까지 모두 가져오고,
// 아직 저장 전(조교가 결석 체크인만 해둔 상태)이면 일일기록(DB④) 자체에
// 남아있는 진도내용만이라도 쓴다.
async function getDailyRecordLessonContent(dailyRecordId: string): Promise<string> {
  const daily: any = await notion.pages.retrieve({ page_id: dailyRecordId });
  const progressId = getRelationIds(daily, "반별진도원본")[0];
  if (progressId) {
    const progress: any = await notion.pages.retrieve({ page_id: progressId });
    const parts: string[] = [];
    const subjects = getMultiSelect(progress, "수업과목");
    if (subjects.length > 0) parts.push(`[수업과목] ${subjects.join(", ")}`);
    const progressText = getRichText(progress, "진도내용");
    if (progressText) parts.push(`[진도] ${progressText}`);
    const homework = getRichText(progress, "과제내용");
    if (homework) parts.push(`[과제] ${homework}`);
    const nextAssignment = getRichText(progress, "다음시간테스트");
    if (nextAssignment) parts.push(`[다음시간 테스트] ${nextAssignment}`);
    if (parts.length > 0) return parts.join("\n");
  }
  return getRichText(daily, "진도내용");
}

// 이미 그 학생의 그 결석일자 보강요청이 있으면 손대지 않고, 없으면 반의
// 담당교사(여러 명이면 그중 첫 번째)를 담당자로 지정해 새로 만든다 — 담당교사
// 이름이 직원 명단과 정확히 일치하지 않으면(오타 등) 담당자 없이 생성된다(다른 자동생성
// 경로들과 동일한 관대한 처리).
async function ensureMakeupRequestForAbsence(input: {
  studentId: string;
  studentName: string;
  classId?: string;
  className: string;
  teacherName: string;
  absenceDate: string;
  lessonContent?: string;
}) {
  const existing = await findMakeupRequestForAbsence(input.studentId, input.absenceDate);
  if (existing) {
    const ownerId = getRelationIds(existing, "담당자")[0];
    // 완료여부=true는 "취소(더 이상 보강 필요 없음)" 또는 이미 처리 완료를
    // 뜻하고, 시간이 채워져 있으면 이미 확정된 것이다 — 둘 다 더는 결석
    // 검토 팝업에 다시 이름이 뜨거나 재생성될 필요가 없는 "해결됨" 상태.
    const resolved = getCheckbox(existing, "완료여부") || getRichText(existing, "시간").trim() !== "";
    // 이미 만들어진 요청에 수업내용이 아직 비어있으면(이 기능이 생기기
    // 전에 만들어졌거나, 그때는 교사가 진도를 아직 저장하기 전이었던
    // 경우) 지금 값이 있으면 채워 넣는다 — 다른 필드는 건드리지 않는다.
    if (input.lessonContent && !getRichText(existing, "결석수업내용").trim()) {
      await notion.pages.update({
        page_id: existing.id,
        properties: { 결석수업내용: { rich_text: [{ text: { content: input.lessonContent } }] } } as any,
      });
    }
    return { id: existing.id as string, created: false, ownerAssigned: !!ownerId, resolved };
  }
  const ownerId = input.teacherName ? await findStaffIdByName(input.teacherName) : null;
  const page = await notion.pages.create({
    parent: { data_source_id: DB.TODO } as any,
    properties: {
      제목: { title: [{ text: { content: makeupRequestTitle(input.studentName, input.absenceDate) } }] },
      유형: { select: { name: "보강" } },
      관련학생: { relation: [{ id: input.studentId }] },
      ...(input.classId ? { 관련반: { relation: [{ id: input.classId }] } } : {}),
      ...(ownerId ? { 담당자: { relation: [{ id: ownerId }] } } : {}),
      예정일: { date: { start: todayKST() } },
      시간: { rich_text: [] },
      메모: {
        rich_text: [
          {
            text: {
              content: `${input.absenceDate} ${input.className} 결석에 따라 자동 등록된 보강 요청입니다. 학생과 협의해 보강 일정(시간)을 확정해주세요.`,
            },
          },
        ],
      },
      ...(input.lessonContent ? { 결석수업내용: { rich_text: [{ text: { content: input.lessonContent } }] } } : {}),
      완료여부: { checkbox: false },
      우선순위: { select: { name: "보통" } },
    } as any,
  });
  return { id: page.id, created: true, ownerAssigned: !!ownerId, resolved: false };
}

export type AbsenceReviewItem = {
  dailyRecordId: string;
  studentId: string;
  studentName: string;
  school: string;
  grade: string | null;
  classId: string | undefined;
  className: string;
  date: string;
  makeupRequestId: string;
  ownerAssigned: boolean;
};

// 결석 체크 즉시(당일 포함) 또는 행정 로그인(대시보드 진입) 시 뜨는 "결석자
// 검토" 팝업의 데이터 소스. 조회하는 시점에 그날 결석자별 보강요청이 아직
// 없으면 그 자리에서 자동으로 만들어(=ensureMakeupRequestForAbsence) "결석자
// 명단이 자동으로 보강 명단으로 옮겨진다"는 요구를 충족하고, 담당교사/조교가
// 이후 로그인해 "오늘의 일정 > 보강"을 보면 이미 올라와 있는 상태가 된다.
//
// 보강요청이 이미 취소(완료 처리)됐거나 확정된(시간이 채워진) 학생, 그리고
// 담당교사가 이미 자동/수동으로 지정된 학생은 목록에서 뺀다 — 담당자가 이미
// 정해졌으면 더 검토할 게 없으므로, 팝업은 "담당자 미지정"처럼 실제 조치가
// 필요한 건만 계속 보여준다. 그래야 "취소하면 팝업에 이름이 다시 안 뜨고,
// 처리할 게 없어지면 팝업 자체가 닫히는" 동작이 된다. 취소를 완료여부=true로
// 표시하는 이유: Notion에서 실제로 지우면(보관 처리) 다음 조회 때 "요청이
// 없다"고 판단해 똑같은 요청을 즉시 다시 만들어버리기 때문에(같은 학생이
// 여전히 결석으로 남아있으므로), 실제 삭제 대신 "완료" 처리로 재생성을
// 막는다.
// 결석일자(YYYY-MM-DD)의 요일을 WEEKDAYS(["월",...,"일"]) 라벨로 변환.
function weekdayLabel(dateStr: string): string {
  const WEEKDAYS_KO = ["월", "화", "수", "목", "금", "토", "일"];
  const jsDay = new Date(`${dateStr}T00:00:00+09:00`).getDay(); // 0=일 ... 6=토
  return WEEKDAYS_KO[(jsDay + 6) % 7];
}

// 반 담당교사가 요일마다 다르면(dayTeachers) 그 결석일의 요일 담당교사를,
// 아니면 반 전체 담당교사(teachers) 중 첫 번째를 보강요청 담당자 후보로 쓴다.
function teacherNameForAbsence(cls: { teachers: string[]; dayTeachers: DayTeachers } | undefined, absenceDate: string): string {
  if (!cls) return "";
  const day = weekdayLabel(absenceDate);
  const periods = cls.dayTeachers[day];
  // 결석기록엔 몇 교시였는지가 없어 특정할 수 없으니, 그 요일에 지정된 교시들
  // 중 가장 이른 교시(1교시부터) 담당자를 대표로 쓴다.
  const firstPeriodTeacher = periods
    ? Object.entries(periods).sort((a, b) => Number(a[0]) - Number(b[0]))[0]?.[1]
    : undefined;
  return firstPeriodTeacher ?? cls.teachers[0] ?? "";
}

export async function getAbsenceReviewData(date: string): Promise<AbsenceReviewItem[]> {
  const absences = await getAbsentDailyRecords(date);
  if (absences.length === 0) return [];

  const [students, classes] = await Promise.all([searchStudents(""), listClasses()]);
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const classMap = new Map(classes.map((c) => [c.id, c]));

  const items: AbsenceReviewItem[] = [];
  for (const a of absences) {
    const student = studentMap.get(a.studentId);
    const cls = a.classId ? classMap.get(a.classId) : undefined;
    const studentName = student?.name ?? "-";
    const className = cls ? stripClassSuffix(cls.name) : "-";
    const lessonContent = await getDailyRecordLessonContent(a.dailyRecordId);
    const result = await ensureMakeupRequestForAbsence({
      studentId: a.studentId,
      studentName,
      classId: a.classId,
      className,
      teacherName: teacherNameForAbsence(cls, date),
      absenceDate: date,
      lessonContent,
    });
    if (result.resolved || result.ownerAssigned) continue;
    items.push({
      dailyRecordId: a.dailyRecordId,
      studentId: a.studentId,
      studentName,
      school: student?.school ?? "",
      grade: student?.grade ?? null,
      classId: a.classId,
      className,
      date,
      makeupRequestId: result.id,
      ownerAssigned: result.ownerAssigned,
    });
  }
  return items;
}

// 팝업에서 "결석이 아니라 지각이었어요" 정정 — 출결을 지각으로 바로잡고,
// 그 결석을 근거로 자동 생성됐던 보강요청이 있다면 함께 취소한다(결석이
// 아니게 됐는데 보강요청만 덩그러니 남는 것을 막기 위함).
export async function correctAbsenceToLate(input: { dailyRecordId: string; studentId: string; date: string }) {
  await notion.pages.update({
    page_id: input.dailyRecordId,
    properties: { 출결: { select: { name: "지각" } } } as any,
  });
  const existing = await findMakeupRequestForAbsence(input.studentId, input.date);
  if (existing) await deleteScheduleEntry(existing.id);
}

// ---- 보강/재시 시간 확정 현황 ----
// "시간"이 비어있으면 아직 학생/학부모와 협의해 실제 보강·재시 시간을
// 확정하지 못한 상태로 본다(예정일만 임시로 잡아둔 상태). 새 Notion
// 속성을 추가하지 않고 이미 있는 시간 필드의 빈 값 자체를 "미확정" 신호로
// 재사용한다 — 확정되면(예정일·시간을 실제 값으로 채우면) 그 날짜의
// "오늘의 일정 > 보강/재시"에 자동으로 뜬다(getTodaySchedule이 예정일로만
// 조회하므로 별도 처리가 필요 없음).
export type MakeupScheduleItem = {
  id: string;
  type: string;
  studentName: string;
  className: string;
  ownerName: string;
  date: string | null;
  time: string;
  memo: string;
  // 결석 당시 그 반에서 수업한 내용(수업과목/진도/과제/다음시간테스트) —
  // "보강" 유형에서만 채워지고, 없으면 빈 문자열.
  lessonContent: string;
  confirmed: boolean;
};

// staffId를 주면 그 담당자에게 배정된 것만, 안 주면(행정/원장 전체 현황)
// 전체를 돌려준다.
export async function getMakeupScheduleStatus(opts: { staffId?: string } = {}): Promise<MakeupScheduleItem[]> {
  const filters: any[] = [
    {
      or: [
        { property: "유형", select: { equals: "보강" } },
        { property: "유형", select: { equals: "재시" } },
      ],
    },
    { property: "완료여부", checkbox: { equals: false } },
  ];
  if (opts.staffId) filters.push({ property: "담당자", relation: { contains: opts.staffId } });

  const records = await queryAllPages({ data_source_id: DB.TODO, filter: { and: filters } });
  if (records.length === 0) return [];

  const [students, classes, staffList] = await Promise.all([searchStudents(""), listClasses(), listStaff()]);
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const classMap = new Map(classes.map((c) => [c.id, c]));
  const staffMap = new Map(staffList.map((s) => [s.id, s.name]));

  return (records as any[]).map((r) => {
    const studentId = getRelationIds(r, "관련학생")[0];
    const classId = getRelationIds(r, "관련반")[0];
    const ownerId = getRelationIds(r, "담당자")[0];
    const cls = classId ? classMap.get(classId) : undefined;
    const time = getRichText(r, "시간");
    return {
      id: r.id as string,
      type: getSelect(r, "유형") ?? "보강",
      studentName: (studentId && studentMap.get(studentId)?.name) || "-",
      className: cls ? stripClassSuffix(cls.name) : "-",
      ownerName: (ownerId && staffMap.get(ownerId)) || "미배정",
      date: getDate(r, "예정일"),
      time,
      memo: getRichText(r, "메모"),
      lessonContent: getRichText(r, "결석수업내용"),
      confirmed: time.trim() !== "",
    };
  });
}
