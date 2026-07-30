// Shared by the server (actual DB⑤ content) and the client (preview modal)
// so the saved text always matches what the teacher reviewed before saving.
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function formatBriefingText(input: {
  date: string; // YYYY-MM-DD
  className: string;
  studentName: string;
  progress: string;
  homework: string;
  nextAssignment: string;
  notice: string;
  vocabFail: boolean;
  homeworkIncomplete: boolean;
}): string {
  const [y, m, d] = input.date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const lines = [
    `안녕하세요. 이그잼영어학원입니다. ${m}/${d}(${weekday}) ${input.className} ${input.studentName} 학생 데일리브리핑입니다.`,
    "",
    `- 진도: ${input.progress || "-"}`,
    `- 과제: ${input.homework || "-"}`,
    `- 다음시간 과제: ${input.nextAssignment || "-"}`,
    `- 단어테스트: ${input.vocabFail ? "미통과 (재시험 필요)" : "통과"}`,
    `- 과제 수행: ${input.homeworkIncomplete ? "미완료" : "완료"}`,
  ];
  if (input.notice) lines.push(`- 전달사항: ${input.notice}`);
  return lines.join("\n");
}
