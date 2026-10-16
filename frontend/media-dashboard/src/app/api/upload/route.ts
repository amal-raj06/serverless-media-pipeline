import { NextResponse } from "next/server";

const API_GATEWAY_URL =
  process.env.NEXT_PUBLIC_API_GATEWAY_URL ||
  "https://rys8s3ay74.execute-api.ap-south-1.amazonaws.com/Prod";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // 1. Request Pre-Signed PUT URL from API Gateway
    const presignedRes = await fetch(`${API_GATEWAY_URL}/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
      }),
    });

    if (!presignedRes.ok) {
      throw new Error(`API Gateway returned HTTP ${presignedRes.status}`);
    }

    const { uploadUrl, fileKey } = await presignedRes.json();

    // 2. Stream File Directly to S3 via Pre-Signed PUT URL
    const fileBuffer = await file.arrayBuffer();
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: fileBuffer,
    });

    if (!uploadRes.ok) {
      throw new Error(`S3 direct upload failed with status ${uploadRes.status}`);
    }

    return NextResponse.json({
      success: true,
      fileKey,
      message: "Uploaded directly to S3 via Pre-Signed URL",
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process direct upload" },
      { status: 500 }
    );
  }
}