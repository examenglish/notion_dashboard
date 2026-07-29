import { NextResponse } from "next/server";
import { getRecentAdminInbox } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await getRecentAdminInbox();
  return NextResponse.json(items);
}
