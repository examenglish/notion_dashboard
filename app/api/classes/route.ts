import { NextResponse } from "next/server";
import { listClasses } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET() {
  const classes = await listClasses();
  return NextResponse.json(classes.map((c) => ({ id: c.id, name: c.name })));
}
