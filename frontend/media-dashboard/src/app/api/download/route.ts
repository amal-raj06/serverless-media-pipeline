import { NextResponse } from "next/server";

const API_GATEWAY_URL =
  process.env.NEXT_PUBLIC_API_GATEWAY_URL ||
  "https://rys8s3ay74.execute-api.ap-south-1.amazonaws.com/Prod";

export async function POST(req: Request) {
  try {
    const { fileKey } = await req.json();

    if (!fileKey) {
      return NextResponse.json(
        { error: "fileKey parameter is required" },
        { status: 400 }
      );
    }

    // Strip any DynamoDB timestamp suffix (#123456789) to get the real S3 object key
    const actualS3Key = fileKey.includes("#") ? fileKey.split("#")[0] : fileKey;

    const response = await fetch(`${API_GATEWAY_URL}/download-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileKey: actualS3Key }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API Gateway Download Error (${response.status}):`, errorText);
      throw new Error(`API Gateway returned HTTP ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json({ downloadUrl: data.downloadUrl });
  } catch (error: any) {
    console.error("Error in /api/download route:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate pre-signed URL" },
      { status: 500 }
    );
  }
}