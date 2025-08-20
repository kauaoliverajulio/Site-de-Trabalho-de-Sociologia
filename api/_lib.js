// Shared helpers for Vercel Serverless Functions

const fetchImpl = (typeof fetch === 'function')
  ? fetch
  : (...args) => import('node-fetch').then(({ default: f }) => f(...args));

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function methodNotAllowed(res, allow) {
  res.setHeader('Allow', allow);
  return sendJson(res, 405, { error: 'Method Not Allowed' });
}

async function readJson(req) {
  return new Promise((resolve) => {
    try {
      if (req.body && typeof req.body === 'object') return resolve(req.body);
    } catch (_) {}
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

async function generateWithGeminiREST(model = 'gemini-1.5-flash', prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [ { role: 'user', parts: [{ text: String(prompt || '') }] } ]
  };
  const r = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data?.error?.message || `HTTP ${r.status}`;
    throw new Error(`Gemini REST error: ${detail}`);
  }
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map(p => p?.text || '')
    .join(' ')
    .trim();
  return text;
}

function isQuotaError(msg) {
  return /quota|rate\s*limit|billing/i.test(String(msg || ''));
}

function buildSyntheticSeries(months = 12, endIso) {
  const end = endIso ? new Date(endIso) : new Date();
  const labels = [];
  const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  for (let i = months - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    const ym = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
    labels.push(ym);
  }
  let inf = 40.0; // base informalidade
  let des = 9.5;  // base desocupação
  const seriesInf = {};
  const seriesDes = {};
  for (let i = 0; i < labels.length; i++) {
    const deltaInf = (Math.sin(i / 3) * 0.15) - 0.12;
    const deltaDes = (Math.cos(i / 4) * 0.12) - 0.10;
    inf = Math.max(30, Math.min(50, +(inf + deltaInf).toFixed(1)));
    des = Math.max(5, Math.min(15, +(des + deltaDes).toFixed(1)));
    seriesInf[labels[i]] = inf;
    seriesDes[labels[i]] = des;
  }
  return [
    { nome: 'Taxa de informalidade', resultados: [{ serie: seriesInf }] },
    { nome: 'Taxa de desocupacao', resultados: [{ serie: seriesDes }] }
  ];
}

module.exports = {
  fetchImpl,
  sendJson,
  methodNotAllowed,
  readJson,
  generateWithGeminiREST,
  isQuotaError,
  buildSyntheticSeries,
};