import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import ExamPrepDirectorClient from "@/components/director/ExamPrepDirectorClient";
import { todayKST, formatDateLabel } from "@/lib/date";

export default async function DirectorExamPrepPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/director/exam-prep");
  if (!session.role || !["원장", "행정", "강사", "조교"].includes(session.role)) redirect("/dashboard");

  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";

  return (
    <>
        <DirectorTopbar
          staffName={session.name}
          role={session.role ?? ""}
          branchName={branchName}
          dateLabel={formatDateLabel(todayKST())}
          greetingTitle="시험대비"
          greetingText="학교·학년·학생으로 찾아 시험대비 시트를 작성하세요."
        />

        <main className="flex-1 overflow-y-auto bg-muted/50 px-6 py-6">
          <ExamPrepDirectorClient />
        </main>
    </>
  );
}
