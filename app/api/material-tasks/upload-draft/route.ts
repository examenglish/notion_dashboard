import { NextRequest, NextResponse } from "next/server";
import { createFileUploadDraft } from "@/lib/notion";
import { extractUploadedFile } from "@/lib/upload";

export const dynamic = "force-dynamic";

// 아직 작업 페이지가 없는(=작업요청 등록 전) 상태에서 파일부터 선택했을 때
// 쓴다. Notion에 미리 올려두고 file_upload id만 돌려주면, 클라이언트가
// 폼 제출 시 그 id를 /api/material-tasks POST에 실어 페이지 생성과
// 동시에 붙인다.
export async function POST(req: NextRequest) {
  const result = await extractUploadedFile(req);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const { file, filename } = result;
  const { fileUploadId } = await createFileUploadDraft(filename, file.type || "application/octet-stream", file);
  return NextResponse.json({ ok: true, fileUploadId, filename });
}
