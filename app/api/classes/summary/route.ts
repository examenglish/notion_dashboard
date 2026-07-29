import { NextResponse } from "next/server";
import { getClassSummary } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET() {
  const summary = await getClassSummary();
  return NextResponse.json(summary);
}
