import { NextRequest, NextResponse } from "next/server";
import { getClassSummaryByDate } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (!date) {
    return NextResponse.json({ error: "date query param is required (YYYY-MM-DD)" }, { status: 400 });
  }
  const summary = await getClassSummaryByDate(date);
  return NextResponse.json(summary);
}
