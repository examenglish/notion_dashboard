import TopBar from "@/components/TopBar";
import InputClient from "@/components/InputClient";
import { getSession } from "@/lib/auth";

export default async function InputPage() {
  const session = await getSession();
  return (
    <>
      <TopBar active="input" />
      <InputClient role={session?.role ?? null} staffId={session?.staffId ?? null} />
    </>
  );
}
