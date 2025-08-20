const { sendJson } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }
  try {
    const url = 'https://servicodados.ibge.gov.br/api/v3/agregados/6397/periodos/all/variaveis/all?localidades=N1[1]';
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return sendJson(res, r.status, { error: 'IBGE fetch failed' });
    const data = await r.json();
    return sendJson(res, 200, data);
  } catch (e) {
    return sendJson(res, 500, { error: 'IBGE request error' });
  }
};