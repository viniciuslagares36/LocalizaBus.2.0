// src/comp/RouteResultRefatorado.jsx
// Performance: useMemo/useCallback, lazy image, sem re-renders desnecessários
// Deep Link: geo: / maps:// para app nativo de GPS
// Botões: estética neon cyan #00f3ff mantida
// Ajuste: badge ao vivo agora mostra minutos desde a última atualização do GPS
import React, { useMemo, useCallback, useState, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bus, Train, Clock, MapPin, Footprints, ArrowRight, ExternalLink } from 'lucide-react';
import WalkingMapModal from './WalkingMapModal';
import LeafletMap from './LeafletMap';
import { calcularDistancia, calcularTempoCaminhada, identificarBacia } from '../config/busConfig';

// ─── Constantes fora do componente ───────────────────────────────────────────
const SPRING = { type: 'spring', stiffness: 120, damping: 22 };

const getReadableTextColor = (hexColor) => {
  const hex = String(hexColor || '').replace('#', '');

  if (hex.length !== 6) return '#ffffff';

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  return brightness > 155 ? '#111827' : '#ffffff';
};

const getLineBadgeStyle = (route) => {
  const bg =
    route.routeColor ||
    route.color ||
    route.bacia?.cor ||
    '#64748b';

  const color =
    route.routeTextColor ||
    route.textColor ||
    getReadableTextColor(bg);

  return {
    background: bg,
    color,
    border: `1px solid ${bg}`,
    boxShadow: `0 4px 12px ${bg}30`,
  };
};

const LineNumberBadge = memo(({ route }) => {
  if (route.isWalk) {
    return (
      <span
        className="text-[10px] font-extrabold px-2 py-1 rounded-lg"
        style={{
          background: 'rgba(0,243,255,0.12)',
          color: '#00f3ff',
          border: '1px solid rgba(0,243,255,0.28)',
        }}
      >
        A pé
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center justify-center min-w-[3.1rem] px-2.5 py-1 rounded-lg text-[11px] font-black tracking-tight shrink-0"
      style={getLineBadgeStyle(route)}
      title={route.bacia?.nome || 'Linha de ônibus'}
    >
      {route.line || '—'}
    </span>
  );
});

// ─── Badge GPS ao vivo ───────────────────────────────────────────────────────
const getGpsUpdateMinutes = (route) => {
  const timestamp =
    route?.realTimeGPS?.horario ||
    route?.realTimeGPS?.timestamp ||
    route?.realTimeGPS?.updatedAt ||
    route?.vehicle?.horario ||
    route?.horario ||
    route?.updatedAt ||
    null;

  if (!timestamp) return null;

  const gpsTime = Number(timestamp);
  if (!Number.isFinite(gpsTime)) return null;

  const diffMs = Date.now() - gpsTime;

  // Se vier tempo futuro ou estranho, ainda mostra ao vivo
  if (diffMs < 0) return 1;

  const diffMin = Math.max(1, Math.round(diffMs / 60000));

  // Evita mostrar GPS velho demais como se fosse atual
  if (diffMin > 120) return null;

  return diffMin;
};

const getLiveBadgeText = (route) => {
  const eta =
    route?.etaToNearestStopMinutes ??
    route?.time ??
    null;

  if (eta == null || !Number.isFinite(Number(eta))) {
    return 'Ao vivo';
  }

  const minutes = Number(eta);

  if (minutes <= 1) return 'AGORA';

  return `${minutes} min`;
};

const getEtaBadgeStyle = (route) => {
  const eta =
    route?.etaToNearestStopMinutes ??
    route?.time ??
    null;

  const minutes = Number(eta);

  if (!Number.isFinite(minutes)) {
    return {
      background: '#16a34a',
      border: '1px solid #15803d',
      boxShadow: '0 6px 16px rgba(22, 163, 74, 0.28)',
    };
  }

  if (minutes <= 1) {
    return {
      background: '#dc2626',
      border: '1px solid #b91c1c',
      boxShadow: '0 6px 16px rgba(220, 38, 38, 0.35)',
    };
  }

  if (minutes <= 3) {
    return {
      background: '#dc2626',
      border: '1px solid #b91c1c',
      boxShadow: '0 6px 16px rgba(220, 38, 38, 0.32)',
    };
  }

  return {
    background: '#16a34a',
    border: '1px solid #15803d',
    boxShadow: '0 6px 16px rgba(22, 163, 74, 0.28)',
  };
};


const LiveGpsBadge = memo(({ route }) => {
  const label = getLiveBadgeText(route);
  const style = getEtaBadgeStyle(route);

  return (
    <motion.div
      whileHover={{ scale: 1.03 }}
      className="inline-flex items-center justify-center gap-2 rounded-full px-3 py-1.5 text-xs font-extrabold select-none"
      style={{
        ...style,
        color: '#ffffff',
        minWidth: 88,
      }}
      title="Tempo estimado para o ônibus passar na parada próxima"
    >
      <span
        className="rounded-full"
        style={{
          width: 9,
          height: 9,
          background: '#ffffff',
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      {label}
    </motion.div>
  );
});

// ─── Utilitário: deep link para app nativo de GPS ────────────────────────────
const openNativeNav = (destName, destLat, destLon) => {
  const label = encodeURIComponent(destName || 'Destino');
  const coords = destLat && destLon ? `${destLat},${destLon}` : null;

  const geoUri = coords
    ? `geo:${coords}?q=${coords}(${label})`
    : `geo:0,0?q=${label}`;

  const appleUri = coords
    ? `maps://?daddr=${coords}&dirflg=w`
    : `maps://?q=${label}`;

  const gmapsUrl = coords
    ? `https://www.google.com/maps/dir/?api=1&destination=${coords}&travelmode=walking`
    : `https://www.google.com/maps/search/?api=1&query=${label}`;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  if (isIOS) {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = appleUri;
    document.body.appendChild(iframe);

    setTimeout(() => {
      document.body.removeChild(iframe);
      window.open(gmapsUrl, '_blank', 'noopener');
    }, 800);
  } else {
    const a = document.createElement('a');
    a.href = geoUri;
    a.click();

    setTimeout(() => {
      window.open(gmapsUrl, '_blank', 'noopener');
    }, 800);
  }
};

// ─── Skeleton de loading ─────────────────────────────────────────────────────
const SkeletonCard = memo(() => (
  <div className="h-24 rounded-2xl animate-pulse bg-gray-200 dark:bg-gray-700/60" />
));

// ─── Card de rota individual ─────────────────────────────────────────────────
const RouteCard = memo(({ route, idx, onWalkOpen, onFocusMap, sameLineVehicleCount = 1 }) => {
  const cardClass = useMemo(() => {
    if (route.isWalk) return 'border-cyan-300/50 bg-cyan-50/20 dark:border-cyan-800/40 dark:bg-cyan-900/10';
    if (route.isLive) return 'border-green-300/60 bg-green-50/30 dark:border-green-800/50 dark:bg-green-900/10';
    return 'border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-800/80 hover:shadow-md';
  }, [route.isWalk, route.isLive]);

  const handleDeepLink = useCallback(() => {
    openNativeNav(
      route.toStop || route.destination,
      route.toLat || null,
      route.toLon || null
    );
  }, [route.toStop, route.destination, route.toLat, route.toLon]);

  const handleWalkOpen = useCallback(() => onWalkOpen(route), [route, onWalkOpen]);

  return (
    <motion.div
      key={route.id}
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ delay: idx * 0.055, ...SPRING }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      className={`rounded-2xl border p-4 transition-colors duration-150 ${cardClass}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Lado esquerdo */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {route.isWalk ? (
            <div
              className="rounded-full p-2 flex-shrink-0"
              style={{
                background: 'rgba(0,243,255,0.1)',
                border: '1px solid rgba(0,243,255,0.25)',
              }}
            >
              <Footprints className="h-4 w-4 text-cyan-400" strokeWidth={1.5} />
            </div>
          ) : route.bacia ? (
            <div
              className="rounded-full p-2 flex-shrink-0"
              style={{
                background: `${route.bacia.cor}18`,
                border: `1px solid ${route.bacia.cor}35`,
              }}
            >
              {route.bacia.tipo === 'metro' ? (
                <Train className="h-4 w-4" style={{ color: route.bacia.cor }} strokeWidth={1.5} />
              ) : (
                <Bus className="h-4 w-4" style={{ color: route.bacia.cor }} strokeWidth={1.5} />
              )}
            </div>
          ) : null}

          <div className="flex-1 min-w-0">
            {/* Badge + nome */}
<div className="flex items-center gap-2 flex-wrap mb-1.5">
  <LineNumberBadge route={route} />

  {route.isLive && route.realTimeGPS?.numero ? (
  <div className="flex items-center gap-2 flex-wrap mb-1.5">
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-700/70 text-slate-100 border border-slate-500/30">
      Veículo {route.realTimeGPS.numero}
    </span>

    {sameLineVehicleCount > 1 ? (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-400/30">
        {sameLineVehicleCount} veículos nessa linha
      </span>
    ) : null}
  </div>
) : null}

  <span className="font-semibold text-sm text-gray-900 dark:text-white tracking-tight">
    {route.isWalk
      ? 'Rota a pé'
      : route.bacia?.nome || 'Ônibus'}
  </span>
</div>

            {/* Métricas */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-gray-400" strokeWidth={1.5} />
                <span className="text-xs font-semibold text-blue-500 dark:text-blue-400">
                  {route.time} min
                </span>
              </div>

              {!route.isWalk && route.stops ? (
                <div className="flex items-center gap-1">
                  <MapPin className="h-3 w-3 text-gray-400" strokeWidth={1.5} />
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {route.stops} paradas
                  </span>
                </div>
              ) : null}

              {route.distance && (
                <span className="text-xs text-gray-400">
                  {route.distance} km
                </span>
              )}

            </div>

            {/* Ponto de embarque / instrução */}
            {route.isWalk ? (
              <p className="text-[10px] text-gray-400 mt-1 truncate">
                {route.instruction}
              </p>
            ) : route.fromStop ? (
              <>
                <p className="text-[10px] text-gray-400 mt-1 truncate">
                  Embarque: {route.fromStop}
                </p>

                {route.instruction && (
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                    {route.instruction}
                  </p>
                )}
              </>
            ) : null}
          </div>
        </div>

        {/* Lado direito */}
        <div className="flex items-center gap-2 self-start sm:self-center flex-wrap">
          {route.isWalk ? (
            <>
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleWalkOpen}
                className="rounded-full px-3 py-1.5 text-xs font-semibold flex items-center gap-1"
                style={{
                  background: 'rgba(0,243,255,0.1)',
                  border: '1px solid rgba(0,243,255,0.35)',
                  color: '#00f3ff',
                  boxShadow: '0 0 12px rgba(0,243,255,0.15)',
                }}
              >
                <Footprints className="h-3 w-3" strokeWidth={1.5} />
                Navegar
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleDeepLink}
                className="rounded-full px-3 py-1.5 text-xs font-semibold flex items-center gap-1 text-white"
                style={{
                  background: 'linear-gradient(135deg,rgba(0,243,255,0.2),rgba(0,113,227,0.35))',
                  border: '1px solid rgba(0,243,255,0.4)',
                  boxShadow: '0 0 14px rgba(0,243,255,0.18)',
                }}
                title="Abrir no Maps nativo"
              >
                <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                Abrir Maps
              </motion.button>
            </>
          ) : (
            <>
              <LiveGpsBadge route={route} />

              {!route.caminhadaInfo && (
                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleWalkOpen}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold flex items-center gap-1"
                  style={{
                    background: 'rgba(0,243,255,0.07)',
                    border: '1px solid rgba(0,243,255,0.28)',
                    color: '#00f3ff',
                    boxShadow: '0 0 10px rgba(0,243,255,0.1)',
                  }}
                >
                  <Footprints className="h-3 w-3" strokeWidth={1.5} />
                  Caminhar
                </motion.button>
              )}

              {route.isLive ? (
                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => onFocusMap?.(route.id)}
                  className="rounded-full px-4 py-1.5 text-xs font-semibold text-white bg-green-600"
                >
                  Ver mapa
                </motion.button>
              ) : route.nearestStopLat && route.nearestStopLon ? (
                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => onFocusMap?.(route.id)}
                  className="rounded-full px-4 py-1.5 text-xs font-semibold text-white bg-blue-500"
                >
                  Ver rota
                </motion.button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
});

// ─── Componente principal ────────────────────────────────────────────────────
const RouteResultRefatorado = ({ routes, origin, destination, loading, userLocation, isDark }) => {
  const [walkRoute, setWalkRoute] = useState(null);
  const [selectedRouteId, setSelectedRouteId] = useState(null);

const processedRoutes = useMemo(() => {
  if (!routes?.length) return [];

  const mapped = routes
    .map(route => {
      const bacia = identificarBacia(route.line, route.mode);

      let caminhadaInfo = null;

      if (userLocation && route.fromStop) {
        const distKm = calcularDistancia(
          userLocation.lat,
          userLocation.lon,
          route.lat || -15.7934,
          route.lon || -47.8823
        );

        caminhadaInfo = {
          distancia: distKm.toFixed(1),
          tempo: Math.ceil(calcularTempoCaminhada(distKm)),
        };
      }

      return {
        ...route,
        bacia: route.isWalk ? null : bacia,
        caminhadaInfo,
      };
    })
    .sort((a, b) => {
      const etaA = Number(a.etaToNearestStopMinutes ?? a.time ?? 9999);
      const etaB = Number(b.etaToNearestStopMinutes ?? b.time ?? 9999);

      if (etaA !== etaB) return etaA - etaB;

      const lineA = String(a.line || '');
      const lineB = String(b.line || '');

      return lineA.localeCompare(lineB);
    });

  const unique = new Map();

  mapped.forEach((route) => {
    const line = String(route.line || '').trim();
    const vehicleNumber =
      route.realTimeGPS?.numero ||
      route.vehicleNumber ||
      null;

    // Se tiver GPS ao vivo, a identidade real é linha + número do veículo.
    // Assim o mesmo ônibus não aparece duplicado.
    const key =
      route.isLive && vehicleNumber
        ? `live_${line}_${vehicleNumber}`
        : `route_${route.id}`;

    const current = unique.get(key);

    if (!current) {
      unique.set(key, route);
      return;
    }

    const currentEta = Number(current.etaToNearestStopMinutes ?? current.time ?? 9999);
    const nextEta = Number(route.etaToNearestStopMinutes ?? route.time ?? 9999);

    // Se por algum motivo o mesmo veículo apareceu em duas rotas,
    // mantém a rota com menor tempo até a parada.
    if (nextEta < currentEta) {
      unique.set(key, route);
    }
  });

  return Array.from(unique.values()).sort((a, b) => {
    const etaA = Number(a.etaToNearestStopMinutes ?? a.time ?? 9999);
    const etaB = Number(b.etaToNearestStopMinutes ?? b.time ?? 9999);

    if (etaA !== etaB) return etaA - etaB;

    const lineA = String(a.line || '');
    const lineB = String(b.line || '');

    return lineA.localeCompare(lineB);
  });
}, [routes, userLocation]);

  const hasLive = useMemo(
    () => processedRoutes.some(r => r.isLive),
    [processedRoutes]
  );
  const userPosition = useMemo(() => {
  const origin = window.__lastOriginCoords;

  if (origin?.lat && origin?.lon) {
    return {
      lat: Number(origin.lat),
      lon: Number(origin.lon),
    };
  }

  return null;
}, [processedRoutes]);
  const visibleBusRoutes = useMemo(() => {
    return processedRoutes
      .filter((route) => route.realTimeGPS?.lat && route.realTimeGPS?.lon)
      .sort((a, b) => {
        const etaA = Number(a.etaToNearestStopMinutes ?? a.time ?? 9999);
        const etaB = Number(b.etaToNearestStopMinutes ?? b.time ?? 9999);

        if (etaA !== etaB) return etaA - etaB;

        const distA = Number(a.distance ?? 9999);
        const distB = Number(b.distance ?? 9999);

        return distA - distB;
      })
      .slice(0, 5);
  }, [processedRoutes]);

  const lineVehicleCount = useMemo(() => {
  const map = new Map();

  processedRoutes.forEach((route) => {
    const line = String(route.line || '').trim();
    if (!line) return;

    const current = map.get(line) || new Set();

    const vehicleNumber =
      route.realTimeGPS?.numero ||
      route.vehicleNumber ||
      route.id;

    current.add(String(vehicleNumber));

    map.set(line, current);
  });

  const result = new Map();

  map.forEach((set, line) => {
    result.set(line, set.size);
  });

  return result;
}, [processedRoutes]);

const liveMarkers = useMemo(
  () =>
    visibleBusRoutes.map((route, index) => ({
      id: `bus_${route.id || index}_${route.line}_${route.realTimeGPS.numero || index}`,
      routeId: route.id,

      lat: Number(route.realTimeGPS.lat),
      lon: Number(route.realTimeGPS.lon),
      type: 'bus',

      line: route.line,
      vehicleNumber: route.realTimeGPS.numero || '',
      bearing: route.realTimeGPS.bearing ?? 0,
      speed: route.realTimeGPS.speed ?? 0,

      fromStop: route.fromStop || route.nearestStopName || 'Parada próxima',
      toStop: route.toStop || route.destination || 'Destino',
      destination: route.destination || '',
      sentido: route.realTimeGPS.sentido || route.sentido || null,

      etaMinutes:
        route.etaToNearestStopMinutes ??
        route.time ??
        null,

      gpsTimestamp:
        route.realTimeGPS?.updatedAt ||
        route.realTimeGPS?.horario ||
        route.updatedAt ||
        route.horario ||
        null,

      isGpsOnly: route.isGpsOnly || false,

      itinerary:
        route.routeLongName ||
        route.longName ||
        route.instruction ||
        `Linha ${route.line} — ${route.fromStop || 'origem'} → ${route.toStop || route.destination || 'destino'}`,
    })),
  [visibleBusRoutes]
);

  const liveCenter = useMemo(() => {
    const routeWithStop = processedRoutes.find(
      (route) => route.nearestStopLat && route.nearestStopLon
    );

    if (routeWithStop) {
      return [
        Number(routeWithStop.nearestStopLon),
        Number(routeWithStop.nearestStopLat),
      ];
    }

    const firstBus = liveMarkers[0];
    return firstBus ? [firstBus.lon, firstBus.lat] : null;
  }, [processedRoutes, liveMarkers]);
  const handleWalkOpen = useCallback(route => setWalkRoute(route), []);
  const handleClose = useCallback(() => setWalkRoute(null), []);

  if (loading) {
    return (
      <div className="mt-6 space-y-3">
        {[1, 2, 3].map(i => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (!processedRoutes.length) return null;

  return (
    <>
      <AnimatePresence>
        {walkRoute && (
          <WalkingMapModal
            route={walkRoute}
            userLocation={userLocation}
            onClose={handleClose}
            isDark={isDark}
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="mt-7 space-y-4"
      >
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1">
              {processedRoutes[0]?.isWalk ? 'Rota a pé — TomTom' : 'Rotas SEMOB / DFTrans'}
            </p>

            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[140px]">
                {origin}
              </p>

              <ArrowRight className="h-3 w-3 text-gray-400 flex-shrink-0" />

              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[140px]">
                {destination}
              </p>
            </div>
          </div>

          <span className="text-xs text-gray-500 flex-shrink-0 mt-1">
            {processedRoutes.length} {processedRoutes.length === 1 ? 'opção' : 'opções'}
          </span>
        </div>

        {/* Status GPS */}
        <div className="flex items-center gap-2">
          <div
            className={`h-1.5 w-1.5 rounded-full animate-pulse ${hasLive ? 'bg-green-500' : 'bg-gray-400'
              }`}
          />

          <span
            className={`text-[10px] font-semibold ${hasLive
              ? 'text-green-600 dark:text-green-400'
              : 'text-gray-500 dark:text-gray-400'
              }`}
          >
            {hasLive ? '🚀 GPS REAL — Veículos ao vivo' : 'Dados de horários — SEMOB/DFTrans'}
          </span>
        </div>

{hasLive && liveCenter && (
  <div className="rounded-2xl overflow-hidden border border-cyan-400/20">
<LeafletMap
  center={liveCenter}
  markers={liveMarkers}
  routes={processedRoutes}
  userPosition={userPosition}
  selectedRouteId={selectedRouteId}
  isDark={isDark}
/>
  </div>
)}

        {/* Cards */}
        <div className="space-y-2.5">
          <AnimatePresence>
            {processedRoutes.map((route, idx) => (
<RouteCard
  key={route.id}
  route={route}
  idx={idx}
  onWalkOpen={handleWalkOpen}
  onFocusMap={setSelectedRouteId}
  sameLineVehicleCount={lineVehicleCount.get(String(route.line || '').trim()) || 1}
/>
            ))}
          </AnimatePresence>
        </div>
      </motion.div>
    </>
  );
};

export default React.memo(RouteResultRefatorado);