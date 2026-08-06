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

export function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일(${weekday})`;
}
