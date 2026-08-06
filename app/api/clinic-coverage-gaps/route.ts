import { NextResponse } from "next/server";
import { getClinicCoverageGaps } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await getClinicCoverageGaps();
    return NextResponse.json(items);
  } catch (err) {
    console.error("getClinicCoverageGaps failed", err);
    return NextResponse.json({ error: "누락 현황을 불러오지 못했습니다." }, { status: 500 });
  }
}
