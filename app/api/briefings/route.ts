import { NextResponse } from "next/server";
import { getRecentBriefings } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await getRecentBriefings();
  return NextResponse.json(items);
}
