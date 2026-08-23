import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import StudentReportsClient from "@/components/director/StudentReportsClient";
import { todayKST, formatDateLabel } from "@/lib/date";

export default async function DirectorReportsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/director/reports");
  if (!session.role || !["원장", "행정"].includes(session.role)) redirect("/dashboard");

  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";

  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName={branchName} role={session.role ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DirectorTopbar
          staffName={session.name}
          role={session.role ?? ""}
          dateLabel={formatDateLabel(todayKST())}
          greetingTitle="학생 리포트"
          greetingText="기간을 정하고 반·학교·학생 단위로 학부모 발송용 학습현황 리포트를 만드세요."
        />

        <main className="flex-1 overflow-y-auto bg-muted/50 px-6 py-6">
          <StudentReportsClient />
        </main>
      </div>
    </div>
  );
}
