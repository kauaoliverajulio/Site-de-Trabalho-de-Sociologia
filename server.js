require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
// Mantém fetch local para usos internos (IBGE) e também faz polyfill global se necessário
const dynamicFetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
if (typeof globalThis.fetch !== 'function') {
  globalThis.fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
}

// Helper para chamar a API REST do Gemini diretamente (mais robusto que o SDK em alguns ambientes)
async function generateWithGeminiREST(model = 'gemini-1.5-flash', prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: String(prompt || '') }]
      }
    ]
  };
  const r = await dynamicFetch(url, {
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

// Detecta erros de cota/limite
function isQuotaError(msg) {
  return /quota|rate\s*limit|billing/i.test(String(msg || ''));
}

// Gera séries sintéticas determinísticas quando a API não puder ser usada
function buildSyntheticSeries(months = 12, endIso) {
  const end = endIso ? new Date(endIso) : new Date();
  const labels = [];
  const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  for (let i = months - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    const ym = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
    labels.push(ym);
  }
  // Tendências suaves
  let inf = 40.0; // base informalidade
  let des = 9.5;  // base desocupação
  const seriesInf = {};
  const seriesDes = {};
  for (let i = 0; i < labels.length; i++) {
    // pequenas variações pseudo-determinísticas
    const deltaInf = (Math.sin(i / 3) * 0.15) - 0.12; // leve queda
    const deltaDes = (Math.cos(i / 4) * 0.12) - 0.10; // leve queda
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

const app = express();

// Middlewares
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

// Static files
const publicDir = __dirname;
app.use(express.static(publicDir));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});
// Add lightweight ping endpoint to avoid extension blocking
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Diagnóstico do Gemini
app.get('/api/gemini-status', async (req, res) => {
  const key = process.env.GEMINI_API_KEY || '';
  const masked = key ? key.slice(0, 6) + '...' + key.slice(-4) : null;
  const result = { hasKey: !!key, maskedKey: masked, restReachable: null, restHttp: null, message: null };
  try {
    if (!key) throw new Error('Sem GEMINI_API_KEY');
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    const r = await dynamicFetch(url, { method: 'GET' });
    result.restHttp = r.status;
    const body = await r.text();
    result.restReachable = r.ok;
    if (!r.ok) result.message = body?.slice?.(0, 300) || null;
    res.status(r.ok ? 200 : 502).json(result);
  } catch (e) {
    result.message = e?.message || String(e);
    res.status(500).json(result);
  }
});

// Proxy IBGE aggregate 6397 (PNAD Contínua: taxas)
app.get('/api/ibge/6397', async (req, res) => {
  try {
    const url = 'https://servicodados.ibge.gov.br/api/v3/agregados/6397/periodos/all/variaveis/all?localidades=N1[1]';
    const r = await dynamicFetch(url, { timeout: 30000 });
    if (!r.ok) return res.status(r.status).json({ error: 'IBGE fetch failed' });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('[IBGE] request error:', e?.message || e);
    res.status(500).json({ error: 'IBGE request error' });
  }
});

// Gemini summarization/insight endpoint
app.post('/api/gemini', async (req, res) => {
  try {
    const { prompt, context } = req.body || {};
    const finalPrompt = `Você é um assistente que explica dados socioeconômicos do Brasil de forma clara e concisa.\n\nContexto:\n${context || ''}\n\nTarefa:\n${prompt || 'Explique os dados de forma acessível e objetiva.'}`;

    const text = await generateWithGeminiREST('gemini-1.5-flash', finalPrompt);
    if (!text) {
      console.error('[Gemini] Empty response or blocked by safety.');
      return res.status(502).json({ error: 'Empty Gemini response' });
    }
    res.json({ text });
  } catch (e) {
    console.error('[Gemini] request error:', e?.message || e);
    if (isQuotaError(e?.message)) {
      return res.status(200).json({ text: 'Nota: atingimos o limite de uso da API no momento. Exibindo explicação curta baseada nos dados recentes: a tendência observada reflete oscilações típicas do mercado de trabalho, com efeitos combinados de ciclo econômico, políticas públicas e dinâmicas setoriais.' });
    }
    res.status(500).json({ error: 'Gemini request error', detail: e?.message || String(e) });
  }
});

// Gemini series generation endpoint (structured JSON for charts)
app.post('/api/gemini-series', async (req, res) => {
  try {
    const { months = 12, end = undefined } = req.body || {};

    const today = end ? new Date(end) : new Date();
    // Build a brief instruction asking for strictly valid JSON
    const prompt = `Gere séries temporais mensais SINTÉTICAS e verossímeis (não precisa ser real) para o Brasil em formato JSON ESTRITO.\n\nRegras IMPORTANTES:\n- Saída deve ser APENAS JSON, sem markdown, sem crases, sem comentários.\n- Use aspas duplas em todas as chaves e strings.\n- Não inclua texto fora do objeto JSON.\n\nParâmetros:\n- Período: últimos ${months} meses até ${today.toISOString().slice(0, 7)} (formato YYYY-MM).\n- Variáveis: \"Taxa de informalidade\" e \"Taxa de desocupacao\".\n- Valores em porcentagem (número, use ponto decimal).\n\nFormato EXATO:\n{\n  \"series\": [\n    {\n      \"nome\": \"Taxa de informalidade\",\n      \"resultados\": [ { \"serie\": { \"YYYY-MM\": numero, ... } } ]\n    },\n    {\n      \"nome\": \"Taxa de desocupacao\",\n      \"resultados\": [ { \"serie\": { \"YYYY-MM\": numero, ... } } ]\n    }\n  ]\n}`;

    let text;
    try {
      text = await generateWithGeminiREST('gemini-1.5-flash', prompt);
    } catch (e) {
      if (isQuotaError(e?.message)) {
        // Retorna dados sintéticos com HTTP 200 para evitar fallback offline no cliente
        return res.json(buildSyntheticSeries(months, end));
      }
      throw e;
    }

    // Sanitize: remove any stray fences or whitespace & extract first JSON object
    text = (text || '').trim().replace(/^```[a-zA-Z]*\n?|```$/g, '').trim();
    const start = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');
    if (start === -1 || endIdx === -1) {
      console.error('[Gemini-series] Invalid JSON shape from model:', text);
      // Como defesa, servir dados sintéticos
      return res.json(buildSyntheticSeries(months, end));
    }
    const jsonStr = text.slice(start, endIdx + 1);

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[Gemini-series] JSON parse error:', e?.message || e, jsonStr);
      // Como defesa, servir dados sintéticos
      return res.json(buildSyntheticSeries(months, end));
    }

    // Basic validation
    if (!parsed || !Array.isArray(parsed.series)) {
      console.error('[Gemini-series] Missing series array:', parsed);
      // Como defesa, servir dados sintéticos
      return res.json(buildSyntheticSeries(months, end));
    }

    res.json(parsed.series);
  } catch (e) {
    console.error('[Gemini-series] request error:', e?.message || e);
    if (isQuotaError(e?.message)) {
      return res.json(buildSyntheticSeries((req.body||{}).months || 12, (req.body||{}).end));
    }
    res.status(500).json({ error: 'Gemini series request error', detail: e?.message || String(e) });
  }
});

// Fallback to index.html (SPA-like)
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});