import { NextResponse } from "next/server";
import { getMonthlyOutcomeBreakdown } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getMonthlyOutcomeBreakdown();
  return NextResponse.json(data);
}
