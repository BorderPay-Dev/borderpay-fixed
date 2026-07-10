#!/usr/bin/env python3
from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "utils/fees/africaCommercialPricing.ts"
OUT = ROOT / "output/pdf"
LOGO = Path("/Users/a/Downloads/website-borderpay/public/og-image.png")


def load_routes() -> list[dict[str, Any]]:
    src = SOURCE.read_text()
    block = re.search(r"const ROUTES = \[(.*?)\] as const;", src, re.S)
    if not block:
        raise SystemExit("Could not locate ROUTES block")
    rows: list[dict[str, Any]] = []
    for line in block.group(1).splitlines():
        line = line.strip()
        if not line.startswith("["):
            continue
        line = line.rstrip(",")
        line = line.replace("false", "False").replace("true", "True")
        row = ast.literal_eval(line)
        rows.append({
            "country": row[0],
            "iso2": row[1],
            "currency": row[2],
            "direction": row[3],
            "rail": row[4],
            "provider": row[5],
            "provider_fee": row[6],
            "borderpay_fee": row[7],
            "fee_shape": row[8],
            "enabled": row[9] if len(row) > 9 and isinstance(row[9], bool) else True,
            "notes": row[10] if len(row) > 10 else "",
        })
    return rows


def provider_label(value: str) -> str:
    return {"yellow_card": "Yellow Card", "flutterwave": "Flutterwave"}[value]


def rail_label(value: str) -> str:
    return {"mobile_money": "Mobile Money", "local_bank": "Local Bank"}[value]


def direction_label(value: str) -> str:
    return {"collection": "Receive", "payout": "Send"}[value]


def fee_looks_fixed(fee: str) -> bool:
    return bool(re.search(r"\b(?:XAF|XOF|KES|NGN|GHS|RWF|TZS|UGX|ZAR|EGP|ZMW|MWK|BWP|USD|CDF)\b", fee, re.I))


def validate_routes(routes: list[dict[str, Any]]) -> None:
    errors: list[str] = []
    seen: set[tuple[str, str, str, str]] = set()
    for r in routes:
        key = (r["iso2"], r["direction"], r["rail"], r["currency"])
        if key in seen:
            errors.append(f"{r['country']} {r['direction']} {r['rail']} {r['currency']}: duplicate route.")
        seen.add(key)

        provider_has_fixed = fee_looks_fixed(r["provider_fee"])
        customer_has_fixed = fee_looks_fixed(r["borderpay_fee"])
        if customer_has_fixed and not provider_has_fixed:
            errors.append(f"{r['country']} {r['direction']} {r['rail']}: BorderPay fixed fee without provider fixed fee.")
        if provider_has_fixed and not customer_has_fixed:
            errors.append(f"{r['country']} {r['direction']} {r['rail']}: provider fixed fee requires BorderPay fixed fee.")
        if r["iso2"] == "CD" and r["direction"] == "collection":
            errors.append("DR Congo collection must remain disabled/absent.")
        if not r["borderpay_fee"].strip():
            errors.append(f"{r['country']} {r['direction']} {r['rail']}: missing BorderPay customer fee.")
        if not r["provider_fee"].strip():
            errors.append(f"{r['country']} {r['direction']} {r['rail']}: missing provider fee.")

    if errors:
        raise SystemExit("Commercial fee validation failed:\n- " + "\n- ".join(errors))


def write_markdown(routes: list[dict[str, Any]]) -> None:
    internal = [
        "# BorderPay Africa Commercial Fee Map - Internal",
        "",
        "Provider names and provider costs are included. Do not publish this version.",
        "",
        "| Country | Direction | Rail | Currency | Provider | Provider commercial cost | BorderPay customer fee | Status | Notes |",
        "|---|---|---|---|---|---:|---:|---|---|",
    ]
    public = [
        "# BorderPay Africa Commercial Fee Map",
        "",
        "Customer-facing local African rail pricing. Provider names and BorderPay internal costs are intentionally excluded.",
        "",
        "| Country | Direction | Rail | Currency | BorderPay customer fee | Availability |",
        "|---|---|---|---|---:|---|",
    ]
    for r in routes:
        status = "Active" if r["enabled"] else "Pending"
        notes = r["notes"]
        internal.append(
            f"| {r['country']} | {direction_label(r['direction'])} | {rail_label(r['rail'])} | {r['currency']} | "
            f"{provider_label(r['provider'])} | {r['provider_fee']} | {r['borderpay_fee']} | {status} | {notes} |"
        )
        public.append(
            f"| {r['country']} | {direction_label(r['direction'])} | {rail_label(r['rail'])} | {r['currency']} | "
            f"{r['borderpay_fee']} | {status} |"
        )
    (OUT / "borderpay_africa_fee_map_internal.md").write_text("\n".join(internal) + "\n")
    (OUT / "borderpay_africa_fee_map_public.md").write_text("\n".join(public) + "\n")


def para(text: Any, style: ParagraphStyle) -> Paragraph:
    safe = str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(safe, style)


def build_pdf(routes: list[dict[str, Any]], public: bool) -> None:
    filename = OUT / ("borderpay_africa_fee_map_public.pdf" if public else "borderpay_africa_fee_map_internal_provider_costs.pdf")
    doc = SimpleDocTemplate(
        str(filename),
        pagesize=landscape(A4),
        leftMargin=10 * mm,
        rightMargin=10 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "TitleBP",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=colors.HexColor("#101418"),
        alignment=TA_CENTER,
        spaceAfter=6,
    )
    small = ParagraphStyle("Small", parent=styles["BodyText"], fontSize=7, leading=8.2)
    head = ParagraphStyle("Head", parent=small, fontName="Helvetica-Bold", textColor=colors.white)
    body = ParagraphStyle("Body", parent=small)
    story: list[Any] = []

    if public and LOGO.exists():
        story.append(Image(str(LOGO), width=48 * mm, height=27 * mm, kind="proportional"))
        story.append(Spacer(1, 2 * mm))
    story.append(Paragraph("BorderPay Africa Commercial Fee Map" if public else "BorderPay Africa Commercial Fee Map - Internal Provider Cost View", title_style))
    subtitle = (
        "Customer-facing local African rail pricing. Provider names and internal costs are excluded."
        if public
        else "Internal strategy view. Includes provider choice and commercial costs. Do not publish."
    )
    story.append(Paragraph(subtitle, ParagraphStyle("Subtitle", parent=styles["BodyText"], alignment=TA_CENTER, fontSize=9, leading=11)))
    story.append(Spacer(1, 5 * mm))

    if public:
        headers = ["Country", "Direction", "Rail", "Currency", "BorderPay customer fee", "Availability"]
        data = [[para(h, head) for h in headers]]
        for r in routes:
            data.append([
                para(r["country"], body),
                para(direction_label(r["direction"]), body),
                para(rail_label(r["rail"]), body),
                para(r["currency"], body),
                para(r["borderpay_fee"], body),
                para("Active" if r["enabled"] else "Pending", body),
            ])
        col_widths = [40 * mm, 22 * mm, 30 * mm, 20 * mm, 62 * mm, 24 * mm]
    else:
        headers = ["Country", "Direction", "Rail", "Currency", "Provider", "Provider cost", "BorderPay customer fee", "Status"]
        data = [[para(h, head) for h in headers]]
        for r in routes:
            data.append([
                para(r["country"], body),
                para(direction_label(r["direction"]), body),
                para(rail_label(r["rail"]), body),
                para(r["currency"], body),
                para(provider_label(r["provider"]), body),
                para(r["provider_fee"], body),
                para(r["borderpay_fee"], body),
                para("Active" if r["enabled"] else "Pending", body),
            ])
        col_widths = [36 * mm, 19 * mm, 27 * mm, 17 * mm, 27 * mm, 58 * mm, 56 * mm, 20 * mm]

    table = Table(data, repeatRows=1, colWidths=col_widths)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#101418")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D8DDE3")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F9FB")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(table)
    story.append(PageBreak())
    story.append(Paragraph("Pricing Rules", title_style))
    if public:
        rules = [
            "BorderPay customer pricing is market-facing local African rail pricing.",
            "Percentage-only routes are charged as percentage-only routes.",
            "Fixed fees, minimums, caps, and tiers appear only where the underlying rail requires that fee shape.",
            "DR Congo is payout-only. Collection and onboarding are not offered.",
            "Bridge remains BorderPay core infrastructure. Local African rail partners are execution partners only.",
        ]
    else:
        rules = [
            "Provider commercial pricing is the internal cost basis. BorderPay customer pricing is market-facing and higher than provider cost.",
            "If the selected provider route has percentage-only pricing, BorderPay charges percentage-only pricing.",
            "If the selected provider route has a fixed fee, BorderPay may charge a customer fixed fee.",
            "If the selected provider route has percentage plus fixed pricing, BorderPay charges percentage plus fixed pricing.",
            "If the selected provider route has minimum/maximum rules, BorderPay may set customer minimum/maximum rules.",
            "DR Congo is payout-only. Collection and onboarding are not offered.",
            "Bridge remains BorderPay core infrastructure. Yellow Card and Flutterwave are local African rail execution partners only.",
        ]
    for rule in rules:
        story.append(Paragraph(f"- {rule}", ParagraphStyle("Rule", parent=styles["BodyText"], fontSize=10, leading=13)))
        story.append(Spacer(1, 1 * mm))
    doc.build(story)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    routes = load_routes()
    validate_routes(routes)
    write_markdown(routes)
    build_pdf(routes, public=False)
    build_pdf(routes, public=True)
    print(f"Generated {len(routes)} route rows in {OUT}")


if __name__ == "__main__":
    main()
