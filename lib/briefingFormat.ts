// Shared by the server (actual DB⑤ content) and the client (preview modal)
// so the saved text always matches what the teacher reviewed before saving.
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 학생별 체크 표의 테스트/과제 점수 한 건 — 항목명 + 자유입력 값("8/10",
// 시험을 안 봤으면 "미응시" 그대로). 서버 쪽(AchievementScore={type,
// correct,total})과 클라이언트 쪽(InputClient의 ScoreEntry={type,raw})
// 두 shape을 각자 호출부에서 이 공통 형태로 맞춰 넘긴다 — 포맷팅 로직은
// 여기 한 곳에만 둔다.
export type BriefingScoreEntry = { type: string; raw: string };

// "8/10"을 브리핑에 그대로 적으면 강사들이 날짜(8월10일)로 오해하기 쉬워서
// 끝에 "점" 단위를 붙여 "8/10점"으로 바꾼다. "미응시"는 그대로 표시하고,
// 슬래시 없이 숫자만 입력된 경우("8")는 "8점"으로 표시한다.
function formatScoreValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed === "미응시") return "미응시";
  const [a, b] = trimmed.split("/");
  if (b) return `${a}/${b}점`;
  return /^\d+$/.test(a) ? `${a}점` : trimmed;
}

function formatScoreLines(scores?: BriefingScoreEntry[]): string[] {
  if (!scores || scores.length === 0) return [];
  const rows = scores.filter((s) => s.raw.trim() !== "").map((s) => `${s.type}: ${formatScoreValue(s.raw)}`);
  if (rows.length === 0) return [];
  return ["", "【테스트/과제 결과】", ...rows];
}

// 같은 반을 같은 날 교시로 나눠 기록할 때(1·2교시 또는 1·2·3교시) 앞 교시에
// 이미 저장된 진도/과제를 함께 넘기면 마지막 교시 브리핑 하나로 통합한다.
export type BriefingPeriodSection = { period: string; subjects?: string[]; progress: string; homework: string; nextAssignment?: string; notice?: string };

function subjectLines(sections: BriefingPeriodSection[]): string[] {
  return sections.filter((s) => s.subjects?.length).map((s) => `${s.period}: ${s.subjects!.join(", ")}`);
}

function periodLines(sections: BriefingPeriodSection[], key: "progress" | "homework"): string[] {
  const rows = sections.filter((s) => s[key].trim()).map((s) => `${s.period}: ${s[key].trim()}`);
  return rows.length ? rows : ["-"];
}

export function formatBriefingText(input: {
  date: string; // YYYY-MM-DD
  className: string;
  studentName: string;
  subjects?: string[];
  progress: string;
  homework: string;
  nextAssignment: string;
  notice: string;
  vocabFail: boolean;
  homeworkIncomplete: boolean;
  absent: boolean;
  individualNotice?: string;
  scores?: BriefingScoreEntry[];
  periodSections?: BriefingPeriodSection[];
}): string {
  const merged = input.periodSections && input.periodSections.length > 1 ? input.periodSections : null;
  const [y, m, d] = input.date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const lines = [
    `안녕하세요. 이그잼영어학원입니다. ${m}/${d}(${weekday}) ${input.className} ${input.studentName} 학생 데일리브리핑입니다.`,
  ];
  const subjects = merged ? subjectLines(merged) : input.subjects?.length ? [input.subjects.join(", ")] : [];
  if (subjects.length) lines.push("", "【수업과목】", ...subjects);
  lines.push(
    "",
    "【진도】",
    ...(merged ? periodLines(merged, "progress") : [input.progress || "-"]),
    "",
    "【과제】",
    ...(merged ? periodLines(merged, "homework") : [input.homework || "-"])
  );
  const nextAssignment = merged
    ? merged.map((s) => s.nextAssignment?.trim()).filter(Boolean).join(" / ")
    : input.nextAssignment;
  if (nextAssignment) {
    lines.push("", "【다음시간 테스트】", nextAssignment);
  }
  if (input.absent) {
    lines.push("", "출결: 결석");
  } else {
    lines.push(
      "",
      `단어테스트: ${input.vocabFail ? "미통과 (재시험 필요)" : "통과"}`,
      `과제 수행: ${input.homeworkIncomplete ? "미완료" : "완료"}`
    );
  }
  lines.push(...formatScoreLines(input.scores));
  const notice = merged ? Array.from(new Set(merged.map((s) => s.notice?.trim()).filter(Boolean))).join(" / ") : input.notice;
  if (notice) lines.push(`전달사항: ${notice}`);
  if (input.individualNotice) lines.push(`개별 안내사항: ${input.individualNotice}`);
  return lines.join("\n");
}
