import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "healthy", app_id: "saas-portal-v2" });
}
