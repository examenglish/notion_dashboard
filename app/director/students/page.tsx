import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { searchStudents } from "@/lib/notion";
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import DirectorStudentsClient from "@/components/director/DirectorStudentsClient";
import { todayKST, formatDateLabel } from "@/lib/date";

export default async function DirectorStudentsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/director/students");
  if (session.role !== "원장") redirect("/dashboard");

  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";
  const students = await searchStudents("");

  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName={branchName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DirectorTopbar staffName={session.name} role={session.role ?? ""} dateLabel={formatDateLabel(todayKST())} />

        <main className="flex-1 overflow-y-auto bg-muted/50 px-6 py-6">
          <div className="mb-5">
            <h1 className="text-lg font-bold text-foreground">학생 관리</h1>
            <p className="text-sm text-muted-foreground">재원생 {students.length}명 · 이름으로 검색하거나 이번 달 하위 지표에서 바로 확인하세요.</p>
          </div>

          <DirectorStudentsClient initialStudents={students} staffName={session.name} />
        </main>
      </div>
    </div>
  );
}
