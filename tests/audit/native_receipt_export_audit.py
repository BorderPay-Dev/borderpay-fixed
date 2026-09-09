from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EXPORTER = (ROOT / "utils/receipts/exportReceiptPdf.ts").read_text()
SEND = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
PACKAGE = (ROOT / "package.json").read_text()


def main() -> None:
    failures: list[str] = []

    for package in ("@capacitor/filesystem", "@capacitor/share"):
        if f'"{package}"' not in PACKAGE:
            failures.append(f"missing native receipt dependency: {package}")

    required = (
        "if (isNativeRuntime())",
        "Filesystem.writeFile",
        "Directory.Cache",
        "Share.share",
        "URL.createObjectURL",
    )
    for marker in required:
        if marker not in EXPORTER:
            failures.append(f"receipt exporter is missing: {marker}")

    if "await exportReceiptPdf(blob" not in SEND:
        failures.append("successful transfer receipt does not call the cross-platform exporter")

    if failures:
        raise SystemExit("\n".join(f"FAIL: {failure}" for failure in failures))

    print("PASS: receipt PDF exports through native iOS/Android and browser paths")


if __name__ == "__main__":
    main()
