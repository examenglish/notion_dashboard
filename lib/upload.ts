// Vercel Serverless Functions cap request bodies at ~4.5MB regardless of
// Notion's own upload limits, so every upload route enforces this stricter,
// honest ceiling instead of letting large uploads fail with an opaque
// platform error.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function extractUploadedFile(
  req: Request
): Promise<{ file: Blob; filename: string } | { error: string }> {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof Blob)) {
    return { error: "파일이 없습니다." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: "파일이 너무 큽니다 (최대 4MB). 큰 파일은 파일저장위치에 링크로 남겨주세요." };
  }
  const filename = "name" in file && typeof (file as any).name === "string" ? (file as any).name : "원본파일";
  return { file, filename };
}
