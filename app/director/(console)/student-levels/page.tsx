import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import StudentLevelClient from "@/components/StudentLevelClient";
import { todayKST, formatDateLabel } from "@/lib/date";

export default async function DirectorStudentLevelsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/director/student-levels");
  if (session.role !== "원장") redirect("/dashboard");

  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";

  return (
    <>
        <DirectorTopbar staffName={session.name} role={session.role ?? ""} branchName={branchName} dateLabel={formatDateLabel(todayKST())} />

        <main className="flex-1 overflow-y-auto bg-muted/50 py-6">
          <StudentLevelClient />
        </main>
    </>
  );
}
