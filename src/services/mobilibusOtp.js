const MOBILIBUS_BASE =
  'https://otp.mobilibus.com/FY7J-lwk85QGbn/otp/routers/default';

export async function planMobilibusRoute({
  fromLat,
  fromLon,
  toLat,
  toLon,
  date,
  time,
  mode = 'TRANSIT,WALK',
  maxWalkDistance = 4828.032,
  signal,
}) {
  const params = new URLSearchParams({
    fromPlace: `${fromLat},${fromLon}`,
    toPlace: `${toLat},${toLon}`,
    time,
    date,
    mode,
    maxWalkDistance: String(maxWalkDistance),
    arriveBy: 'false',
    wheelchair: 'false',
    showIntermediateStops: 'true',
    debugItineraryFilter: 'false',
    locale: 'pt_BR',
  });

  const url = `${MOBILIBUS_BASE}/plan?${params.toString()}`;

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Erro no planner Mobilibus: ${response.status}`);
  }

  return response.json();
}