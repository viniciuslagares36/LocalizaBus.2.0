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


export const normalizeLineForValidation = (value) =>
  String(value || '')
    .toLowerCase()
    .replace('linha', '')
    .replace(/[^0-9a-z.]/g, '')
    .replace(/^0+(?=\d)/, '')
    .trim();

export const getSemobStopRoutes = async (stopId) => {
  if (!stopId) return [];

  try {
    const response = await axios.get('/api/semob-stop-routes', {
      params: { stopId },
      timeout: 15000,
    });

    const data = Array.isArray(response.data) ? response.data : [];

    return data.map((route) => ({
      id: route.id,
      shortName:
        route.shortName ||
        route.short_name ||
        route.routeShortName ||
        '',
      longName:
        route.longName ||
        route.long_name ||
        route.routeLongName ||
        '',
      agencyName:
        route.agencyName ||
        route.agency_name ||
        '',
      raw: route,
    }));
  } catch (error) {
    console.warn('[SEMOB stop routes]', stopId, error?.message || error);
    return [];
  }
};

export const getAllowedLinesForStops = async (stops = [], limit = 5) => {
  const targetStops = stops
    .filter((stop) => stop?.stopId)
    .slice(0, limit);

  const routeGroups = await Promise.all(
    targetStops.map(async (stop) => {
      const routes = await getSemobStopRoutes(stop.stopId);

      return {
        stopId: stop.stopId,
        stopName: stop.stopName || stop.name,
        routes,
      };
    })
  );

  const allowedLines = new Set();

  routeGroups.forEach((group) => {
    group.routes.forEach((route) => {
      const code = normalizeLineForValidation(route.shortName || route.id);

      if (code) {
        allowedLines.add(code);
      }
    });
  });

  return {
    allowedLines,
    routeGroups,
  };
};


const SEMOB_ROUTES_CACHE_KEY = 'localizabus_semob_routes_v2';
const SEMOB_ROUTES_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

const normalizeRouteLineCode = (value) => {
  const raw = String(value || '')
    .toLowerCase()
    .replace('linha', '')
    // Alguns endpoints retornam a linha com prefixo de agência, ex: BSBUS:0.401.
    .split(':')
    .pop()
    .replace(/[^0-9a-z.]/g, '')
    // Faz 0.401, 0401 e 401 virarem comparáveis como 401.
    .replace(/^0+\./, '')
    .replace(/^0+(?=\d)/, '')
    .trim();

  return raw;
};

const compactRouteLineCode = (value) =>
  normalizeRouteLineCode(value)
    .replace(/\./g, '')
    .replace(/^0+(?=\d)/, '');

const formatRouteColor = (value) => {
  const color = String(value || '').replace('#', '').trim();

  if (/^[0-9a-fA-F]{6}$/.test(color)) {
    return `#${color}`;
  }

  return null;
};

const getRouteShortName = (route) => {
  const raw =
    route?.shortName ||
    route?.short_name ||
    route?.routeShortName ||
    route?.route_short_name ||
    route?.code ||
    route?.routeCode ||
    route?.route_code ||
    route?.id ||
    '';

  // Se vier algo tipo "BSBUS:0.401", mostra só "0.401".
  return String(raw || '').split(':').pop().trim();
};

const getRouteLongName = (route) => {
  return (
    route?.longName ||
    route?.long_name ||
    route?.routeLongName ||
    route?.desc ||
    route?.description ||
    ''
  );
};

const mapSemobRoute = (route) => {
  const shortName = getRouteShortName(route);
  const longName = getRouteLongName(route);

  const routeColor =
    formatRouteColor(route?.color) ||
    formatRouteColor(route?.routeColor) ||
    formatRouteColor(route?.route_color);

  const textColor =
    formatRouteColor(route?.textColor) ||
    formatRouteColor(route?.routeTextColor) ||
    formatRouteColor(route?.route_text_color);

  return {
    id: route?.id || shortName,
    line: shortName,
    name: longName || `Linha ${shortName}`,
    shortName,
    longName,
    color: routeColor,
    textColor,
    agencyName: route?.agencyName || route?.agency_name || 'SEMOB/DF',
    raw: route,
  };
};

export const getAllSemobRoutes = async ({ forceRefresh = false } = {}) => {
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(SEMOB_ROUTES_CACHE_KEY);

      if (cached) {
        const parsed = JSON.parse(cached);

        if (
          parsed?.timestamp &&
          Date.now() - parsed.timestamp < SEMOB_ROUTES_CACHE_TTL &&
          Array.isArray(parsed.data)
        ) {
          return parsed.data;
        }
      }
    } catch {
      // ignora cache quebrado
    }
  }

  try {
    const response = await axios.get('/api/semob-routes', {
      timeout: 20000,
    });

    const routes = Array.isArray(response.data)
      ? response.data.map(mapSemobRoute).filter((route) => route.line)
      : [];

    try {
      localStorage.setItem(
        SEMOB_ROUTES_CACHE_KEY,
        JSON.stringify({
          timestamp: Date.now(),
          data: routes,
        })
      );
    } catch {
      // ignora erro de storage
    }

    return routes;
  } catch (error) {
    console.warn('[SEMOB routes]', error?.message || error);
    return [];
  }
};

export const searchSemobRoutesByLine = async (query, { limit = 20 } = {}) => {
  const safeQuery = String(query || '').trim();

  if (!safeQuery) return [];

  const normalizedQuery = normalizeRouteLineCode(safeQuery);
  const queryCompact = compactRouteLineCode(safeQuery);

  const routes = await getAllSemobRoutes();

  const scored = routes
    .map((route) => {
      const line = String(route.line || route.shortName || route.id || '');
      const normalizedLine = normalizeRouteLineCode(line);
      const lineCompact = compactRouteLineCode(line);
      const rawLineLower = line.toLowerCase();
      const rawQueryLower = safeQuery.toLowerCase();

      let score = -1;

      if (normalizedLine === normalizedQuery) score = 0;
      else if (lineCompact === queryCompact) score = 1;
      else if (normalizedLine.startsWith(normalizedQuery)) score = 2;
      else if (lineCompact.startsWith(queryCompact)) score = 3;
      else if (rawLineLower.startsWith(rawQueryLower)) score = 4;

      return {
        ...route,
        score,
        normalizedLine,
        lineCompact,
      };
    })
    .filter((route) => route.score >= 0);

  return scored
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;

      return a.normalizedLine.localeCompare(b.normalizedLine, 'pt-BR', {
        numeric: true,
        sensitivity: 'base',
      });
    })
    .slice(0, limit)
    .map(({ score, normalizedLine, lineCompact, ...route }) => route);
};
