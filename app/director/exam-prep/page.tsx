import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import ExamPrepClient from "@/components/ExamPrepClient";
import { todayKST, formatDateLabel } from "@/lib/date";

export default async function DirectorExamPrepPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/director/exam-prep");
  if (session.role !== "원장") redirect("/dashboard");

  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";

  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName={branchName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DirectorTopbar staffName={session.name} role={session.role ?? ""} dateLabel={formatDateLabel(todayKST())} />

        <main className="flex-1 overflow-y-auto bg-muted/50 py-6">
          <ExamPrepClient />
        </main>
      </div>
    </div>
  );
}
