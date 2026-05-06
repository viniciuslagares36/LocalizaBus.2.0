export async function planMobilibusRoute({
  fromLat,
  fromLon,
  toLat,
  toLon,
  date,
  time,
  mode = 'TRANSIT,WALK',
  maxWalkDistance = 1200,
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(`/api/mobilibus-plan?${params.toString()}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Erro no planner Mobilibus: ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}