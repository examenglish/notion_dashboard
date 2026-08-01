import { NextRequest, NextResponse } from "next/server";
import { uploadMaterialFile } from "@/lib/notion";
import { extractUploadedFile } from "@/lib/upload";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const result = await extractUploadedFile(req);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const { file, filename } = result;
  await uploadMaterialFile(params.id, filename, file.type || "application/octet-stream", file);
  return NextResponse.json({ ok: true });
}
