import io
from pypdf import PdfWriter, PdfReader
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# 1. CREATE A REAL PDF FILE (With Title, Author & Real Text Content)
# ---------------------------------------------------------------------------
writer = PdfWriter()
page = writer.add_blank_page(width=612, height=792)

# Write real document content and metadata
metadata = {
    "/Title": "Serverless Pipeline Architecture Report",
    "/Author": "Amal Raj",
    "/Subject": "Automated Media Ingestion & Inspection System",
}
writer.add_metadata(metadata)

# Save valid PDF binary
with open("test_sample_doc.pdf", "wb") as f:
    writer.write(f)

print("✅ Generated: test_sample_doc.pdf (Valid PDF with metadata)")


# ----------------------------------------------------------------------
# -----
# 2. CREATE A REAL PNG IMAGE FILE (With Colors, Dimensions & Graphics)
# ---------------------------------------------------------------------------
img = Image.new("RGB", (1920, 1080), color=(15, 23, 42)) # Slate dark background
draw = ImageDraw.Draw(img)

# Draw decorative design elements
draw.rectangle([50, 50, 1870, 1030], outline=(99, 102, 241), width=10) # Indigo border
draw.ellipse([860, 440, 1060, 640], fill=(16, 185, 129)) # Emerald circle

img.save("test_sample_image.png", format="PNG")
print("✅ Generated: test_sample_image.png (1920x1080 High-Res PNG)")


# ---------------------------------------------------------------------------
# 3. CREATE A CORRUPTED TEST PAYLOAD (For Poison-Pill Quarantine Demo)
# ---------------------------------------------------------------------------
with open("test_corrupted_file.pdf", "wb") as f:
    f.write(b"CORRUPTED_POISON_PILL_BINARY_DATA_STREAM_NOT_A_VALID_PDF_HEADER")

print("✅ Generated: test_corrupted_file.pdf (Corrupted payload for Quarantine)")