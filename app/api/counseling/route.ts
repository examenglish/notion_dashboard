import { NextResponse } from "next/server";
import { getRecentCounseling } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await getRecentCounseling();
  return NextResponse.json(items);
}
