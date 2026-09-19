import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { todayKST, formatDateLabel } from "@/lib/date";
import { getManual, listManualSteps } from "@/lib/notion";
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import ManualReviewClient from "@/components/manuals/ManualReviewClient";

export default async function ManualReviewPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect(`/login?next=/director/manuals/${params.id}/review`);
  if (!session.role || !["원장", "행정", "강사", "조교"].includes(session.role)) redirect("/dashboard");

  const manual = await getManual(params.id);
  if (!manual) notFound();
  if (manual.status !== "PUBLISHED" && session.role === "조교") redirect("/director/manuals");

  const steps = await listManualSteps(params.id);
  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";

  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName={branchName} role={session.role ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DirectorTopbar
          staffName={session.name}
          role={session.role ?? ""}
          branchName={branchName}
          dateLabel={formatDateLabel(todayKST())}
          greetingTitle="매뉴얼 검토"
          greetingText={manual.title}
        />
        <main className="flex-1 overflow-y-auto bg-muted/50 px-6 py-5">
          <ManualReviewClient manual={manual} steps={steps} role={session.role ?? ""} />
        </main>
      </div>
    </div>
  );
}
