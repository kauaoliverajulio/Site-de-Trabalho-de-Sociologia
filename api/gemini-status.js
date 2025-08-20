const { sendJson } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }
  const key = process.env.GEMINI_API_KEY || '';
  const masked = key ? key.slice(0, 6) + '...' + key.slice(-4) : null;
  const result = { hasKey: !!key, maskedKey: masked, restReachable: null, restHttp: null, message: null };
  try {
    if (!key) throw new Error('Sem GEMINI_API_KEY');
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    const r = await fetch(url, { method: 'GET' });
    result.restHttp = r.status;
    const body = await r.text();
    result.restReachable = r.ok;
    if (!r.ok) result.message = body?.slice?.(0, 300) || null;
    return sendJson(res, r.ok ? 200 : 502, result);
  } catch (e) {
    result.message = e?.message || String(e);
    return sendJson(res, 500, result);
  }
};