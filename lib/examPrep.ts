// Shared between the exam-prep API routes (server) and the exam-prep UI
// (client) — pure types/helpers only, safe to import from both.

export type SchoolLevel = "중등" | "고등";

// A single checkable line item, reused for every repeating list in the
// sheet (연습문제 종류, 워크북 단계, 기출모의고사, 학교프린트 출처, 단어암기
// 범위 등) so the UI only needs one list-editor component instead of one
// per category.
export type NamedItem = {
  id: string;
  label: string; // 항목명 (예: "영어빈칸", "2025년 6월 모의고사", "OO중 2학기 프린트")
  detail: string; // 부가정보 (예: 문항범위 "18-24", 단어범위, 출처)
  done: boolean;
  memo: string;
};

// 중등 내신대비 문제풀이 5종 — 특정 과(Lesson)에 매인 게 아니라 시험범위
// 전체에 걸쳐 도는 별도 교재/프린트라 워크북 9단계를 씌우지 않고, 카테고리별
// 완료 체크리스트로만 관리한다(카테고리당 여러 건 등록 가능).
export const MIDDLE_PRACTICE_CATEGORIES = ["자주 틀리는 문제", "기출문제", "추가문제", "백발백중", "적중백"] as const;
export type PracticeCategory = (typeof MIDDLE_PRACTICE_CATEGORIES)[number];

export type MiddleData = {
  // 교과서/부교재 — 고등의 TextSource를 그대로 재사용해 과(Lesson)마다
  // 워크북 9단계+단어암기를 관리한다. label에 "1과" 같은 과 이름을, detail에
  // 교재명/범위를 적는다. bodyMemorized/dialogueMemorized/achievement는
  // 중등 전용 필드(고등에서는 쓰지 않음).
  textSources: TextSource[];
  schoolPrint: string;
  practiceItems: Record<PracticeCategory, NamedItem[]>;
};

export type TextCategory = "교과서" | "부교재" | "모의고사" | "학교프린트";

// 교과서/부교재/모의고사(회차별)/학교프린트(건별) — 다루는 "텍스트" 하나하나가
// 이 타입 인스턴스 하나다. 텍스트를 하나 잡으면 워크북 9단계(8단계+변형문제)와
// 그 텍스트 범위의 단어암기를 반드시 마쳐야 한다는 게 실제 학원 운영 규칙이라,
// 텍스트 종류에 상관없이 모든 텍스트가 이 두 체크리스트를 달고 다닌다.
export type TextSource = {
  id: string;
  category: TextCategory;
  label: string; // 텍스트 이름 — 고등은 "능률(김성곤)"처럼 교재명, 중등은 "1과"처럼 과 이름
  detail: string; // 부가정보 — 고등은 범위/출처, 중등은 교재명/범위
  steps: NamedItem[]; // 워크북 9단계(WORKBOOK_STEP_LABELS 고정) — 이 텍스트에서 반드시 거쳐야 하는 공정
  vocab: NamedItem[]; // 이 텍스트 범위의 단어암기 체크리스트(범위별로 자유롭게 추가)
  memo: string;
  // 중등 교과서/부교재의 과(Lesson) 전용 필드 — 고등에서는 쓰지 않는다.
  bodyMemorized?: boolean;
  dialogueMemorized?: boolean;
  achievement?: string;
};

export type HighData = {
  textSources: TextSource[]; // 교과서/부교재/모의고사/학교프린트 전부 이 배열 하나로 관리
  textAnalysisProgress: string; // 본문분석 및 진도
};

export type ExamPrepData =
  | { level: "중등"; middle: MiddleData }
  | { level: "고등"; high: HighData };

export type ExamPrepSheet = {
  id: string | null;
  studentId: string;
  studentName: string;
  school: string;
  grade: string | null;
  level: SchoolLevel;
  examTitle: string;
  examRange: string;
  examDate: string | null;
  teachers: string[];
  progress: number;
  weakPoints: string;
  updatedAt: string | null;
  data: ExamPrepData;
};

// 같은 학교+학년 학생들 사이에서 시험대비명/교과서/부교재/학교프린트/시험범위
// 표기가 제각각이 되지 않도록, 이미 입력된 값들을 모아 자동입력/자동완성에
// 쓰는 응답 형태. getExamPrepTemplate(lib/notion.ts)이 채워준다.
export type ExamPrepTemplate = {
  level: SchoolLevel;
  latest: {
    examTitle: string;
    examRange: string;
    teachers: string[];
    textbook: string;
    supplementary: string;
    schoolPrint: string;
  };
  examTitleOptions: string[];
  examRangeOptions: string[];
  textbookOptions: string[];
  supplementaryOptions: string[];
  schoolPrintOptions: string[];
  schoolPrintItemLabels: string[];
} | null;

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function namedItem(label: string): NamedItem {
  return { id: makeId(), label, detail: "", done: false, memo: "" };
}

// 워크북 8단계 + 변형문제 = 텍스트 하나당 반드시 거쳐야 하는 9단계 공정.
export const WORKBOOK_STEP_LABELS = ["영어빈칸", "동사형", "어법", "순서배열", "영작", "주제문", "제목", "요약문", "변형문제"];
export const TEXT_CATEGORIES: TextCategory[] = ["교과서", "부교재", "모의고사", "학교프린트"];
export const MIDDLE_TEXT_CATEGORIES: TextCategory[] = ["교과서", "부교재"];

export function emptyPracticeItems(): Record<PracticeCategory, NamedItem[]> {
  const obj = {} as Record<PracticeCategory, NamedItem[]>;
  for (const cat of MIDDLE_PRACTICE_CATEGORIES) obj[cat] = [];
  return obj;
}

export function defaultMiddleData(): MiddleData {
  return { textSources: [], schoolPrint: "", practiceItems: emptyPracticeItems() };
}

export function newTextSource(category: TextCategory, label = ""): TextSource {
  return {
    id: makeId(),
    category,
    label,
    detail: "",
    steps: WORKBOOK_STEP_LABELS.map(namedItem),
    vocab: [],
    memo: "",
  };
}

// 중등 교과서/부교재의 과(Lesson) 하나 — newTextSource에 본문암기/대화문암기/
// 성취도 필드를 얹는다.
export function newMiddleTextSource(category: TextCategory, label = ""): TextSource {
  return { ...newTextSource(category, label), bodyMemorized: false, dialogueMemorized: false, achievement: "" };
}

export function defaultHighData(): HighData {
  return { textSources: [], textAnalysisProgress: "" };
}

export function defaultDataFor(level: SchoolLevel): ExamPrepData {
  return level === "중등" ? { level, middle: defaultMiddleData() } : { level, high: defaultHighData() };
}

export function newNamedItem(): NamedItem {
  return namedItem("");
}

export type CategoryBreakdown = { label: string; done: number; total: number };

// 항목 그룹별(Lesson 암기/연습문제, 또는 기출모의고사/워크북 등) 완료 개수 —
// 전체 진행률 하나만으로는 "어느 영역이 약한지"가 안 보여서, 현황판과
// 학생 히스토리에서 그룹별로 따로 노출한다.
export function computeCategoryBreakdown(data: ExamPrepData): CategoryBreakdown[] {
  if (data.level === "중등") {
    // 고등과 동일하게 교과서/부교재 카테고리별 워크북 9단계를 합산하고,
    // 과(Lesson)의 본문암기/대화문암기, 단어암기, 내신대비 5종은 각각
    // 별도 그룹으로 보여준다.
    const byCategory = MIDDLE_TEXT_CATEGORIES.map((cat) => {
      const steps = data.middle.textSources.filter((t) => t.category === cat).flatMap((t) => t.steps);
      return { label: cat, done: steps.filter((s) => s.done).length, total: steps.length };
    });
    const middleSources = data.middle.textSources;
    const lessonDone = middleSources.reduce(
      (sum, t) => sum + (t.bodyMemorized ? 1 : 0) + (t.dialogueMemorized ? 1 : 0),
      0
    );
    const vocabAll = middleSources.flatMap((t) => t.vocab);
    const practiceAll = MIDDLE_PRACTICE_CATEGORIES.flatMap((cat) => data.middle.practiceItems[cat]);
    return [
      ...byCategory,
      { label: "과별 암기", done: lessonDone, total: middleSources.length * 2 },
      { label: "단어암기", done: vocabAll.filter((v) => v.done).length, total: vocabAll.length },
      { label: "내신대비", done: practiceAll.filter((i) => i.done).length, total: practiceAll.length },
    ];
  }
  // 텍스트(교과서/부교재/모의고사/학교프린트) 카테고리별로 워크북 9단계를
  // 합산해서 보여주고, 단어암기는 텍스트 종류와 무관하게 전체 합산 하나로.
  const byCategory = TEXT_CATEGORIES.map((cat) => {
    const steps = data.high.textSources.filter((t) => t.category === cat).flatMap((t) => t.steps);
    return { label: cat, done: steps.filter((s) => s.done).length, total: steps.length };
  });
  const vocabAll = data.high.textSources.flatMap((t) => t.vocab);
  return [...byCategory, { label: "단어암기", done: vocabAll.filter((v) => v.done).length, total: vocabAll.length }];
}

// 0~100 진행률 — computeCategoryBreakdown의 그룹별 완료/전체를 모두 합산한
// 비율. 텍스트 필드(진도/메모 등)는 진행률에 반영하지 않는다.
export function computeProgress(data: ExamPrepData): number {
  const categories = computeCategoryBreakdown(data);
  const total = categories.reduce((sum, c) => sum + c.total, 0);
  const done = categories.reduce((sum, c) => sum + c.done, 0);
  if (total === 0) return 0;
  return Math.round((done / total) * 100);
}

export function joinTeachers(teachers: string[]): string {
  return teachers.map((t) => t.trim()).filter(Boolean).join(", ");
}

export function splitTeachers(raw: string): string[] {
  return raw
    ? raw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
}

// DB②학년(중1~고3)에서 중/고 구분만 뽑아낸다. 초등학생은 시험대비 대상이
// 아니므로 null.
export function levelFromGrade(grade: string | null): SchoolLevel | null {
  if (!grade) return null;
  if (grade.startsWith("중")) return "중등";
  if (grade.startsWith("고")) return "고등";
  return null;
}
