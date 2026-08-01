import { NextResponse } from "next/server";
import { listExamPrepOverview } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listExamPrepOverview();
  return NextResponse.json(items);
}
