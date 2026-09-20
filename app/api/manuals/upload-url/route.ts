import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// 화면녹화 영상/스크린샷을 브라우저에서 Vercel Blob으로 직접 업로드하기 위한
// 토큰 발급 라우트(섹션25) — Next.js 서버리스 함수의 요청 바디 용량 제한
// (~4.5MB)을 우회한다. 실제 바이너리는 이 서버를 거치지 않고 브라우저에서
// Blob으로 바로 올라간다.
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const role = readStaffRole(request as unknown as { headers: Headers });
        if (role !== "원장" && role !== "행정" && role !== "강사") {
          throw new Error("매뉴얼 업로드 권한이 없습니다.");
        }
        return {
          allowedContentTypes: ["video/mp4", "video/quicktime", "video/webm", "image/png", "image/jpeg"],
          addRandomSuffix: true,
          maximumSizeInBytes: 1024 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {
        // Blob 업로드 완료 웹훅 — 별도 후처리가 필요 없어 비워둔다(분석은
        // 클라이언트가 업로드 URL을 받은 뒤 /api/manuals/analyze를 직접 호출).
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "업로드 토큰 발급 실패" }, { status: 400 });
  }
}
