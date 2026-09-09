from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
admin = (ROOT / "supabase/functions/api-gateway-admin/index.ts").read_text()
assets = (ROOT / "supabase/functions/_shared/api-white-label-assets.ts").read_text()
migration = (ROOT / "supabase/migrations/20260818123000_tenant_assets_storage_bucket.sql").read_text()
upload_start = admin.find('if (action === "upload_white_label_logo")')
upload_end = admin.find('if (action === "create_api_key")', upload_start)
upload = admin[upload_start:upload_end]

checks = {
    "operator action exists": '"upload_white_label_logo"' in admin,
    "white-label approval is required before upload": 0 <= upload.find('approvalAllowsProduct(approval, "white_label")') < upload.find('.from(WHITE_LABEL_LOGO_BUCKET)'),
    "upload is bounded to one megabyte": "WHITE_LABEL_LOGO_MAX_BYTES = 1024 * 1024" in assets,
    "upload MIME types are explicit": all(item in assets for item in ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]),
    "raster MIME types require matching magic bytes": all(item in assets for item in ["0x89, 0x50, 0x4e, 0x47", "0xff, 0xd8, 0xff", "0x52, 0x49, 0x46, 0x46"]),
    "SVG active and external content is rejected": all(item in assets for item in ["foreignObject", "javascript:", "xlink:href", "@import"]),
    "tenant-scoped object path is used": '`${tenantId}/logo.${logo.ext}`' in admin,
    "bucket is public-read and size-limited": "'tenant-assets'" in migration and "1048576" in migration and "public = excluded.public" in migration,
    "migration creates no browser write policy": "create policy" not in migration.lower(),
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit(1)
print("API white-label logo upload audit: PASS")
