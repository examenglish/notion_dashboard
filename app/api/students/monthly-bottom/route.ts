import { NextResponse } from "next/server";
import { getMonthlyStudentMetrics } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await getMonthlyStudentMetrics();
  return NextResponse.json(rows);
}
