import { redirect } from "next/navigation";
import TopBar from "@/components/TopBar";
import StudentLevelClient from "@/components/StudentLevelClient";
import { getSession } from "@/lib/auth";

// Lv로 학생 전체를 한눈에 파악하는 화면 — 원장 전용.
export default async function StudentLevelsPage() {
  const session = await getSession();
  if (session?.role !== "원장") {
    redirect("/dashboard");
  }
  return (
    <>
      <TopBar active="student-levels" />
      <StudentLevelClient />
    </>
  );
}
