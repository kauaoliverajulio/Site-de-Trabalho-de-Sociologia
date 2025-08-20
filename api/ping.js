const { sendJson } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }
  return sendJson(res, 200, { ok: true, uptime: process.uptime() });
};