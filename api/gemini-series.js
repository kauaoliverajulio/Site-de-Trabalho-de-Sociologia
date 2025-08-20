const { sendJson, methodNotAllowed, readJson, generateWithGeminiREST, isQuotaError, buildSyntheticSeries } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  try {
    const { months = 12, end = undefined } = await readJson(req);
    const today = end ? new Date(end) : new Date();
    const prompt = `Gere séries temporais mensais SINTÉTICAS e verossímeis (não precisa ser real) para o Brasil em formato JSON ESTRITO.\n\nRegras IMPORTANTES:\n- Saída deve ser APENAS JSON, sem markdown, sem crases, sem comentários.\n- Use aspas duplas em todas as chaves e strings.\n- Não inclua texto fora do objeto JSON.\n\nParâmetros:\n- Período: últimos ${months} meses até ${today.toISOString().slice(0, 7)} (formato YYYY-MM).\n- Variáveis: \"Taxa de informalidade\" e \"Taxa de desocupacao\".\n- Valores em porcentagem (número, use ponto decimal).\n\nFormato EXATO:\n{\n  \"series\": [\n    {\n      \"nome\": \"Taxa de informalidade\",\n      \"resultados\": [ { \"serie\": { \"YYYY-MM\": numero, ... } } ]\n    },\n    {\n      \"nome\": \"Taxa de desocupacao\",\n      \"resultados\": [ { \"serie\": { \"YYYY-MM\": numero, ... } } ]\n    }\n  ]\n}`;

    let text;
    try {
      text = await generateWithGeminiREST('gemini-1.5-flash', prompt);
    } catch (e) {
      if (isQuotaError(e?.message)) {
        return sendJson(res, 200, buildSyntheticSeries(months, end));
      }
      throw e;
    }

    text = (text || '').trim().replace(/^```[a-zA-Z]*\n?|```$/g, '').trim();
    const start = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');
    if (start === -1 || endIdx === -1) {
      return sendJson(res, 200, buildSyntheticSeries(months, end));
    }
    const jsonStr = text.slice(start, endIdx + 1);

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      return sendJson(res, 200, buildSyntheticSeries(months, end));
    }

    if (!parsed || !Array.isArray(parsed.series)) {
      return sendJson(res, 200, buildSyntheticSeries(months, end));
    }

    return sendJson(res, 200, parsed.series);
  } catch (e) {
    if (isQuotaError(e?.message)) {
      const body = await readJson(req).catch(() => ({}));
      return sendJson(res, 200, buildSyntheticSeries(body.months || 12, body.end));
    }
    return sendJson(res, 500, { error: 'Gemini series request error', detail: e?.message || String(e) });
  }
};