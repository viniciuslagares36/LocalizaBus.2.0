// src/config/busConfig.js

// ─── TOMTOM CONFIG ────────────────────────────────────────────────────────────
// [TASK 4] categorySet removido para permitir buscas gerais de endereços,
// não apenas pontos de interesse de transporte público.
export const TOMTOM_CONFIG = {
  API_KEY: 'kVt12B5jgJTHfcvXLLDSPgcX6bz4f7R1',
  BASE_URL: 'https://api.tomtom.com/search/2',
  SEARCH_PARAMS: {
    idxSet: 'POI,PAD,STR',
    countrySet: 'BR',
    // categorySet: '9362', ← REMOVIDO: permitir busca geral de endereços
    lat: -15.7934,
    lon: -47.8823,
    radius: 50000,
    limit: 5,
    language: 'pt-BR',
  },
};

// ─── BACIA_CORES ──────────────────────────────────────────────────────────────
export const BACIA_CORES = {
  norte: {
    nome: 'Bacia Norte',
    cor: '#0a84ff',
    tipo: 'onibus',
    codigosLinha: ['0.1', '0.2', '0.3', '0.110', '0.111', '0.112', '0.113'],
  },
  sul: {
    nome: 'Bacia Sul',
    cor: '#30d158',
    tipo: 'onibus',
    codigosLinha: ['0.4', '0.5', '0.6', '0.120', '0.121', '0.122'],
  },
  leste: {
    nome: 'Bacia Leste',
    cor: '#ff9f0a',
    tipo: 'onibus',
    codigosLinha: ['0.7', '0.8', '0.130', '0.131', '0.132', '0.133'],
  },
  oeste: {
    nome: 'Bacia Oeste',
    cor: '#bf5af2',
    tipo: 'onibus',
    codigosLinha: ['0.9', '0.10', '0.140', '0.141', '0.142'],
  },
  central: {
    nome: 'Central/Expresso',
    cor: '#ff375f',
    tipo: 'onibus',
    codigosLinha: ['0.11', '0.12', '0.150', '0.151', '0.152', '0.153'],
  },
  metroVerde: {
    nome: 'Metrô Verde',
    cor: '#30d158',
    tipo: 'metro',
    codigosLinha: ['METRÔ', 'METRO', 'metro-verde', 'verde'],
  },
  metroLaranja: {
    nome: 'Metrô Laranja',
    cor: '#ff9f0a',
    tipo: 'metro',
    codigosLinha: ['metro-laranja', 'laranja', 'orange'],
  },
};

// [TASK 3] Fallback para linhas não mapeadas (ex.: 0.761) - evita cards vazios
export const BACIA_FALLBACK = {
  nome: 'Linha DF',
  cor: '#00f3ff', // Cyan Neon
  tipo: 'onibus',
};

// ─── identificarBacia ─────────────────────────────────────────────────────────
// [TASK 3] Retorna BACIA_FALLBACK quando nenhuma bacia corresponde ao código.
export const identificarBacia = (codigoLinha, modo) => {
  const modoStr = String(modo || '').toUpperCase();
  const raw = String(codigoLinha || '').trim();

  if (
    modoStr.includes('RAIL') ||
    modoStr.includes('METRO') ||
    modoStr.toLowerCase().includes('metro')
  ) {
    const metroMatch = Object.values(BACIA_CORES).find(
      (bacia) =>
        bacia.tipo === 'metro' &&
        bacia.codigosLinha.some((codigo) =>
          raw.toLowerCase().includes(String(codigo).toLowerCase())
        )
    );

    return metroMatch ?? BACIA_FALLBACK;
  }

  const normalized = raw
    .replace(/linha/gi, '')
    .replace(/[^0-9.]/g, '')
    .replace(/^0+/, '');

  const mainNumber = Number(normalized.split('.')[0]);

  if (Number.isFinite(mainNumber)) {
    if (mainNumber >= 100 && mainNumber < 200) {
      return {
        nome: 'Bacia Norte',
        cor: '#0a84ff',
        tipo: 'onibus',
      };
    }

    if (mainNumber >= 200 && mainNumber < 300) {
      return {
        nome: 'Bacia Sul',
        cor: '#30d158',
        tipo: 'onibus',
      };
    }

    if (mainNumber >= 300 && mainNumber < 400) {
      return {
        nome: 'Bacia Leste',
        cor: '#ff9f0a',
        tipo: 'onibus',
      };
    }

    if (mainNumber >= 400 && mainNumber < 500) {
      return {
        nome: 'São José',
        cor: '#a8875b',
        tipo: 'onibus',
      };
    }

    if (mainNumber >= 500 && mainNumber < 600) {
      return {
        nome: 'Bacia Oeste',
        cor: '#bf5af2',
        tipo: 'onibus',
      };
    }

    if (mainNumber >= 600 && mainNumber < 900) {
      return {
        nome: 'Central/Expresso',
        cor: '#ff375f',
        tipo: 'onibus',
      };
    }

    if (mainNumber < 100) {
      return {
        nome: 'Circular/Local',
        cor: '#64748b',
        tipo: 'onibus',
      };
    }
  }

  return BACIA_FALLBACK;
};

// ─── UTILS DE GEOLOCALIZAÇÃO ──────────────────────────────────────────────────

/** Distância em km entre dois pontos (Haversine). */
export const calcularDistancia = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** Tempo de caminhada em minutos (velocidade média 4.8 km/h). */
export const calcularTempoCaminhada = (distanciaKm) => {
  const VELOCIDADE_MEDIA_KMH = 4.8;
  return (distanciaKm / VELOCIDADE_MEDIA_KMH) * 60;
};
