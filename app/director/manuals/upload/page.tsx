import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { todayKST, formatDateLabel } from "@/lib/date";
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import ManualUploadClient from "@/components/manuals/ManualUploadClient";

export default async function ManualUploadPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/director/manuals/upload");
  if (session.role !== "원장" && session.role !== "행정" && session.role !== "강사") redirect("/director/manuals");

  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";

  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName={branchName} role={session.role ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DirectorTopbar
          staffName={session.name}
          role={session.role ?? ""}
          dateLabel={formatDateLabel(todayKST())}
          greetingTitle="화면녹화로 만들기"
          greetingText="영상을 올리면 AI가 단계별 매뉴얼 초안을 만듭니다."
        />
        <main className="flex-1 overflow-y-auto bg-muted/50 px-6 py-5">
          <ManualUploadClient />
        </main>
      </div>
    </div>
  );
}
