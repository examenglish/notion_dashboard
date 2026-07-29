import { NextRequest, NextResponse } from "next/server";
import { getTodaySchedule } from "@/lib/notion";
import { todayKST } from "@/lib/date";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? todayKST();
  const schedule = await getTodaySchedule(date);
  return NextResponse.json(schedule);
}
