// api/dftrans-gps.js
import https from 'https';

const DFTRANS_GPS_URL = 'https://www.sistemas.dftrans.df.gov.br/service/gps/operacoes';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        timeout: 25000,
        headers: {
          Accept: 'application/json,text/plain,*/*',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          Referer: 'https://www.sistemas.dftrans.df.gov.br/',
          Origin: 'https://www.sistemas.dftrans.df.gov.br',
        },

        // Ajuda caso o Node/Vercel enrosque em certificado/cadeia TLS.
        // Se o endpoint tiver SSL estranho, isso evita "fetch failed".
        rejectUnauthorized: false,
      },
      (response) => {
        let raw = '';

        response.setEncoding('utf8');

        response.on('data', (chunk) => {
          raw += chunk;
        });

        response.on('end', () => {
          resolve({
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            headers: response.headers,
            body: raw,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Timeout ao consultar o DFTrans GPS'));
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
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
    const response = await requestJson(DFTRANS_GPS_URL);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return res.status(response.statusCode || 502).json({
        ok: false,
        source: 'DFTrans GPS',
        error: `DFTrans retornou ${response.statusCode}`,
        status: response.statusCode,
        statusText: response.statusMessage,
        preview: String(response.body || '').slice(0, 500),
      });
    }

    let data;

    try {
      data = JSON.parse(response.body);
    } catch (jsonError) {
      return res.status(502).json({
        ok: false,
        source: 'DFTrans GPS',
        error: 'DFTrans respondeu, mas não retornou JSON válido.',
        preview: String(response.body || '').slice(0, 500),
      });
    }

    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');

    return res.status(200).json(data);
  } catch (error) {
    return res.status(502).json({
      ok: false,
      source: 'DFTrans GPS',
      error: 'Proxy DFTrans GPS indisponível.',
      detail: error?.message || String(error),
      hint: 'O endpoint funciona no navegador, mas pode estar bloqueando requisições serverless da Vercel.',
    });
  }
}