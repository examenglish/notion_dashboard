import TopBar from "@/components/TopBar";
import DashboardClient from "@/components/DashboardClient";
import { getSession } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await getSession();
  return (
    <>
      <TopBar active="dashboard" />
      <DashboardClient staffName={session?.name ?? null} staffRole={session?.role ?? null} />
    </>
  );
}
