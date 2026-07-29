import { NextRequest, NextResponse } from "next/server";
import { searchStudents } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const students = await searchStudents(q);
  return NextResponse.json(students);
}
