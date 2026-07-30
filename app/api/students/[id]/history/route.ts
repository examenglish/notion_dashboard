import { NextResponse } from "next/server";
import { getStudentFullHistory } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const history = await getStudentFullHistory(params.id);
  return NextResponse.json(history);
}
