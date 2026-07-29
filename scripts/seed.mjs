// One-off sample-data seeder. Reads .env.local manually (no dotenv dep) and
// writes directly through @notionhq/client. Run with: node scripts/seed.mjs
import { Client } from "@notionhq/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DB = {
  CLASS: process.env.NOTION_DB_CLASS,
  STUDENT: process.env.NOTION_DB_STUDENT,
  CLASS_PROGRESS: process.env.NOTION_DB_CLASS_PROGRESS,
  BRIEFING: process.env.NOTION_DB_BRIEFING,
  COUNSELING: process.env.NOTION_DB_COUNSELING,
  ADMIN_INBOX: process.env.NOTION_DB_ADMIN_INBOX,
};

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randDateWithin(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - randInt(0, daysBack));
  return d.toISOString().slice(0, 10);
}
function randPhone() {
  return `010-${randInt(1000, 9999)}-${randInt(1000, 9999)}`;
}

// Small concurrency-limited runner so we don't blast the Notion API.
async function runLimited(items, worker, concurrency = 4) {
  const results = new Array(items.length);
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, next));
  return results;
}

const SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "전", "홍", "유", "고", "문", "양", "손"];
const GIVEN1 = ["민", "서", "지", "예", "하", "도", "시", "유", "준", "윤", "수", "현", "우", "재", "태", "건", "아", "다", "은", "채"];
const GIVEN2 = ["준", "윤", "우", "진", "호", "원", "아", "율", "안", "성", "빈", "랑", "경", "영", "훈", "연", "린", "서", "현", "민"];
function randomName() {
  return rand(SURNAMES) + rand(GIVEN1) + rand(GIVEN2);
}

const SCHOOLS = ["여명중", "거성중", "이그잼중", "한빛중", "중앙중", "서울초", "동산초", "경남고", "부일고", "금정고", "연제중", "시청초"];
const TEACHERS = ["김민수", "이지은", "박현우", "최유진", "정도현", "강서아", "조태양", "윤하늘"];
const DAY_SETS = [["월", "수"], ["화", "목"], ["월", "수", "금"], ["화", "목", "토"], ["토"]];
const TIMES = ["16:00-17:30", "17:00-18:30", "18:00-19:30", "19:00-20:30", "10:00-11:30"];

const LEVEL_DEFS = [
  { level: "초등", grades: ["초3", "초4", "초5", "초6"], count: 4 },
  { level: "중등", grades: ["중1", "중2", "중3"], count: 6 },
  { level: "고등", grades: ["고1", "고2", "고3"], count: 5 },
];

async function main() {
  // 1) 15 classes -------------------------------------------------------
  const classDefs = [];
  let n = 1;
  for (const { level, grades, count } of LEVEL_DEFS) {
    for (let i = 0; i < count; i++) {
      classDefs.push({
        name: `${rand(grades)} ${String.fromCharCode(65 + (i % 4))}반 (${n})`,
        level,
        grades,
      });
      n++;
    }
  }
  console.log(`Creating ${classDefs.length} classes...`);
  const classes = await runLimited(classDefs, async (c) => {
    const page = await notion.pages.create({
      parent: { data_source_id: DB.CLASS },
      properties: {
        반이름: { title: [{ text: { content: c.name } }] },
        담당교사: { rich_text: [{ text: { content: rand(TEACHERS) } }] },
        요일: { multi_select: rand(DAY_SETS).map((d) => ({ name: d })) },
        시간: { rich_text: [{ text: { content: rand(TIMES) } }] },
        레벨: { select: { name: c.level } },
      },
    });
    return { id: page.id, ...c };
  });
  console.log(`  -> ${classes.length} classes created.`);

  // 2) 10 students per class --------------------------------------------
  const studentDefs = [];
  for (const cls of classes) {
    for (let i = 0; i < 10; i++) {
      studentDefs.push({ classId: cls.id, grade: rand(cls.grades) });
    }
  }
  console.log(`Creating ${studentDefs.length} students...`);
  const students = await runLimited(studentDefs, async (s) => {
    const name = randomName();
    const page = await notion.pages.create({
      parent: { data_source_id: DB.STUDENT },
      properties: {
        이름: { title: [{ text: { content: name } }] },
        소속반: { relation: [{ id: s.classId }] },
        학년: { select: { name: s.grade } },
        학교: { rich_text: [{ text: { content: rand(SCHOOLS) } }] },
        학부모연락처: { phone_number: randPhone() },
        연락처: { phone_number: randPhone() },
        등록일: { date: { start: randDateWithin(300) } },
        상태: { select: { name: "재원" } },
      },
    });
    return { id: page.id, name, classId: s.classId };
  });
  console.log(`  -> ${students.length} students created.`);

  const byClass = new Map();
  for (const s of students) {
    if (!byClass.has(s.classId)) byClass.set(s.classId, []);
    byClass.get(s.classId).push(s);
  }

  // 3) 10 admin inbox messages -------------------------------------------
  const ADMIN_TYPES = ["결석신고", "전달사항", "신규생문의", "기타"];
  const ADMIN_CONTENTS = [
    "오늘 감기 기운으로 결석합니다.",
    "다음 주 시험 일정 안내 부탁드립니다.",
    "학원 차량 시간 변경 요청드립니다.",
    "신규 상담 문의 전화가 왔습니다.",
    "교재비 입금 확인 부탁드립니다.",
    "이번 주 금요일 조퇴 예정입니다.",
    "형제 등록 문의가 있었습니다.",
    "숙제 관련 학부모 문의 있었습니다.",
    "다음 달 휴원 신청합니다.",
    "상담 일정 재조정 요청드립니다.",
  ];
  console.log("Creating 10 admin inbox entries...");
  await runLimited(ADMIN_CONTENTS, async (content, i) => {
    const type = ADMIN_TYPES[i % ADMIN_TYPES.length];
    const target = rand(students);
    await notion.pages.create({
      parent: { data_source_id: DB.ADMIN_INBOX },
      properties: {
        제목: { title: [{ text: { content: `${type} - ${target.name}` } }] },
        입력유형: { select: { name: type } },
        대상학생: { relation: [{ id: target.id }] },
        날짜: { date: { start: randDateWithin(14) } },
        내용: { rich_text: [{ text: { content } }] },
        처리완료: { checkbox: Math.random() > 0.5 },
      },
    });
  });
  console.log("  -> done.");

  // 4) 1 class-progress entry per class -----------------------------------
  const PROGRESS_TOPICS = [
    "Chapter 3 현재완료 시제",
    "Unit 5 관계대명사",
    "리딩 지문 분석 - 환경 주제",
    "문법 특강: 가정법",
    "Chapter 7 분사구문",
    "단어 Test 대비 복습",
    "에세이 작성 연습",
    "듣기 평가 대비 훈련",
    "Unit 9 비교급/최상급",
    "내신 대비 서술형 문제풀이",
  ];
  console.log(`Creating ${classes.length} class progress entries...`);
  const progressByClass = await runLimited(classes, async (cls) => {
    const topic = rand(PROGRESS_TOPICS);
    const homework = `Workbook p.${randInt(10, 90)}-${randInt(91, 99)}`;
    const date = randDateWithin(3);
    const page = await notion.pages.create({
      parent: { data_source_id: DB.CLASS_PROGRESS },
      properties: {
        제목: { title: [{ text: { content: `${date} ${cls.name} 진도` } }] },
        반: { relation: [{ id: cls.id }] },
        날짜: { date: { start: date } },
        진도내용: { rich_text: [{ text: { content: topic } }] },
        숙제내용: { rich_text: [{ text: { content: homework } }] },
        단어시험범위: { rich_text: [{ text: { content: `Unit ${randInt(1, 12)} 단어 1-30번` } }] },
        특이사항: { rich_text: [{ text: { content: "" } }] },
      },
    });
    return { classId: cls.id, topic, homework, date };
  });
  console.log("  -> done.");
  const progressMap = new Map(progressByClass.map((p) => [p.classId, p]));

  // 5) 1 daily briefing per student, derived from their class's progress --
  const BRIEFING_TYPES = ["칭찬", "주의", "전달사항", "기타"];
  console.log(`Creating ${students.length} daily briefings...`);
  await runLimited(students, async (s) => {
    const prog = progressMap.get(s.classId);
    const type = rand(BRIEFING_TYPES);
    const body = `${s.name} 학생, 오늘 [${prog.topic}] 진도 진행했습니다. 숙제(${prog.homework}) 꼭 확인 부탁드립니다.`;
    await notion.pages.create({
      parent: { data_source_id: DB.BRIEFING },
      properties: {
        제목: { title: [{ text: { content: `${s.name} 데일리브리핑 ${prog.date}` } }] },
        학생: { relation: [{ id: s.id }] },
        날짜: { date: { start: prog.date } },
        브리핑유형: { select: { name: type } },
        브리핑내용: { rich_text: [{ text: { content: body } }] },
      },
    });
  }, 5);
  console.log("  -> done.");

  // 6) 20 counseling logs, content trimmed to exactly 25 chars -------------
  const COUNSELING_TEMPLATES = [
    "오늘 수업 집중도 저하로 상담을 진행했습니다.",
    "최근 성적이 하락하여 학부모님과 통화 상담했습니다.",
    "친구 관계로 고민이 있어 상담 후 격려해주었습니다.",
    "숙제 미제출이 반복되어 원인을 상담했습니다.",
    "진로 고민 상담 후 학습 목표를 재설정했습니다.",
    "지각이 잦아져서 생활 습관 상담을 진행했습니다.",
    "시험 불안감을 호소하여 심리 상담을 진행했습니다.",
    "반 이동을 희망하여 관련 상담을 진행했습니다.",
    "학습 동기 부여를 위한 상담을 진행했습니다.",
    "교우 관계 갈등 중재를 위한 상담을 진행했습니다.",
  ];
  const shuffledStudents = [...students].sort(() => Math.random() - 0.5).slice(0, 20);
  const staff = ["김원장", "박행정", "이강사"];
  console.log("Creating 20 counseling logs (25 chars each)...");
  await runLimited(shuffledStudents, async (s, i) => {
    const raw = rand(COUNSELING_TEMPLATES);
    const content = raw.slice(0, 25);
    await notion.pages.create({
      parent: { data_source_id: DB.COUNSELING },
      properties: {
        제목: { title: [{ text: { content: `${s.name} 상담일지` } }] },
        학생: { relation: [{ id: s.id }] },
        날짜: { date: { start: randDateWithin(30) } },
        상담자: { rich_text: [{ text: { content: rand(staff) } }] },
        상담내용: { rich_text: [{ text: { content } }] },
        후속조치: { rich_text: [{ text: { content: "지속 관찰 예정" } }] },
      },
    });
  });
  console.log("  -> done.");

  console.log("\nSeed complete:");
  console.log(`  classes: ${classes.length}`);
  console.log(`  students: ${students.length}`);
  console.log(`  admin inbox: ${ADMIN_CONTENTS.length}`);
  console.log(`  class progress: ${progressByClass.length}`);
  console.log(`  briefings: ${students.length}`);
  console.log(`  counseling: ${shuffledStudents.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
