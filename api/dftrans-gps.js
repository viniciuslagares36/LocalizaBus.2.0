// api/dftrans-gps.js
// Proxy serverless para o GPS ao vivo do DFTrans/DF no Ponto.

const DFTRANS_GPS_URL = 'https://www.sistemas.dftrans.df.gov.br/service/gps/operacoes';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const response = await fetch(DFTRANS_GPS_URL, {
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'LocalizaBus/2.0 (+https://vercel.app)',
      },
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'DFTrans GPS indisponível',
        status: response.status,
        body: text.slice(0, 300),
      });
    }

    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(text);
  } catch (error) {
    return res.status(502).json({
      error: 'Falha ao consultar DFTrans GPS',
      details: error?.message || String(error),
    });
  }
}
