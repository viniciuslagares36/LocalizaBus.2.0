const MOBILIBUS_STOPS_URL =
  'https://otp.mobilibus.com/FY7J-lwk85QGbn/otp/routers/default/index/stops';

export default async function handler(req, res) {
  const { stopId } = req.query;

  if (!stopId) {
    return res.status(400).json({
      success: false,
      error: 'stopId é obrigatório',
    });
  }

  try {
    const response = await fetch(
      `${MOBILIBUS_STOPS_URL}/${encodeURIComponent(stopId)}/routes`,
      {
        headers: {
          accept: 'application/json',
          'user-agent': 'LocalizaBus/2.0',
        },
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `Mobilibus respondeu ${response.status}`,
      });
    }

    const data = await response.json();

    res.setHeader(
      'Cache-Control',
      's-maxage=3600, stale-while-revalidate=86400'
    );

    return res.status(200).json(Array.isArray(data) ? data : []);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao buscar rotas da parada',
    });
  }
}