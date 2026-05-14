/*
  LocalizaBus — src/services/dftransGps.js
  Serviço de ônibus ao vivo. Chama o backend Cloudflare/Vercel, normaliza veículos, aceita linhas com zero na frente e aplica cache para deixar a busca mais rápida.
  Comentários feitos em linguagem simples para você conseguir mexer depois sem se perder.
*/

// src/services/dftransGps.js

const DFTRANS_WORKER_URL = import.meta.env.VITE_DFTRANS_WORKER_URL;

const DFTRANS_DIRECT_URL =
  'https://www.sistemas.dftrans.df.gov.br/service/gps/operacoes';

const VERCEL_PROXY_URL = '/api/dftrans-gps';

const WORKER_GPS_URL = DFTRANS_WORKER_URL
  ? `${DFTRANS_WORKER_URL}/api/dftrans-gps`
  : null;

const WORKER_VEHICLES_URL = DFTRANS_WORKER_URL
  ? `${DFTRANS_WORKER_URL}/api/vehicles`
  : null;

let memoryCache = {
  data: null,
  updatedAt: 0,
};

const lineCache = new Map();
const inflightRequests = new Map();

const CACHE_TIME_MS = 15000;
const LINE_CACHE_TIME_MS = 12000;
const REQUEST_TIMEOUT_MS = 7000;

// Comentário humano: fetch com timeout, cache de requisição em andamento e proteção para não disparar várias buscas iguais.
async function fetchJson(url, options = {}) {
  const { signal, timeoutMs = REQUEST_TIMEOUT_MS, cacheKey = url } = options;

  if (inflightRequests.has(cacheKey)) {
    return inflightRequests.get(cacheKey);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const abortFromCaller = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    signal.addEventListener('abort', abortFromCaller, { once: true });
  }

  const requestPromise = fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json,text/plain,*/*',
    },
    signal: controller.signal,
    cache: 'no-store',
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.json();
    })
    .finally(() => {
      clearTimeout(timeoutId);
      inflightRequests.delete(cacheKey);
      if (signal) signal.removeEventListener('abort', abortFromCaller);
    });

  inflightRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

// Comentário humano: normaliza linha para aceitar variações com zero na frente, ponto e texto extra.
function normalizeLine(line) {
  const value = String(line || '')
    .trim()
    .replace(',', '.')
    .toUpperCase();

  // Permite o usuário digitar 0400 e consultar a linha 0.400.
  if (/^0\d{3,4}$/.test(value)) {
    return `0.${value.slice(1)}`;
  }

  return value;
}

function getLineCandidates(line) {
  const normalized = normalizeLine(line);
  const compact = normalized.replace(/[^0-9A-Z]/g, '');

  return new Set([
    normalized,
    normalized.replace(/^0\./, ''),
    normalized.replace(/^0+(?=\d)/, ''),
    compact,
    compact.replace(/^0+(?=\d)/, ''),
  ].filter(Boolean));
}

function normalizeLineComparable(line) {
  return Array.from(getLineCandidates(line))[0] || '';
}

function sameBusLine(a, b) {
  const ax = getLineCandidates(a);
  const by = getLineCandidates(b);

  for (const x of ax) {
    if (by.has(x)) return true;
  }

  return false;
}

// Comentário humano: transforma respostas diferentes do DFTrans/Worker em um formato único que o app entende.
function normalizeVehicle(vehicle, fallbackOperadora = null) {
  const lat =
    vehicle?.lat ??
    vehicle?.localizacao?.latitude ??
    null;

  const lon =
    vehicle?.lon ??
    vehicle?.localizacao?.longitude ??
    null;

  if (!lat || !lon) return null;

  const operadora = vehicle?.operadora || fallbackOperadora || {};

  const operadoraNome =
    typeof operadora === 'string'
      ? operadora
      : operadora?.nome || '';

  return {
    id:
      vehicle?.id ||
      `${vehicle?.numero || 'sem-numero'}-${vehicle?.linha || vehicle?.line || 'sem-linha'}-${vehicle?.horario || Date.now()}`,

    numero: vehicle?.numero || '',

    line: normalizeLine(vehicle?.linha || vehicle?.line),
    linha: normalizeLine(vehicle?.linha || vehicle?.line),

    lat: Number(lat),
    lon: Number(lon),

    horario: vehicle?.horario || vehicle?.updatedAt || null,
    updatedAt: vehicle?.updatedAt || vehicle?.horario || null,

    speed:
      vehicle?.speed ??
      vehicle?.velocidade?.valor ??
      vehicle?.velocidade ??
      0,

    velocidade:
      vehicle?.velocidade?.valor ??
      vehicle?.speed ??
      vehicle?.velocidade ??
      0,

    direcao: vehicle?.direcao ?? vehicle?.bearing ?? 0,
    bearing: vehicle?.bearing ?? vehicle?.direcao ?? 0,

    sentido: vehicle?.sentido || null,
    valid: vehicle?.valid !== false,

    codigoImei: vehicle?.codigoImei || '',

    operadora: operadoraNome,
    operadoraSigla: typeof operadora === 'object' ? operadora?.sigla || '' : '',
    operadoraId: typeof operadora === 'object' ? operadora?.id || null : null,
    operadoraRazaoSocial:
      typeof operadora === 'object' ? operadora?.razaoSocial || '' : '',
  };
}

function normalizeDftransResponse(data) {
  if (!data) return [];

  // Resposta do Cloudflare: { ok, vehicles: [...] }
  if (Array.isArray(data.vehicles)) {
    return data.vehicles
      .map((vehicle) => normalizeVehicle(vehicle))
      .filter(Boolean)
      .filter((vehicle) => vehicle.valid);
  }

  // Resposta original do DFTrans: [{ operadora, veiculos: [...] }]
  if (Array.isArray(data)) {
    const vehicles = [];

    for (const group of data) {
      const operadora = group?.operadora || {};
      const veiculos = Array.isArray(group?.veiculos) ? group.veiculos : [];

      for (const vehicle of veiculos) {
        const normalized = normalizeVehicle(vehicle, operadora);

        if (normalized && normalized.valid) {
          vehicles.push(normalized);
        }
      }
    }

    return vehicles;
  }

  return [];
}

export async function fetchDftransGpsRaw(options = {}) {
  const { signal } = options;
  const now = Date.now();

  if (memoryCache.data && now - memoryCache.updatedAt < CACHE_TIME_MS) {
    return memoryCache.data;
  }

  let data = null;

  // 1. Cloudflare Pages Function
  if (WORKER_GPS_URL) {
    try {
      data = await fetchJson(WORKER_GPS_URL, { signal, cacheKey: 'gps_all_worker' });

      memoryCache = {
        data,
        updatedAt: Date.now(),
      };

      return data;
    } catch (workerError) {
      console.warn(
        '[DFTrans GPS] Cloudflare falhou, tentando Vercel:',
        workerError?.message
      );
    }
  }

  // 2. Proxy Vercel
  try {
    data = await fetchJson(VERCEL_PROXY_URL, { signal, cacheKey: 'gps_all_vercel' });

    memoryCache = {
      data,
      updatedAt: Date.now(),
    };

    return data;
  } catch (proxyError) {
    console.warn(
      '[DFTrans GPS] Proxy Vercel falhou, tentando endpoint direto:',
      proxyError?.message
    );
  }

  // 3. Endpoint direto DFTrans
  data = await fetchJson(DFTRANS_DIRECT_URL, { signal, cacheKey: 'gps_all_direct' });

  memoryCache = {
    data,
    updatedAt: Date.now(),
  };

  return data;
}

export async function getAllLiveVehicles(options = {}) {
  const data = await fetchDftransGpsRaw(options);
  return normalizeDftransResponse(data);
}

// Comentário humano: busca ônibus ao vivo de uma linha específica. É a função mais importante para pesquisa por linha.
export async function getLiveVehiclesByLine(line, options = {}) {
  const normalizedLine = normalizeLine(line);
  const { signal, force = false } = options;

  if (!normalizedLine) return [];

  const cacheKey = normalizeLineComparable(normalizedLine);
  const cached = lineCache.get(cacheKey);

  if (!force && cached?.data && Date.now() - cached.updatedAt < LINE_CACHE_TIME_MS) {
    return cached.data;
  }

  // Preferência: rota filtrada do Cloudflare. É muito mais rápido que baixar todos os ônibus.
  if (WORKER_VEHICLES_URL) {
    try {
      const url = `${WORKER_VEHICLES_URL}?linha=${encodeURIComponent(normalizedLine)}`;
      const data = await fetchJson(url, {
        signal,
        cacheKey: `line_${cacheKey}`,
        timeoutMs: 5500,
      });

      if (Array.isArray(data?.vehicles)) {
        const vehicles = normalizeDftransResponse(data);
        lineCache.set(cacheKey, { data: vehicles, updatedAt: Date.now() });
        return vehicles;
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      console.warn(
        `[DFTrans GPS] Filtro por linha ${normalizedLine} falhou no Cloudflare:`,
        error?.message
      );
    }
  }

  // Fallback: pega tudo e filtra no navegador. Mantém cache curto para não travar celular.
  const vehicles = await getAllLiveVehicles({ signal });
  const filtered = vehicles.filter((vehicle) => {
    return sameBusLine(vehicle.linha || vehicle.line, normalizedLine);
  });

  lineCache.set(cacheKey, { data: filtered, updatedAt: Date.now() });
  return filtered;
}

export async function fetchDftransVehicles(options = {}) {
  return getAllLiveVehicles(options);
}

export function getVehicleAgeMinutes(vehicle) {
  const timestamp =
    vehicle?.horario ||
    vehicle?.updatedAt ||
    null;

  if (!timestamp) return null;

  const diffMs = Date.now() - Number(timestamp);

  if (!Number.isFinite(diffMs)) return null;
  if (diffMs < 0) return 1;

  return Math.max(1, Math.round(diffMs / 60000));
}

export function formatVehicleAge(vehicle) {
  const minutes = getVehicleAgeMinutes(vehicle);

  if (!minutes) return 'Ao vivo';
  if (minutes === 1) return 'Ao vivo • 1 min';

  return `Ao vivo • ${minutes} min`;
}

export function findNearbyVehicles(vehicles, origin, radiusKm = 2) {
  if (!origin?.lat || !origin?.lon) return [];

  return vehicles
    .map((vehicle) => {
      const distanceKm = calculateDistanceKm(
        origin.lat,
        origin.lon,
        vehicle.lat,
        vehicle.lon
      );

      return {
        ...vehicle,
        distanceKm,
      };
    })
    .filter((vehicle) => vehicle.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;

  const dLat = toRad(Number(lat2) - Number(lat1));
  const dLon = toRad(Number(lon2) - Number(lon1));

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(Number(lat1))) *
    Math.cos(toRad(Number(lat2))) *
    Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value) {
  return value * Math.PI / 180;
}