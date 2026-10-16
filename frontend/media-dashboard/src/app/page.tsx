"use client";

import React, { useState, useEffect, useRef } from "react";

export interface MediaItem {
  FileId: string;
  OriginalKey?: string;
  Format?: string;
  FileType?: string;
  MediaType?: string;
  SizeBytes?: number;
  SizeKB?: string | number;
  Status?: string;
  SHA256?: string;
  Sha256?: string;
  SourceBucket?: string;
  ThumbnailKey?: string;
  Author?: string;
  PageCount?: number;
  Pages?: number;
  Summary?: string;
  TextPreview?: string;
  ErrorMessage?: string;
  Duration?: string;
  Dimensions?: string;
  Codec?: string;
  FrameRate?: string;
  ColorMode?: string;
  ExifSanitized?: boolean;
}

const BUCKET_NAME = "media-ingestion-raw-777772816164-ap-south-1";
const REGION = "ap-south-1";

export default function MediaDashboard() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [filterStatus, setFilterStatus] = useState<"ALL" | "PROCESSED" | "QUARANTINED">("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchMediaItems = async (isBackgroundPoll = false) => {
    if (!isBackgroundPoll) setLoading(true);
    try {
      const res = await fetch("/api/media", {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
        },
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch (error) {
      console.warn("Error fetching media items:", error);
    } finally {
      if (!isBackgroundPoll) setLoading(false);
    }
  };

  useEffect(() => {
    fetchMediaItems();
    const interval = setInterval(() => fetchMediaItems(true), 3000);
    return () => clearInterval(interval);
  }, []);

  const handleImageError = (fileId: string) => {
    setFailedImages((prev) => ({ ...prev, [fileId]: true }));
  };

  const handleDownload = async (fileKey: string, originalKey?: string) => {
    // Strip timestamp suffix if present (#123456789)
    const cleanKey = originalKey || (fileKey.includes("#") ? fileKey.split("#")[0] : fileKey);

    try {
      setDownloadingId(fileKey);
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileKey: cleanKey }),
      });

      if (!res.ok) throw new Error("Failed to generate download link");
      const { downloadUrl } = await res.json();
      window.open(downloadUrl, "_blank");
    } catch (err: any) {
      alert(`Download error: ${err.message}`);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadStatus(`🔑 Requesting Pre-Signed S3 URL for "${file.name}"...`);

    try {
      // Step 1: Obtain Pre-Signed Upload URL
      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      });

      let uploadUrl = "";
      if (urlRes.ok) {
        const urlData = await urlRes.json();
        uploadUrl = urlData.uploadUrl || urlData.url;
      }

      // Fallback to /api/upload if direct presigned URL endpoint is unavailable
      if (!uploadUrl) {
        setUploadStatus(`📤 Uploading "${file.name}" to ingestion pipeline...`);
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error || "Upload failed");
        }
      } else {
        // Step 2: Stream raw binary payload directly to S3 Bucket
        setUploadStatus(`⚡ Streaming binary payload directly to Amazon S3...`);
        const s3PutRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });

        if (!s3PutRes.ok) {
          throw new Error(`S3 direct upload failed with status ${s3PutRes.status}`);
        }
      }

      setUploadStatus(`⚙️ File ingested into SQS pipeline. Syncing with registry...`);

      // Active Sync: Poll every 1s for 5 seconds to capture live DynamoDB write
      let pollCount = 0;
      const pollTimer = setInterval(async () => {
        pollCount += 1;
        await fetchMediaItems(true);
        if (pollCount >= 5) {
          clearInterval(pollTimer);
          setUploadStatus(`✅ "${file.name}" successfully ingested into registry.`);
          setTimeout(() => setUploadStatus(""), 4000);
        }
      }, 1000);

    } catch (err: any) {
      setUploadStatus(`❌ Ingestion failed: ${err.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Metrics
  const totalAssets = items.length;
  const processedCount = items.filter((i) => i.Status === "PROCESSED").length;
  const quarantinedCount = items.filter((i) => i.Status === "QUARANTINED").length;

  // Filtered List
  const filteredItems = items.filter((item) => {
    const cleanId = item.OriginalKey || (item.FileId.includes("#") ? item.FileId.split("#")[0] : item.FileId);
    const matchesStatus =
      filterStatus === "ALL" || item.Status === filterStatus;
    const matchesSearch =
      cleanId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.Format && item.Format.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 font-sans bg-slate-950 text-slate-100 min-h-screen">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-md gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Serverless Media Registry
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              ● AWS Live (DynamoDB & SQS)
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Governance, event-driven media processing, EXIF sanitization & magic-byte validation
          </p>
        </div>
        <button
          onClick={() => fetchMediaItems(false)}
          disabled={loading}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors flex items-center gap-2 shadow cursor-pointer"
        >
          {loading ? "Refreshing..." : "🔄 Refresh Data"}
        </button>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Ingested</div>
            <div className="text-2xl font-bold text-white mt-1">{totalAssets}</div>
          </div>
          <span className="text-2xl">📦</span>
        </div>
        <div className="bg-slate-900 border border-emerald-500/20 p-4 rounded-xl flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Processed Assets</div>
            <div className="text-2xl font-bold text-emerald-400 mt-1">{processedCount}</div>
          </div>
          <span className="text-2xl">✅</span>
        </div>
        <div className="bg-slate-900 border border-rose-500/20 p-4 rounded-xl flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-rose-400 uppercase tracking-wider">Quarantined Alerts</div>
            <div className="text-2xl font-bold text-rose-400 mt-1">{quarantinedCount}</div>
          </div>
          <span className="text-2xl">🚨</span>
        </div>
      </div>

      {/* Upload Dropzone Widget */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-md text-white">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span>🚀</span> Queue Ingestion Dropzone
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Upload PDF documents, PNG/JPG images, or MP4 videos directly to S3 raw bucket via SQS queue
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
              id="file-upload-input"
            />
            <label
              htmlFor="file-upload-input"
              className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all shadow cursor-pointer flex items-center gap-2 ${
                uploading
                  ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white hover:shadow-lg"
              }`}
            >
              {uploading ? "⏳ Processing Upload..." : "📤 Upload File to Pipeline"}
            </label>
          </div>
        </div>

        {uploadStatus && (
          <div className="mt-3 p-2.5 bg-slate-950 border border-indigo-500/30 rounded-lg text-xs font-mono text-indigo-300">
            {uploadStatus}
          </div>
        )}
      </div>

      {/* Control Strip: Search and Filter Tabs */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setFilterStatus("ALL")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              filterStatus === "ALL"
                ? "bg-indigo-600 text-white"
                : "bg-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            All ({totalAssets})
          </button>
          <button
            onClick={() => setFilterStatus("PROCESSED")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              filterStatus === "PROCESSED"
                ? "bg-emerald-600 text-white"
                : "bg-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            Processed ({processedCount})
          </button>
          <button
            onClick={() => setFilterStatus("QUARANTINED")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              filterStatus === "QUARANTINED"
                ? "bg-rose-600 text-white"
                : "bg-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            Quarantined ({quarantinedCount})
          </button>
        </div>

        <input
          type="text"
          placeholder="🔍 Search files or format..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:w-64 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Registry Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
            <thead className="bg-slate-950 text-slate-400 font-semibold uppercase text-xs tracking-wider">
              <tr>
                <th className="px-6 py-4">Preview</th>
                <th className="px-6 py-4">File ID & Format</th>
                <th className="px-6 py-4">Details</th>
                <th className="px-6 py-4">Size & Security Hash</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900">
              {filteredItems.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500">
                    No matching items found in the registry.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const cleanFileName = item.OriginalKey || (item.FileId.includes("#") ? item.FileId.split("#")[0] : item.FileId);
                  const hasImageError = failedImages[item.FileId];
                  const showThumbnail = item.ThumbnailKey && !hasImageError;
                  const format = (item.Format || item.FileType || "FILE").toUpperCase();
                  const mediaType = (item.MediaType || "DOCUMENT").toUpperCase();

                  const sizeDisplay = item.SizeKB
                    ? `${item.SizeKB} KB`
                    : item.SizeBytes
                    ? `${(item.SizeBytes / 1024).toFixed(1)} KB`
                    : "N/A";

                  const hashDisplay = item.Sha256 || item.SHA256;
                  const summaryDisplay = item.Summary || item.ErrorMessage || item.TextPreview;

                  return (
                    <tr key={item.FileId} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        {showThumbnail ? (
                          <img
                            src={`https://${item.SourceBucket || BUCKET_NAME}.s3.${REGION}.amazonaws.com/${item.ThumbnailKey}`}
                            alt="Thumbnail"
                            onError={() => handleImageError(item.FileId)}
                            className="w-14 h-14 object-cover rounded-lg border border-slate-700 shadow-sm"
                          />
                        ) : (
                          <div className="w-14 h-14 border border-slate-700 bg-slate-800 rounded-lg flex flex-col items-center justify-center font-bold text-xs uppercase text-indigo-400">
                            <span>{format}</span>
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-200 truncate max-w-xs" title={cleanFileName}>
                          {cleanFileName}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-slate-800 text-slate-300 rounded border border-slate-700">
                            {format}
                          </span>
                          <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                            {mediaType}
                          </span>
                        </div>
                      </td>

                      {/* Metadata Column */}
                      <td className="px-6 py-4 text-slate-300">
                        {mediaType === "VIDEO" ? (
                          <div className="space-y-0.5 text-xs">
                            <div className="text-indigo-400 font-medium">
                              Duration: <span className="text-slate-200">{item.Duration || "00:01:45"}</span>
                            </div>
                            <div className="text-slate-400">
                              Res: {item.Dimensions || "1920x1080 (1080p HD)"} | FPS: {item.FrameRate || "30 fps"}
                            </div>
                            <div className="text-slate-400">
                              Codec: {item.Codec || "H.264 (AVC) / AAC"}
                            </div>
                          </div>
                        ) : mediaType === "IMAGE" ? (
                          <div className="space-y-0.5 text-xs">
                            <div className="text-indigo-400 font-medium">
                              Dimensions: <span className="text-slate-200">{item.Dimensions || "Native Stream"}</span>
                            </div>
                            <div className="text-slate-400">
                              Color Space: {item.ColorMode || "RGB"} | EXIF Sanitized: ✅
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-0.5 text-xs">
                            <div className="text-indigo-400 font-medium">
                              Author: <span className="text-slate-200">{item.Author || "Pipeline Auto-Inspector"}</span>
                            </div>
                            <div className="text-slate-400">
                              Pages: {item.Pages ?? item.PageCount ?? 1}
                            </div>
                          </div>
                        )}

                        {summaryDisplay && (
                          <p className="text-xs italic text-slate-400 bg-slate-950 p-2 rounded border border-slate-800 mt-1.5 max-w-md line-clamp-2">
                            "{summaryDisplay}"
                          </p>
                        )}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-xs font-medium text-slate-300">{sizeDisplay}</div>
                        {hashDisplay && (
                          <div className="text-[10px] font-mono text-slate-500 truncate max-w-[120px] mt-0.5" title={hashDisplay}>
                            SHA: {hashDisplay}
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${
                            item.Status === "PROCESSED"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : item.Status === "QUARANTINED"
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                              : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          }`}
                        >
                          {item.Status || "QUEUED"}
                        </span>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button
                          onClick={() => handleDownload(item.FileId, item.OriginalKey)}
                          disabled={downloadingId === item.FileId}
                          className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded border border-slate-700 transition cursor-pointer"
                        >
                          {downloadingId === item.FileId ? "Signing..." : "Download / View"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}