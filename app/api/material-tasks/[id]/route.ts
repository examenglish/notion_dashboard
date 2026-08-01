import { NextRequest, NextResponse } from "next/server";
import { updateMaterialTask } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { ownerName, progress, status, fileLocation, content, dueDate } = body;
  if (progress !== undefined && (typeof progress !== "number" || progress < 0 || progress > 100)) {
    return NextResponse.json({ error: "작업률은 0~100 사이 숫자여야 합니다." }, { status: 400 });
  }
  await updateMaterialTask(params.id, { ownerName, progress, status, fileLocation, content, dueDate });
  return NextResponse.json({ ok: true });
}
