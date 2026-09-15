// Storage in memoria (si resetta al riavvio Vercel)
// Per produzione seria: sostituisci con Vercel KV o Supabase (gratuiti)
const store = {};

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = todayKey();

  // ── GET: il sito legge i contenuti di oggi ──
  if (req.method === 'GET') {
    return res.status(200).json(store[key] || { source: 'empty' });
  }

  // ── POST: l'admin pubblica i contenuti ──
  if (req.method === 'POST') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_SECRET_KEY) {
      return res.status(401).json({ error: 'Non autorizzato' });
    }
    store[key] = { ...req.body, source: 'manual', publishedAt: new Date().toISOString() };
    return res.status(200).json({ ok: true, message: 'Contenuti pubblicati!' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
