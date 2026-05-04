const SEMOB_STOPS_URL =
  'https://otp.mobilibus.com/FY7J-lwk85QGbn/otp/routers/default/index/stops';

export default async function handler(req, res) {
  try {
    const response = await fetch(SEMOB_STOPS_URL, {
      headers: {
        accept: 'application/json',
        'user-agent': 'LocalizaBus/2.0',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `Mobilibus respondeu ${response.status}`,
      });
    }

    const data = await response.json();

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json(Array.isArray(data) ? data : []);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao buscar paradas SEMOB/Mobilibus',
    });
  }
}
