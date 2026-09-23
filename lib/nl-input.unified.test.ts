// runUnifiedNlInput의 오케스트레이션 로직(다중 intent 분리, query/verify와
// 업무생성 구분, intent별 실패 격리)을 검증한다. 실제 LLM/Notion/Postgres는
// 전부 mock — 여기서 보는 건 "파싱 결과를 받아서 올바른 곳으로 라우팅하고,
// 하나가 실패해도 나머지는 계속 처리하는가"이다. staff.md PART 8 참고.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnifiedIntent } from "@/lib/anthropic";

vi.mock("@/lib/anthropic", () => ({
  parseUnifiedInput: vi.fn(),
}));

vi.mock("@/lib/notion", () => ({
  createAdminInboxEntry: vi.fn(),
  createScheduleEntry: vi.fn(),
  createCounselingEntry: vi.fn(),
  updateStudentInfo: vi.fn(),
  createMinimalStudent: vi.fn(),
  createTasks: vi.fn(),
  getNlRoster: vi.fn(),
  getAttendanceOnDate: vi.fn(),
}));

import { parseUnifiedInput } from "@/lib/anthropic";
import {
  createAdminInboxEntry,
  createCounselingEntry,
  createTasks,
  getAttendanceOnDate,
  getNlRoster,
} from "@/lib/notion";
import { runUnifiedNlInput } from "@/lib/nl-input";

const roster = {
  students: [
    { id: "s-김정우", name: "김정우", school: "천재중", grade: null, status: "재원", classIds: ["c-1"] },
    { id: "s-신융", name: "신융", school: "천재중", grade: null, status: "재원", classIds: ["c-1"] },
    { id: "s-허준혁", name: "허준혁", school: "천재중", grade: null, status: "재원", classIds: ["c-1"] },
  ],
  classes: [{ id: "c-1", name: "영어2 천재조", teachers: [], dayTeachers: {}, days: [], time: "", level: "", type: "", studentIds: [], assistantIds: [] }],
  staff: [{ id: "st-1", name: "김조교", role: "조교", workHours: {} }],
};

function intent(partial: Partial<UnifiedIntent>): UnifiedIntent {
  return { route: "clarify", students: [], instruction: "", ...partial } as UnifiedIntent;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getNlRoster).mockResolvedValue(roster as any);
});

describe("runUnifiedNlInput — multi-intent 분리", () => {
  it("한 문장에서 나온 여러 intent를 각각 독립적으로 처리한다(업무 1건 + 결석확인 1건)", async () => {
    vi.mocked(parseUnifiedInput).mockResolvedValue([
      intent({ route: "task", taskType: "암기확인", students: ["김정우", "신융", "허준혁"], instruction: "3과 예상문제 출력", quantity: 3, material: "부교재" }),
      intent({ route: "attendance_check", students: ["김정우"], instruction: "결석 확인" }),
    ]);
    vi.mocked(createTasks).mockResolvedValue([{ id: "t-1", type: "MEMORIZATION_CHECK", ownerId: null, pool: true }] as any);
    vi.mocked(getAttendanceOnDate).mockResolvedValue({ hasRecord: true, attendance: "결석" });

    const result = await runUnifiedNlInput(
      "김정우, 신융, 허준혁 영어2 천재조 3과 예상문제, 부교재 변형문제 출처 찾아서 출력 3부 오류 생김, 김정우 결석 입력했음 확인해줘"
    );

    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes.find((o) => o.route === "task")?.status).toBe("완료");
    expect(result.outcomes.find((o) => o.route === "attendance_check")?.status).toBe("완료");
    // 업무 생성은 intent 개수와 무관하게 createTasks 한 번으로 배치 처리된다.
    expect(createTasks).toHaveBeenCalledTimes(1);
  });

  it("업무 intent에 여러 학생이 묶이면 studentIds 배열로 함께 전달한다(3명이 같은 업무 공유)", async () => {
    vi.mocked(parseUnifiedInput).mockResolvedValue([
      intent({ route: "task", taskType: "출력", students: ["김정우", "신융", "허준혁"], instruction: "출력", quantity: 3 }),
    ]);
    vi.mocked(createTasks).mockResolvedValue([{ id: "t-1", type: "PRINT", ownerId: null, pool: true }] as any);

    await runUnifiedNlInput("셋 다 출력 3부 해줘");

    const [inputs] = vi.mocked(createTasks).mock.calls[0];
    expect(inputs[0].studentIds).toEqual(["s-김정우", "s-신융", "s-허준혁"]);
  });
});

describe("runUnifiedNlInput — query/verify는 업무 생성이 아니다", () => {
  it("결석 확인 요청은 createTasks/createAdminInboxEntry를 전혀 호출하지 않고 실제 기록을 조회한다", async () => {
    vi.mocked(parseUnifiedInput).mockResolvedValue([intent({ route: "attendance_check", students: ["김정우"], instruction: "결석 확인" })]);
    vi.mocked(getAttendanceOnDate).mockResolvedValue({ hasRecord: false, attendance: null });

    const result = await runUnifiedNlInput("김정우 결석 입력했음 확인해줘");

    expect(createTasks).not.toHaveBeenCalled();
    expect(createAdminInboxEntry).not.toHaveBeenCalled();
    expect(getAttendanceOnDate).toHaveBeenCalledWith("s-김정우", expect.any(String));
    // 기록 자체가 없으면 "완료"로 지어내지 않고 확인이 필요하다고 보고한다.
    expect(result.outcomes[0].status).toBe("확인필요");
  });

  it("학생을 특정 못 하면 조회 자체를 시도하지 않고 실패로 보고한다(추측 저장 금지)", async () => {
    vi.mocked(parseUnifiedInput).mockResolvedValue([intent({ route: "attendance_check", students: ["존재안함"], instruction: "결석 확인" })]);

    const result = await runUnifiedNlInput("존재안함 결석 확인해줘");

    expect(getAttendanceOnDate).not.toHaveBeenCalled();
    expect(result.outcomes[0].status).toBe("실패");
  });
});

describe("runUnifiedNlInput — 암기확인 정상 처리(2026-09-19 사고 회귀 방지)", () => {
  it("암기확인을 알 수 없는 유형으로 거부하지 않고 정상적으로 createTasks에 넘긴다", async () => {
    vi.mocked(parseUnifiedInput).mockResolvedValue([intent({ route: "task", taskType: "암기확인", students: ["김정우"], instruction: "암기 확인" })]);
    vi.mocked(createTasks).mockResolvedValue([{ id: "t-1", type: "MEMORIZATION_CHECK", ownerId: null, pool: false }] as any);

    const result = await runUnifiedNlInput("김정우 암기확인 해줘");

    expect(result.ok).toBe(true);
    const [inputs] = vi.mocked(createTasks).mock.calls[0];
    expect(inputs[0].type).toBe("MEMORIZATION_CHECK");
  });
});

describe("runUnifiedNlInput — intent.className을 기존 class_notion_ids relation으로 resolve", () => {
  it("반 이름이 언급되면 roster에 있는 반 id로 resolve해 classIds로 전달한다", async () => {
    vi.mocked(parseUnifiedInput).mockResolvedValue([
      intent({ route: "task", taskType: "출력", students: ["김정우"], instruction: "출력", className: "천재조" }),
    ]);
    vi.mocked(createTasks).mockResolvedValue([{ id: "t-1", type: "PRINT", ownerId: null, pool: true }] as any);

    await runUnifiedNlInput("김정우 천재조 출력해줘");

    const [inputs] = vi.mocked(createTasks).mock.calls[0];
    expect(inputs[0].classIds).toEqual(["c-1"]);
  });

  it("roster(현재 branch)에 없는 반 이름은 다른 반으로 잘못 매칭하지 않고 classIds를 비워둔다(cross-branch 차단)", async () => {
    vi.mocked(parseUnifiedInput).mockResolvedValue([
      intent({ route: "task", taskType: "출력", students: ["김정우"], instruction: "출력", className: "다른지점반" }),
    ]);
    vi.mocked(createTasks).mockResolvedValue([{ id: "t-1", type: "PRINT", ownerId: null, pool: true }] as any);

    await runUnifiedNlInput("김정우 다른지점반 출력해줘");

    const [inputs] = vi.mocked(createTasks).mock.calls[0];
    expect(inputs[0].classIds).toBeUndefined();
  });

  it("여러 intent가 섞여도 각 intent의 className이 서로 섞이지 않는다", async () => {
    vi.mocked(parseUnifiedInput).mockResolvedValue([
      intent({ route: "task", taskType: "출력", students: ["김정우"], instruction: "출력", className: "천재조" }),
      intent({ route: "task", taskType: "전달", students: ["신융"], instruction: "전달", className: "" }),
    ]);
    vi.mocked(createTasks).mockResolvedValue([
      { id: "t-1", type: "PRINT", ownerId: null, pool: true },
      { id: "t-2", type: "DELIVERY", ownerId: null, pool: true },
    ] as any);

    await runUnifiedNlInput("김정우 천재조 출력해줘, 신융 전달해줘");

    const [inputs] = vi.mocked(createTasks).mock.calls[0];
    expect(inputs[0].classIds).toEqual(["c-1"]);
    expect(inputs[1].classIds).toBeUndefined();
  });
});

describe("runUnifiedNlInput — 부분 실패 격리 (전체 500 방지)", () => {
  it("한 intent가 예외를 던져도 나머지 intent는 계속 처리된다", async () => {
    vi.mocked(parseUnifiedInput).mockResolvedValue([
      intent({ route: "admin_inbox", inboxType: "기타", students: [], instruction: "문의 A" }),
      intent({ route: "counseling", students: ["김정우"], instruction: "상담 내용", counselor: "김조교" }),
    ]);
    vi.mocked(createAdminInboxEntry).mockRejectedValue(new Error("Notion 500"));
    vi.mocked(createCounselingEntry).mockResolvedValue(undefined as any);

    const result = await runUnifiedNlInput("문의 A 행정실에 전달해줘. 그리고 김정우 상담 내용");

    expect(result.ok).toBe(false);
    expect(result.outcomes.find((o) => o.route === "admin_inbox")?.status).toBe("실패");
    expect(result.outcomes.find((o) => o.route === "counseling")?.status).toBe("완료");
  });

  it("clarify intent는 아무 것도 저장하지 않고 확인필요로만 보고한다", async () => {
    vi.mocked(parseUnifiedInput).mockResolvedValue([intent({ route: "clarify", message: "무슨 말인지 모르겠습니다" })]);

    const result = await runUnifiedNlInput("ㅁㄴㅇㄹ");

    expect(result.outcomes[0].status).toBe("확인필요");
    expect(createTasks).not.toHaveBeenCalled();
    expect(createAdminInboxEntry).not.toHaveBeenCalled();
  });

  it("AI 호출 자체가 실패해도 500 대신 실패 outcome 하나로 응답한다", async () => {
    vi.mocked(parseUnifiedInput).mockRejectedValue(new Error("anthropic timeout"));

    const result = await runUnifiedNlInput("아무 문장");

    expect(result.ok).toBe(false);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].status).toBe("실패");
  });
});
