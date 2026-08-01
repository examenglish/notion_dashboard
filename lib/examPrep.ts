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

export type LessonItem = {
  id: string;
  name: string; // Lesson명 (예: "1과")
  bodyMemorized: boolean; // 본문암기여부
  dialogueMemorized: boolean; // 대화문암기여부
  achievement: string; // 성취도 (상/중/하 등)
  progress: string; // 진도사항 메모
};

export type MiddleData = {
  textbook: string;
  supplementary: string;
  schoolPrint: string;
  lessons: LessonItem[];
  practiceItems: NamedItem[]; // 자주틀리는문제/기출문제/추가문제/백발백중/적중백
};

export type HighData = {
  textbook: string;
  supplementary: string;
  mockExams: NamedItem[]; // 기출모의고사
  mockExams2: NamedItem[]; // 기출모의고사2
  schoolPrints: NamedItem[]; // 학교프린트(출처)
  vocabItems: NamedItem[]; // 해당범위당 단어암기
  textAnalysisProgress: string; // 본문분석 및 진도
  workbook: NamedItem[]; // 워크북 (영어빈칸/동사형/어법/순서배열/영작/주제문/제목/요약문)
  transformedProblems: NamedItem[]; // 변형문제
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
  teacher: string;
  progress: number;
  weakPoints: string;
  updatedAt: string | null;
  data: ExamPrepData;
};

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function namedItem(label: string): NamedItem {
  return { id: makeId(), label, detail: "", done: false, memo: "" };
}

export const MIDDLE_PRACTICE_LABELS = ["자주 틀리는 문제", "기출문제", "추가문제", "백발백중", "적중백"];
export const HIGH_WORKBOOK_LABELS = ["영어빈칸", "동사형", "어법", "순서배열", "영작", "주제문", "제목", "요약문"];

export function defaultMiddleData(): MiddleData {
  return {
    textbook: "",
    supplementary: "",
    schoolPrint: "",
    lessons: [],
    practiceItems: MIDDLE_PRACTICE_LABELS.map(namedItem),
  };
}

export function defaultHighData(): HighData {
  return {
    textbook: "",
    supplementary: "",
    mockExams: [],
    mockExams2: [],
    schoolPrints: [],
    vocabItems: [],
    textAnalysisProgress: "",
    workbook: HIGH_WORKBOOK_LABELS.map(namedItem),
    transformedProblems: [],
  };
}

export function defaultDataFor(level: SchoolLevel): ExamPrepData {
  return level === "중등" ? { level, middle: defaultMiddleData() } : { level, high: defaultHighData() };
}

export function newLesson(): LessonItem {
  return { id: makeId(), name: "", bodyMemorized: false, dialogueMemorized: false, achievement: "", progress: "" };
}

export function newNamedItem(): NamedItem {
  return namedItem("");
}

// 0~100 진행률 — Lesson 암기 체크(본문/대화문 각 1개) + 각 리스트의 완료 체크
// 총합 대비 완료 개수 비율. 텍스트 필드(진도/메모 등)는 진행률에 반영하지 않는다.
export function computeProgress(data: ExamPrepData): number {
  let done = 0;
  let total = 0;
  if (data.level === "중등") {
    for (const l of data.middle.lessons) {
      total += 2;
      if (l.bodyMemorized) done += 1;
      if (l.dialogueMemorized) done += 1;
    }
    total += data.middle.practiceItems.length;
    done += data.middle.practiceItems.filter((i) => i.done).length;
  } else {
    const lists = [
      data.high.mockExams,
      data.high.mockExams2,
      data.high.schoolPrints,
      data.high.vocabItems,
      data.high.workbook,
      data.high.transformedProblems,
    ];
    for (const list of lists) {
      total += list.length;
      done += list.filter((i) => i.done).length;
    }
  }
  if (total === 0) return 0;
  return Math.round((done / total) * 100);
}

// DB②학년(중1~고3)에서 중/고 구분만 뽑아낸다. 초등학생은 시험대비 대상이
// 아니므로 null.
export function levelFromGrade(grade: string | null): SchoolLevel | null {
  if (!grade) return null;
  if (grade.startsWith("중")) return "중등";
  if (grade.startsWith("고")) return "고등";
  return null;
}
