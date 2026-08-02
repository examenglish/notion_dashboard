import { NextRequest, NextResponse } from "next/server";
import { getTodaySchedule } from "@/lib/notion";
import { todayKST } from "@/lib/date";
import { readStaffId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? todayKST();
  const staffId = readStaffId(req);
  const schedule = await getTodaySchedule(date, staffId || undefined);
  return NextResponse.json(schedule);
}
