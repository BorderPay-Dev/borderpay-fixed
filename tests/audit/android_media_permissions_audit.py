from pathlib import Path

root = Path(__file__).resolve().parents[2]
manifest = (root / "android/app/src/main/AndroidManifest.xml").read_text()

for permission in (
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
):
    declaration = manifest.split(f'android:name="{permission}"', 1)
    assert len(declaration) == 2, f"{permission} must be explicitly removed at manifest merge"
    assert 'tools:node="remove"' in declaration[1].split("/>", 1)[0], f"{permission} is not removed"

assert 'xmlns:tools="http://schemas.android.com/tools"' in manifest
print("Android media uploads use system pickers without broad storage permissions.")
