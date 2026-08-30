import { isNativeRuntime } from '../native/mobileRuntime';

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function safePdfName(filename: string): string {
  const stem = filename.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-');
  return `${stem || 'BorderPay-receipt'}.pdf`;
}

export async function exportReceiptPdf(blob: Blob, filename: string): Promise<void> {
  const safeName = safePdfName(filename);

  if (isNativeRuntime()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const written = await Filesystem.writeFile({
      path: `receipts/${safeName}`,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({
      title: 'BorderPay transaction receipt',
      text: 'BorderPay transaction receipt PDF',
      url: written.uri,
      dialogTitle: 'Open or save receipt',
    });
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
