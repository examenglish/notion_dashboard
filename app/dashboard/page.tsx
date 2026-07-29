import TopBar from "@/components/TopBar";
import DashboardClient from "@/components/DashboardClient";

export default function DashboardPage() {
  return (
    <>
      <TopBar active="dashboard" />
      <DashboardClient />
    </>
  );
}
