import { NextResponse } from "next/server";
import { getClinicCompliance } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await getClinicCompliance();
    return NextResponse.json(items);
  } catch (err) {
    console.error("getClinicCompliance failed", err);
    return NextResponse.json({ error: "이행 현황을 불러오지 못했습니다." }, { status: 500 });
  }
}
