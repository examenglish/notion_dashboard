import { NextRequest, NextResponse } from "next/server";
import { getDailyOutcomeDetail } from "@/lib/notion";
import { todayKST } from "@/lib/date";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") || todayKST();
  const detail = await getDailyOutcomeDetail(date);
  return NextResponse.json(detail);
}
