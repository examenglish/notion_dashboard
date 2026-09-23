// AI 업무운영 시스템의 순수 도메인 로직(타입/라벨/분류 규칙)만 모아둔 파일.
// Notion 접근은 전부 lib/notion.ts에 두고(이 저장소의 기존 관례), 이 파일은
// 어떤 값이 어떤 의미인지에 대한 규칙만 담아 lib/notion.ts, lib/task-routing.ts,
// 클라이언트 컴포넌트(라벨 표시용) 양쪽에서 그대로 재사용한다.

// DB.TODO의 "유형" select에 추가되는 새 값들. 기존 값(보강/재시/신입생상담/
// 레벨체크/클리닉/복습/개인할일/조치사항)은 건드리지 않고 추가만 한다 —
// Notion select는 새 이름으로 값을 쓰면 옵션이 자동 생성된다.
export type TaskType =
  | "MEMORIZATION_CHECK"
  | "HOMEWORK_CHECK"
  | "VOCAB_RETEST"
  | "RETEST"
  | "PRINT"
  | "DELIVERY"
  | "MATERIAL_COLLECTION"
  | "PARENT_CONTACT"
  | "SUPPLEMENT_TEACHING"
  | "EXAM_RANGE_CHECK"
  | "MATERIAL_PREP"
  | "MATERIAL_EDIT"
  | "COUNSELING_TASK"
  | "GENERAL_TASK";

// select에 실제로 저장되는 한글 값. 화면 표시도 항상 이 라벨을 쓴다.
export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  MEMORIZATION_CHECK: "암기확인",
  HOMEWORK_CHECK: "숙제확인",
  VOCAB_RETEST: "단어재시",
  RETEST: "재시험",
  PRINT: "출력",
  DELIVERY: "전달",
  MATERIAL_COLLECTION: "자료수집",
  PARENT_CONTACT: "학부모연락",
  SUPPLEMENT_TEACHING: "보충지도",
  EXAM_RANGE_CHECK: "시험범위확인",
  MATERIAL_PREP: "자료준비",
  // 교재 제작·편집(시험지·어순배열·빈칸·단어시험·워크북·정답지 제작/수정, PDF/문서 편집,
  // OCR/원문 확인, 검수) — 세부 작업은 업무 내용(memo)에 적는다.
  MATERIAL_EDIT: "교재편집",
  COUNSELING_TASK: "업무상담",
  GENERAL_TASK: "기타업무",
};

export const TASK_TYPES = Object.keys(TASK_TYPE_LABELS) as TaskType[];
export const TASK_TYPE_LABEL_LIST = TASK_TYPES.map((t) => TASK_TYPE_LABELS[t]);

const LABEL_TO_TYPE = new Map(TASK_TYPES.map((t) => [TASK_TYPE_LABELS[t], t]));
export function taskTypeFromLabel(label: string): TaskType | null {
  return LABEL_TO_TYPE.get(label) ?? null;
}

// 공용업무풀 대상(섹션6): 단순 반복 작업만 풀에 올릴 수 있다. 학생관리형
// 업무(암기/숙제/재시험/단어재시/보충지도/학부모연락/업무상담)는 항상
// 담당조교 우선 배정이라 풀 후보에서 제외한다.
export const POOLABLE_TASK_TYPES: TaskType[] = [
  "PRINT",
  "DELIVERY",
  "MATERIAL_COLLECTION",
  "MATERIAL_PREP",
  "MATERIAL_EDIT",
  "EXAM_RANGE_CHECK",
  "GENERAL_TASK",
];

// 업무 Pool(작업 대기열) — 새 DB 필드 없이 업무 유형(tasks.type)에서 결정론적으로 정한다.
// Pool = "담당자 없는(staff 비어있는) 해당 유형 업무들"이고, 직원이 "내가 할게요"로 가져간다.
export type TaskPool = "student" | "material" | "print" | "admin";
export const TASK_POOL_LABELS: Record<TaskPool, string> = {
  student: "학생 관리",
  material: "교재편집",
  print: "출력·배부",
  admin: "행정",
};
const POOL_BY_TYPE: Record<TaskType, TaskPool> = {
  MEMORIZATION_CHECK: "student",
  HOMEWORK_CHECK: "student",
  VOCAB_RETEST: "student",
  RETEST: "student",
  SUPPLEMENT_TEACHING: "student",
  MATERIAL_EDIT: "material",
  MATERIAL_PREP: "material",
  MATERIAL_COLLECTION: "material",
  EXAM_RANGE_CHECK: "material",
  PRINT: "print",
  DELIVERY: "print",
  PARENT_CONTACT: "admin",
  COUNSELING_TASK: "admin",
  GENERAL_TASK: "admin",
};
export function taskPoolOf(type: TaskType | null | undefined): TaskPool {
  return type ? POOL_BY_TYPE[type] ?? "admin" : "admin";
}
// 자동배정 금지 Pool: 직원별 처리 가능 업무(capability) 정보가 없어서, 전문 작업(교재편집)은
// 아무 조교에게나 배정하지 않고 Pool에 남겨 가능한 직원이 가져가게 한다.
export function isAutoAssignablePool(pool: TaskPool): boolean {
  return pool !== "material";
}
export function isPoolableType(type: TaskType): boolean {
  return POOLABLE_TASK_TYPES.includes(type);
}

// 유형별 결과보고 선택지(섹션10). 여기 없는 유형은 기본값(완료)만 쓴다.
const TASK_OUTCOME_OPTIONS: Partial<Record<TaskType, string[]>> = {
  MEMORIZATION_CHECK: ["통과", "부분통과", "미통과"],
  HOMEWORK_CHECK: ["완료", "일부", "미완료"],
  VOCAB_RETEST: ["통과", "미통과"],
  RETEST: ["통과", "미통과"],
  SUPPLEMENT_TEACHING: ["완료", "추가설명필요"],
  PRINT: ["출력완료"],
  DELIVERY: ["전달완료", "전달실패"],
  MATERIAL_COLLECTION: ["완료"],
  MATERIAL_PREP: ["완료"],
  MATERIAL_EDIT: ["완료", "검수 필요"],
  EXAM_RANGE_CHECK: ["확인완료"],
  PARENT_CONTACT: ["통화완료", "부재", "재연락필요"],
  COUNSELING_TASK: ["완료"],
  GENERAL_TASK: ["완료"],
};
const DEFAULT_OUTCOME_OPTIONS = ["완료"];
export function outcomeOptionsFor(type: TaskType): string[] {
  return TASK_OUTCOME_OPTIONS[type] ?? DEFAULT_OUTCOME_OPTIONS;
}

// 섹션11의 NORMAL/REVIEW/URGENT 매핑을 결정론적으로 구현한다. AI가 아니라
// "어떤 결과값이 들어왔는가"만으로 정해지므로 재현 가능하고 원장이 신뢰할 수 있다.
export type FeedbackTier = "NORMAL" | "REVIEW" | "URGENT";

const REVIEW_OUTCOMES = new Set(["부분통과", "미통과", "일부", "미완료", "재연락필요", "전달실패", "추가설명필요"]);

export function classifyFeedback(opts: { outcome: string; urgentFlag?: boolean; repeatFailure?: boolean }): FeedbackTier {
  // 직원이 직접 긴급 표시했거나, 같은 학생·같은 업무유형에서 실패가
  // 반복되면(호출부에서 이전 이력을 조회해 repeatFailure로 전달) URGENT.
  if (opts.urgentFlag || opts.repeatFailure) return "URGENT";
  if (REVIEW_OUTCOMES.has(opts.outcome)) return "REVIEW";
  return "NORMAL";
}

export function isReviewOutcome(outcome: string): boolean {
  return REVIEW_OUTCOMES.has(outcome);
}

export type NewTaskInput = {
  type: TaskType;
  studentId: string | null;
  // 여러 학생이 함께 얽힌 업무(예: "OO,XX,ZZ 셋 다 3과 예상문제 출력")를
  // 한 건으로 묶을 때만 채운다. 있으면 studentId는 그중 대표(routeTask
  // 배정 판단용, 보통 첫 번째)이고 실제 관계 저장은 studentIds 전체를 쓴다.
  studentIds?: string[];
  // 언급된 반(들). tasks.class_notion_ids(기존 컬럼, Notion "관련반" relation
  // 미러)에 그대로 저장 — 새 컬럼 없이 기존 relation 필드 재사용.
  classIds?: string[];
  content: string;
  date: string; // YYYY-MM-DD
  time: string; // "16:00" 또는 빈 문자열
  priority?: "긴급" | "보통";
  parentTaskId?: string | null;
  // 문장에 학생 이름이 있었는데도 누구인지 특정하지 못한 경우(동명이인/
  // 명단에 없음) — routeTask()로 아무 조교에게나 배정하지 않고, 무조건
  // 공용업무풀로 보내 담당자가 직접 학생을 확인하게 한다.
  forcePool?: boolean;
  // "민지에게 ~ 맡겨"처럼 지시자가 담당자를 직접 지정한 경우 — routeTask()
  // 자동배정을 건너뛰고 이 직원에게 바로 배정한다.
  ownerId?: string | null;
  // 지시한 직원 이름(진행현황의 "지시자" 표시용, tasks.source_payload.workflow).
  createdBy?: string;
  // 이 업무를 만든 학생 학습 기록(student_learning_records.id) — 기록↔업무 추적용.
  sourceRecordId?: string;
  // 이 업무보다 먼저 끝나야 하는 업무 id들(예: 교재편집 → 출력). 선행 업무가 끝나기 전엔 시작 불가.
  dependsOn?: string[];
  // 관련 자료/프로젝트 링크(향후 ATF·ExamPrep·생성 파일 연결용). 예: {kind:"atf_project", id, url, label}
  refs?: TaskRef[];
};

export type TaskRef = { kind: string; id?: string; url?: string; label: string };

// 업무 진행 이력 — 새 컬럼/마이그레이션 없이 tasks.source_payload.workflow에
// 병합 저장한다(source_payload.archived와 같은 기존 관례). 완료 여부의 정본은
// 여전히 tasks.complete이고, 여기엔 "누가/언제"만 둔다.
export type TaskWorkflow = {
  createdBy?: string;
  sourceRecordId?: string;
  dependsOn?: string[];
  refs?: TaskRef[];
  // direct=지시자가 담당자 지정, auto=생성 즉시 자동배정, pool_auto=업무풀에
  // 있다가 나중에 자동배정, claim=조교가 업무풀에서 직접 가져감
  assignedVia?: "direct" | "auto" | "pool_auto" | "claim";
  assignedAt?: string;
  assignReason?: string;
  pooledAt?: string;
  startedAt?: string;
  startedBy?: string;
  completedAt?: string;
  completedBy?: string;
  // 근거 학생 기록이 취소/정정돼 업무를 취소로 닫은 경우(complete=true, outcome "취소").
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
};

export type TaskStatus = "업무풀" | "대기" | "진행중" | "완료";

export function taskStatusOf(t: { done: boolean; ownerId: string | null; startedAt?: string | null }): TaskStatus {
  if (t.done) return "완료";
  if (!t.ownerId) return "업무풀";
  return t.startedAt ? "진행중" : "대기";
}
