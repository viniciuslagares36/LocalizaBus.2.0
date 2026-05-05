const MOBILIBUS_PLAN_URL =
  'https://otp.mobilibus.com/FY7J-lwk85QGbn/otp/routers/default/plan';

export default async function handler(req, res) {
  try {
    const allowedParams = [
      'fromPlace',
      'toPlace',
      'time',
      'date',
      'mode',
      'maxWalkDistance',
      'arriveBy',
      'wheelchair',
      'showIntermediateStops',
      'debugItineraryFilter',
      'locale',
    ];

    const params = new URLSearchParams();

    for (const key of allowedParams) {
      if (req.query[key] !== undefined) {
        params.set(key, String(req.query[key]));
      }
    }

    const url = `${MOBILIBUS_PLAN_URL}?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LocalizaBus/1.0',
      },
    });

    const text = await response.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');

    res.status(response.status);

    try {
      return res.json(JSON.parse(text));
    } catch {
      return res.send(text);
    }
  } catch (error) {
    console.error('[api/mobilibus-plan]', error);

    return res.status(500).json({
      error: true,
      message: 'Erro ao consultar Mobilibus OTP',
      details: error?.message || String(error),
    });
  }
}