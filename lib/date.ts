// Server and client both need "today" to mean the same calendar day in
// Korea, regardless of the machine's local timezone (a cloud server often
// runs in UTC, which is 9 hours behind KST — using new Date().toISOString()
// there would call it "yesterday" until 9am KST). Safe to import from both
// server and client code: it only uses Intl, no Node-only APIs.
const KST_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function todayKST(): string {
  return KST_FORMATTER.format(new Date()); // en-CA => YYYY-MM-DD
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// Pure calendar-date arithmetic (via Date.UTC) so this never depends on the
// browser's or server's local timezone — only on the Y/M/D digits themselves.
export function shiftDate(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// 오늘(KST)부터 dateStr까지 남은 날짜 수 — 미래면 양수, 지났으면 음수, 오늘이면 0.
export function daysUntilKST(dateStr: string): number {
  const [y1, m1, d1] = todayKST().split("-").map(Number);
  const [y2, m2, d2] = dateStr.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000);
}

export function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일(${weekday})`;
}
