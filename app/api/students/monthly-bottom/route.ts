import { NextRequest, NextResponse } from "next/server";
import { getMonthlyAttendanceBottom } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "7");
  const rows = await getMonthlyAttendanceBottom(limit);
  return NextResponse.json(rows);
}
