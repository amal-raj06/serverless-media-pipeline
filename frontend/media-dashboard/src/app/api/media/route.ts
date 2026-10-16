import { NextResponse } from "next/server";

const API_GATEWAY_URL =
  process.env.NEXT_PUBLIC_API_GATEWAY_URL ||
  "https://rys8s3ay74.execute-api.ap-south-1.amazonaws.com/Prod";

export async function GET() {
  try {
    const res = await fetch(`${API_GATEWAY_URL}/media`, {
      cache: "no-store",
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`API Gateway Error (${res.status}):`, errText);
      return NextResponse.json(
        { items: [], error: `API Gateway returned HTTP ${res.status}` },
        { status: 200 }
      );
    }

    const data = await res.json();
    const items = data.items || data || [];

    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    console.error("Error in /api/media route:", error);
    return NextResponse.json(
      { items: [], error: error.message || "Failed to contact backend API" },
      { status: 200 }
    );
  }
}