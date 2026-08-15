import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canUseDirector = !!session.role && ["원장", "행정", "강사", "조교"].includes(session.role);
  redirect(canUseDirector ? "/director" : "/dashboard");
}
