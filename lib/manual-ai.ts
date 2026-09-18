import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./anthropic";

// Server-only. Never import this file from a "use client" component.
if (typeof window !== "undefined") {
  throw new Error("lib/manual-ai.ts must only be used on the server");
}

// 화면녹화 AI 매뉴얼(섹션16~21) — 음성 없이 화면(key frame)만 분석한다(사용자
// 결정 사항). key frame 추출 자체는 브라우저에서(캔버스로 픽셀 diff 기반
// 샘플링) 이뤄지고, 여기는 그렇게 뽑힌 스크린샷들의 URL만 받아 AI로 단계별
// 매뉴얼 초안을 만든다. 관리자 검토 전까지는 절대 게시되지 않는다(섹션21).
const MANUAL_MODEL = "claude-sonnet-5";

export type ManualStepDraft = {
  frameIndex: number;
  title: string;
  description: string;
  warning: string;
  relatedPath: string;
};

const ANALYZE_TOOL: Anthropic.Tool = {
  name: "manual_steps",
  description: "화면녹화에서 추출한 스크린샷들을 보고, 직원이 그대로 따라할 수 있는 단계별 매뉴얼을 만든다.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "이 작업이 전체적으로 무엇을 하는 과정인지 한두 문장 요약" },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            frameIndex: { type: "number", description: "이 단계를 가장 잘 보여주는 스크린샷의 순번(0부터). 비슷한 프레임은 하나로 묶는다." },
            title: { type: "string", description: "이 단계의 제목 (예: 'AI 업무지시 입력')" },
            description: { type: "string", description: "무엇을 클릭/입력하는지 구체적으로 설명. 학생 개인정보(이름/연락처/성적)가 화면에 보여도 그대로 옮기지 말고 '학생 정보'처럼 일반화해서 쓴다." },
            warning: { type: "string", description: "주의할 점이 있으면 적는다. 없으면 빈 문자열." },
            relatedPath: { type: "string", description: "이 화면의 URL 경로로 추정되는 값(예: /director/tasks). 모르면 빈 문자열." },
          },
          required: ["frameIndex", "title", "description"],
        },
      },
    },
    required: ["summary", "steps"],
  },
};

export async function analyzeManualFrames(
  frames: { timestamp: string; url: string }[]
): Promise<{ summary: string; steps: ManualStepDraft[] }> {
  if (frames.length === 0) return { summary: "", steps: [] };

  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text: "아래는 학원관리 웹앱 화면녹화에서 화면이 의미 있게 바뀌는 지점마다 뽑은 스크린샷들이다. 순서대로 번호가 붙어 있다. 비슷하거나 의미 없는 전환 프레임은 단계로 만들지 않는다.",
    },
    ...frames.flatMap((f, i): Anthropic.ContentBlockParam[] => [
      { type: "text", text: `--- 스크린샷 ${i} (영상 ${f.timestamp}) ---` },
      { type: "image", source: { type: "url", url: f.url } },
    ]),
  ];

  const res = await anthropic.messages.create({
    model: MANUAL_MODEL,
    max_tokens: 4096,
    system:
      "너는 영어학원 관리 시스템의 직원 교육 매뉴얼을 만드는 도우미다. 화면 상태가 의미 있게 바뀌는 스크린샷만 골라 단계로 묶는다.",
    tools: [ANALYZE_TOOL],
    tool_choice: { type: "tool", name: "manual_steps" },
    messages: [{ role: "user", content }],
  });

  const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) return { summary: "", steps: [] };
  const input = toolUse.input as { summary?: string; steps?: ManualStepDraft[] };
  return { summary: input.summary ?? "", steps: input.steps ?? [] };
}
