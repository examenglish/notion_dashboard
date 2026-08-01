import { NextRequest, NextResponse } from "next/server";
import { createMaterialTask, getMaterialTasksForDate, listMaterialTasks } from "@/lib/notion";
import { readStaffName } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  const items = date ? await getMaterialTasksForDate(date) : await listMaterialTasks();
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const dueDate = typeof body?.dueDate === "string" ? body.dueDate : "";
  if (!title || !content || !dueDate) {
    return NextResponse.json({ error: "제목, 작업내용, 마감일은 필수입니다." }, { status: 400 });
  }

  const requesterName = readStaffName(req) || undefined;
  await createMaterialTask({
    title,
    requesterName,
    ownerName: typeof body?.ownerName === "string" ? body.ownerName : undefined,
    content,
    dueDate,
    fileLocation: typeof body?.fileLocation === "string" ? body.fileLocation : undefined,
    fileUploadId: typeof body?.fileUploadId === "string" ? body.fileUploadId : undefined,
    fileName: typeof body?.fileName === "string" ? body.fileName : undefined,
  });
  return NextResponse.json({ ok: true });
}
