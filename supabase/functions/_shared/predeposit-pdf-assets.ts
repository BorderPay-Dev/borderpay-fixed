import type { PdfStyleAssets } from "./predeposit-pdf.ts";

// Static brand assets only. Never cache merchant logos, signatures or customer data.
let styles: Promise<PdfStyleAssets> | undefined;
export async function loadPdfStyleAssets(db: any): Promise<PdfStyleAssets> {
  if (!styles) {
    styles = (async () => {
      const read = async (name: string) => {
        const r = await db.storage.from("predeposit-render-assets").download(name);
        if (r.error || !r.data) throw Error("Invoice design assets are temporarily unavailable");
        return new Uint8Array(await r.data.arrayBuffer());
      };
      const [boldFontBytes, brandLogo] = await Promise.all([read("NotoSans-Bold.ttf"), read("borderpay-mark.jpg")]);
      return { boldFontBytes, brandLogo };
    })().catch(error => { styles = undefined; throw error; });
  }
  return styles;
}
