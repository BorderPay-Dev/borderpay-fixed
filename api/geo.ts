export default function handler(req: any, res: any) {
  const raw = String(
    req.headers?.['x-vercel-ip-country']
      || req.headers?.['cf-ipcountry']
      || '',
  ).trim().toUpperCase();
  const country = /^[A-Z]{2}$/.test(raw) && raw !== 'XX' ? raw : null;
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json({ country });
}
