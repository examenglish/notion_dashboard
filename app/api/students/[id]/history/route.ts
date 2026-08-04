import { NextResponse } from "next/server";
import { getStudentFullHistory } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const history = await getStudentFullHistory(params.id);
    return NextResponse.json(history);
  } catch (err) {
    console.error("getStudentFullHistory failed", params.id, err);
    return NextResponse.json({ error: "기록을 불러오지 못했습니다." }, { status: 500 });
  }
}
