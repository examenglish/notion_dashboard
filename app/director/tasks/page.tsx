import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { todayKST, formatDateLabel } from "@/lib/date";
import { listMyTasks, listPoolTasks, listReviewInbox, getBasicChecklist, listStaff } from "@/lib/notion";
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import TaskBoardClient from "@/components/director/TaskBoardClient";

export default async function DirectorTasksPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/director/tasks");
  if (!session.role || !["원장", "행정", "강사", "조교"].includes(session.role)) redirect("/dashboard");

  const today = todayKST();
  const isManager = session.role === "원장" || session.role === "행정";
  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";

  const [myTasks, poolTasks, checklist, reviewInbox, staffList] = await Promise.all([
    listMyTasks(session.staffId),
    listPoolTasks(),
    getBasicChecklist(session.staffId, today),
    isManager ? listReviewInbox() : Promise.resolve([]),
    listStaff(),
  ]);

  const me = staffList.find((s) => s.id === session.staffId) ?? null;

  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName={branchName} role={session.role ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DirectorTopbar
          staffName={session.name}
          role={session.role ?? ""}
          dateLabel={formatDateLabel(today)}
          greetingTitle="내 업무"
          greetingText="지금 할 일부터 확인하세요."
        />
        <main className="flex-1 overflow-y-auto bg-muted/50 px-6 py-5">
          <TaskBoardClient
            today={today}
            role={session.role ?? ""}
            staffId={session.staffId}
            staffName={session.name}
            workHours={me?.workHours ?? {}}
            myTasks={myTasks}
            poolTasks={poolTasks}
            checklist={checklist}
            reviewInbox={reviewInbox}
            isManager={isManager}
          />
        </main>
      </div>
    </div>
  );
}
