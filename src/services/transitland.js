// src/services/transitland.js
// Integração Transitland v2 para MVP do LocalizaBus.
// TomTom continua sendo usado no projeto para mapa e busca/geocoding.

const TRANSITLAND_API_KEY =
  import.meta.env?.VITE_TRANSITLAND_API_KEY || 'MIIeRroLCyLU1gRrbfAUY7beM3HA0WoS';

const REST_BASE = 'https://transit.land/api/v2/rest';
const OTP_BASE = 'https://transit.land/api/v2/routing/otp/plan';
const VALHALLA_BASE = 'https://transit.land/api/v2/routing/valhalla/route';

const BRASILIA_BBOX = '-48.30,-16.10,-47.60,-15.50';

export const transitlandConfig = {
  apiKey: TRANSITLAND_API_KEY,
  restBase: REST_BASE,
  otpBase: OTP_BASE,
  valhallaBase: VALHALLA_BASE,
};

export const isValidCoord = (point) => {
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
};

const nowForTransitland = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}:00` };
};

const fetchJson = async (url, options = {}) => {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error || data?.message || data?.raw || `HTTP ${res.status}`;
    throw new Error(`Transitland: ${msg}`);
  }
  return data;
};

export const getTransitlandStopsNearby = async (coords, { radius = 900, limit = 12, signal } = {}) => {
  if (!isValidCoord(coords)) return [];

  const params = new URLSearchParams({
    apikey: TRANSITLAND_API_KEY,
    lat: String(coords.lat),
    lon: String(coords.lon),
    radius: String(radius),
    limit: String(limit),
  });

  // bbox ajuda a manter Brasília/DF como área principal quando a API aceitar esse filtro.
  params.set('bbox', BRASILIA_BBOX);

  try {
    const data = await fetchJson(`${REST_BASE}/stops?${params.toString()}`, { signal });
    const stops = data?.stops || data?.data || [];
    return stops.map((s, index) => ({
      stopId: s.onestop_id || s.stop_id || s.id || `tl-stop-${index}`,
      stopName: s.stop_name || s.name || 'Parada Transitland',
      lat: Number(s.geometry?.coordinates?.[1] ?? s.lat),
      lon: Number(s.geometry?.coordinates?.[0] ?? s.lon),
      distanceKm: Number(s.distance ?? 0) / 1000,
      source: 'Transitland',
    })).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  } catch (error) {
    console.warn('[Transitland stops]', error.message);
    return [];
  }
};

export const getTransitlandTransitPlan = async (origin, destination, { signal, maxItineraries = 5 } = {}) => {
  if (!isValidCoord(origin) || !isValidCoord(destination)) return [];

  const { date, time } = nowForTransitland();
  const params = new URLSearchParams({
    apikey: TRANSITLAND_API_KEY,
    fromPlace: `${origin.lat},${origin.lon}`,
    toPlace: `${destination.lat},${destination.lon}`,
    date,
    time,
    numItineraries: String(maxItineraries),
    maxItineraries: String(maxItineraries),
    maxWalkingDistance: '1500',
    maxWalkDistance: '1500',
    fallbackWalkingItinerary: 'true',
    includeWalkingItinerary: 'true',
    useFallbackDates: 'true',
    locale: 'pt_BR',
  });

  try {
    const data = await fetchJson(`${OTP_BASE}?${params.toString()}`, { signal });
    return data?.plan?.itineraries || [];
  } catch (error) {
    console.warn('[Transitland transit plan]', error.message);
    return [];
  }
};

const decodeValhallaShape = (str, precision = 6) => {
  // Polyline decoder compatível com Valhalla/OSRM. Retorna [lon, lat].
  if (!str) return [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const coordinates = [];
  const factor = Math.pow(10, precision);

  while (index < str.length) {
    let result = 1;
    let shift = 0;
    let b;
    do {
      b = str.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    result = 1;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lon += (result & 1) ? ~(result >> 1) : (result >> 1);

    coordinates.push([lon / factor, lat / factor]);
  }

  return coordinates;
};

export const getTransitlandWalkingPlan = async (origin, destination, { signal } = {}) => {
  if (!isValidCoord(origin) || !isValidCoord(destination)) return [];

  const payload = {
    locations: [
      { lat: Number(origin.lat), lon: Number(origin.lon), type: 'break' },
      { lat: Number(destination.lat), lon: Number(destination.lon), type: 'break' },
    ],
    costing: 'pedestrian',
    directions_options: { language: 'pt-BR', units: 'kilometers' },
  };

  const params = new URLSearchParams({ apikey: TRANSITLAND_API_KEY });

  try {
    const data = await fetchJson(`${VALHALLA_BASE}?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: TRANSITLAND_API_KEY,
      },
      body: JSON.stringify(payload),
      signal,
    });

    const trip = data?.trip;
    const leg = trip?.legs?.[0];
    if (!trip || !leg) return [];

    const distanceKm = Number(trip.summary?.length || leg.summary?.length || 0);
    const durationSec = Number(trip.summary?.time || leg.summary?.time || 0);
    const coordinates = decodeValhallaShape(leg.shape);

    return [{
      duration: durationSec,
      distance: distanceKm * 1000,
      walkTime: durationSec,
      walkDistance: distanceKm * 1000,
      transitTime: 0,
      waitingTime: 0,
      transfers: 0,
      legs: [{
        mode: 'WALK',
        transitLeg: false,
        duration: durationSec,
        distance: distanceKm * 1000,
        from: { name: 'Origem', lat: origin.lat, lon: origin.lon },
        to: { name: 'Destino', lat: destination.lat, lon: destination.lon },
        legGeometry: coordinates.length ? { points: coordinates, length: coordinates.length } : null,
        steps: leg.maneuvers || [],
      }],
      source: 'Transitland Valhalla',
    }];
  } catch (error) {
    console.warn('[Transitland walking plan]', error.message);
    return [];
  }
};

export const normalizeTransitlandItineraryMode = (mode) => {
  const m = String(mode || '').toUpperCase();
  if (m === 'SUBWAY' || m === 'RAIL' || m === 'TRAM' || m === 'METRO') return 'METRO';
  if (m === 'BUS') return 'BUS';
  if (m === 'WALK') return 'WALK';
  return m || 'TRANSIT';
};
