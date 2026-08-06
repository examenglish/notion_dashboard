import { NextResponse } from "next/server";
import { listStaff } from "@/lib/notion";

export const dynamic = "force-dynamic";

// Public endpoint (pre-login): returns staff names/roles only, never PINs.
export async function GET() {
  const staff = await listStaff();
  return NextResponse.json(
    staff.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      workDays: s.workDays,
      workStart: s.workStart,
      workEnd: s.workEnd,
    }))
  );
}
