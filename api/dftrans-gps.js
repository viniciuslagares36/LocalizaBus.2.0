// api/dftrans-gps.js

const DFTRANS_GPS_URL = 'https://www.sistemas.dftrans.df.gov.br/service/gps/operacoes';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'LocalizaBus/1.0 (+https://localiza-bus-2-0teste.vercel.app)',
        'Cache-Control': 'no-cache',
        ...(options.headers || {}),
      },
    });

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      ok: false,
      error: 'Método não permitido. Use GET.',
    });
  }

  try {
    const response = await fetchWithTimeout(
      DFTRANS_GPS_URL,
      {
        method: 'GET',
      },
      20000
    );

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    if (!response.ok) {
      console.error('[DFTrans GPS] Resposta não OK:', {
        status: response.status,
        statusText: response.statusText,
        bodyPreview: text.slice(0, 300),
      });

      return res.status(response.status).json({
        ok: false,
        source: 'DFTrans GPS',
        error: `DFTrans retornou ${response.status}`,
        status: response.status,
        statusText: response.statusText,
        preview: text.slice(0, 300),
      });
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch (jsonError) {
      console.error('[DFTrans GPS] Erro ao converter JSON:', {
        contentType,
        preview: text.slice(0, 300),
      });

      return res.status(502).json({
        ok: false,
        source: 'DFTrans GPS',
        error: 'DFTrans respondeu, mas não retornou JSON válido.',
        contentType,
        preview: text.slice(0, 300),
      });
    }

    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');

    return res.status(200).json(data);
  } catch (error) {
    console.error('[DFTrans GPS] Erro no proxy:', error);

    const isTimeout =
      error?.name === 'AbortError' ||
      String(error?.message || '').toLowerCase().includes('abort');

    return res.status(502).json({
      ok: false,
      source: 'DFTrans GPS',
      error: isTimeout
        ? 'Timeout ao consultar o DFTrans GPS.'
        : 'Proxy DFTrans GPS indisponível.',
      detail: error?.message || String(error),
    });
  }
}