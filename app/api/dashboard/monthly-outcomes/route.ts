import { NextRequest, NextResponse } from "next/server";
import { getMonthlyOutcomeBreakdown } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month") ?? undefined;
  const data = await getMonthlyOutcomeBreakdown(month);
  return NextResponse.json(data);
}
