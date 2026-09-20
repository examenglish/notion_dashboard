import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { todayKST, formatDateLabel } from "@/lib/date";
import { listMyTasks, listPoolTasks, listReviewInbox, getBasicChecklist, listStaff, type TaskRecord } from "@/lib/notion";
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import TaskBoardClient from "@/components/director/TaskBoardClient";
import AdminSetupButton from "@/components/AdminSetupButton";

export default async function DirectorTasksPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/director/tasks");
  if (!session.role || !["원장", "행정", "강사", "조교"].includes(session.role)) redirect("/dashboard");

  const today = todayKST();
  const isManager = session.role === "원장" || session.role === "행정";
  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";

  // "업무풀"/"원장확인" 등은 원장이 /api/admin/setup을 아직 실행하지 않았으면
  // Notion DB에 없는 속성이라 그 속성으로 필터링하는 쿼리 자체가 실패한다 —
  // 화면이 통째로 깨지는 대신 설정 안내(+원장이면 바로 실행 버튼)를 보여준다.
  let myTasks: TaskRecord[] = [];
  let poolTasks: TaskRecord[] = [];
  let checklist: { label: string; count: number }[] = [];
  let reviewInbox: TaskRecord[] = [];
  let staffList: Awaited<ReturnType<typeof listStaff>> = [];
  let setupNeeded = false;
  try {
    let poolTasksResult: TaskRecord[];
    let reviewInboxResult: TaskRecord[];
    [myTasks, poolTasksResult, reviewInboxResult, staffList] = await Promise.all([
      listMyTasks(session.staffId),
      listPoolTasks(),
      isManager ? listReviewInbox() : Promise.resolve([]),
      listStaff(),
    ]);
    poolTasks = poolTasksResult;
    reviewInbox = reviewInboxResult;
    // myTasks는 이미 위에서 불러왔으니 getBasicChecklist가 Notion을 또
    // 조회하지 않도록 그대로 넘긴다(레이트리밋 완화).
    checklist = await getBasicChecklist(session.staffId, today, myTasks);
  } catch (err) {
    console.error("director/tasks data fetch failed (setup likely needed)", err);
    setupNeeded = true;
  }

  const me = staffList.find((s) => s.id === session.staffId) ?? null;

  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName={branchName} role={session.role ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DirectorTopbar
          staffName={session.name}
          role={session.role ?? ""}
          branchName={branchName}
          dateLabel={formatDateLabel(today)}
          greetingTitle="내 업무"
          greetingText="지금 할 일부터 확인하세요."
        />
        <main className="flex-1 overflow-y-auto bg-muted/50 px-6 py-5">
          {setupNeeded ? (
            session.role === "원장" ? (
              <AdminSetupButton />
            ) : (
              <div className="card">
                <h2>내 업무 기능 준비 중입니다</h2>
                <p className="muted">원장님 계정으로 한 번 설정을 마치면 바로 쓸 수 있어요. 잠시 후 다시 확인해주세요.</p>
              </div>
            )
          ) : (
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
          )}
        </main>
      </div>
    </div>
  );
}
