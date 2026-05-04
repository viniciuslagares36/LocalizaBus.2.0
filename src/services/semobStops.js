import axios from 'axios';
import { DF_FAVORITE_PLACES } from '../data/dfPlaces';

const SEMOB_STOPS_DIRECT_URL =
  'https://otp.mobilibus.com/FY7J-lwk85QGbn/otp/routers/default/index/stops';

const SEMOB_STOPS_PROXY_URL = '/api/semob-stops';
const CACHE_KEY = 'localizabus_semob_stops_v2';
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

export const normalizeText = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const expandQuery = (query) => {
  const q = normalizeText(query);

  return q
    .replace(/rodoviaria/g, 'rodoviaria terminal')
    .replace(/metro/g, 'metro estacao')
    .replace(/onibus/g, 'onibus parada terminal')
    .replace(/epct/g, 'epct estrada parque contorno')
    .replace(/w3/g, 'w3 asa sul asa norte')
    .replace(/eptg/g, 'eptg estrada parque taguatinga')
    .replace(/epia/g, 'epia estrada parque industria abastecimento')
    .replace(/unb/g, 'universidade brasilia unb');
};

const tokenize = (text) => normalizeText(text).split(' ').filter(Boolean);

const mapStop = (stop) => {
  const lat = Number(stop.lat ?? stop.stop_lat);
  const lon = Number(stop.lon ?? stop.stop_lon);
  const name = stop.name || stop.stop_name || stop.label || 'Parada de ônibus';

  return {
    name,
    address: `${name}, Brasília - DF`,
    position: { lat, lon },
    type: 'Parada oficial',
    stopId: stop.id || stop.stop_id,
    source: 'Mobilibus/SEMOB',
  };
};

const validStop = (stop) =>
  stop?.position &&
  Number.isFinite(stop.position.lat) &&
  Number.isFinite(stop.position.lon);

const readCache = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed?.createdAt || !Array.isArray(parsed?.stops)) return null;
    if (Date.now() - parsed.createdAt > CACHE_MAX_AGE_MS) return null;

    return parsed.stops;
  } catch {
    return null;
  }
};

const writeCache = (stops) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ createdAt: Date.now(), stops }));
  } catch (error) {
    // Se o navegador estourar limite de storage, o app continua funcionando sem cache.
    console.warn('Cache local de paradas SEMOB não pôde ser salvo:', error?.message || error);
  }
};

const fetchStops = async (url) => {
  const response = await axios.get(url, { timeout: 25000 });
  const data = Array.isArray(response.data) ? response.data : response.data?.stops;

  if (!Array.isArray(data)) return [];

  return data.map(mapStop).filter(validStop);
};

export const getAllSemobStops = async ({ forceRefresh = false } = {}) => {
  if (!forceRefresh) {
    const cached = readCache();
    if (cached?.length) return cached;
  }

  try {
    // Na Vercel, esta rota evita problemas de CORS com o endpoint do Mobilibus.
    const stops = await fetchStops(SEMOB_STOPS_PROXY_URL);
    if (stops.length) {
      writeCache(stops);
      return stops;
    }
  } catch (error) {
    console.warn('Proxy SEMOB indisponível, tentando direto:', error?.message || error);
  }

  try {
    const stops = await fetchStops(SEMOB_STOPS_DIRECT_URL);
    if (stops.length) {
      writeCache(stops);
      return stops;
    }
  } catch (error) {
    console.error('Erro ao buscar paradas SEMOB/Mobilibus:', error?.message || error);
  }

  return DF_FAVORITE_PLACES;
};

const scorePlace = (place, query) => {
  const originalQuery = normalizeText(query);
  const expandedQuery = expandQuery(query);
  const haystack = normalizeText(`${place.name} ${place.address} ${place.type} ${place.stopId || ''}`);
  const queryTokens = tokenize(expandedQuery);

  if (!originalQuery || !haystack) return 0;

  let score = 0;

  if (haystack === originalQuery) score += 120;
  if (haystack.startsWith(originalQuery)) score += 80;
  if (haystack.includes(originalQuery)) score += 55;

  queryTokens.forEach((token) => {
    if (token.length < 2) return;
    if (haystack.includes(token)) score += token.length >= 4 ? 16 : 8;
  });

  if (place.type?.toLowerCase().includes('terminal')) score += 12;
  if (place.type?.toLowerCase().includes('metr')) score += 10;
  if (place.type?.toLowerCase().includes('parada oficial')) score += 6;
  if (place.source === 'Mobilibus/SEMOB') score += 5;

  return score;
};

export const findLocalDfPlaces = async (query, { limit = 12 } = {}) => {
  const safeQuery = normalizeText(query);

  if (!safeQuery || safeQuery.length < 2) {
    return [];
  }

  const allStops = await getAllSemobStops();
  const allPlaces = [...DF_FAVORITE_PLACES, ...allStops];

  const seen = new Set();

  return allPlaces
    .map((place) => ({ ...place, score: scorePlace(place, safeQuery) }))
    .filter((place) => place.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter((place) => {
      const key = `${normalizeText(place.name)}|${place.position?.lat}|${place.position?.lon}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
};
