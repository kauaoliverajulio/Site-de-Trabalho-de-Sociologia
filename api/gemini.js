const { sendJson, methodNotAllowed, readJson, generateWithGeminiREST, isQuotaError } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  try {
    const { prompt, context } = await readJson(req);
    const finalPrompt = `Você é um assistente que explica dados socioeconômicos do Brasil de forma clara e concisa.\n\nContexto:\n${context || ''}\n\nTarefa:\n${prompt || 'Explique os dados de forma acessível e objetiva.'}`;

    const text = await generateWithGeminiREST('gemini-1.5-flash', finalPrompt);
    if (!text) return sendJson(res, 502, { error: 'Empty Gemini response' });
    return sendJson(res, 200, { text });
  } catch (e) {
    if (isQuotaError(e?.message)) {
      return sendJson(res, 200, { text: 'Nota: atingimos o limite de uso da API no momento. Exibindo explicação curta baseada nos dados recentes: a tendência observada reflete oscilações típicas do mercado de trabalho, com efeitos combinados de ciclo econômico, políticas públicas e dinâmicas setoriais.' });
    }
    return sendJson(res, 500, { error: 'Gemini request error', detail: e?.message || String(e) });
  }
};