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
