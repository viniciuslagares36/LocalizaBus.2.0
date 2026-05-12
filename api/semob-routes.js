const SEMOB_ROUTES_URL =
  'https://otp.mobilibus.com/FY7J-lwk85QGbn/otp/routers/default/index/routes';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Método não permitido. Use GET.',
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(SEMOB_ROUTES_URL, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'LocalizaBus/2.0',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `Mobilibus respondeu ${response.status}`,
      });
    }

    const data = await response.json();

    res.setHeader(
      'Cache-Control',
      's-maxage=86400, stale-while-revalidate=604800'
    );

    return res.status(200).json(Array.isArray(data) ? data : []);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.name === 'AbortError'
        ? 'Tempo limite ao buscar linhas SEMOB/Mobilibus'
        : error?.message || 'Erro ao buscar linhas SEMOB/Mobilibus',
    });
  }
}
