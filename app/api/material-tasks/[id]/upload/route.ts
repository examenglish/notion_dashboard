import { NextRequest, NextResponse } from "next/server";
import { uploadMaterialFile } from "@/lib/notion";

export const dynamic = "force-dynamic";

// Vercel Serverless Functions cap request bodies at ~4.5MB regardless of
// Notion's own upload limits, so we enforce a stricter, honest ceiling here
// rather than let large uploads fail with an opaque platform error.
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "파일이 너무 큽니다 (최대 4MB). 큰 파일은 파일저장위치에 링크로 남겨주세요." }, { status: 400 });
  }
  const filename = "name" in file && typeof (file as any).name === "string" ? (file as any).name : "원본파일";

  await uploadMaterialFile(params.id, filename, file.type || "application/octet-stream", file);
  return NextResponse.json({ ok: true });
}
