// src/comp/RouteResultRefatorado.jsx
// Performance: useMemo/useCallback, lazy image, sem re-renders desnecessários
// Deep Link: geo: / maps:// para app nativo de GPS
// Botões: estética neon cyan #00f3ff mantida
import React, { useMemo, useCallback, useState, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bus, Train, Clock, MapPin, Footprints, ArrowRight, ExternalLink } from 'lucide-react';
import BadgeTempo from './BadgeTempo';
import WalkingMapModal from './WalkingMapModal';
import { calcularDistancia, calcularTempoCaminhada, identificarBacia } from '../config/busConfig';

// ─── Constantes fora do componente (sem recriação a cada render) ─────────────
const SPRING = { type: 'spring', stiffness: 120, damping: 22 };

// ─── Utilitário: deep link para app nativo de GPS ────────────────────────────
/**
 * Tenta abrir o app nativo de navegação com protocolo geo:/maps:
 * Fallback: Google Maps na web
 */
const openNativeNav = (destName, destLat, destLon) => {
  const label  = encodeURIComponent(destName || 'Destino');
  const coords = destLat && destLon ? `${destLat},${destLon}` : null;

  // iOS Maps / Android Maps nativo (geo:)
  const geoUri = coords
    ? `geo:${coords}?q=${coords}(${label})`
    : `geo:0,0?q=${label}`;

  // Apple Maps (maps://)
  const appleUri = coords
    ? `maps://?daddr=${coords}&dirflg=w`
    : `maps://?q=${label}`;

  // Google Maps web fallback
  const gmapsUrl = coords
    ? `https://www.google.com/maps/dir/?api=1&destination=${coords}&travelmode=walking`
    : `https://www.google.com/maps/search/?api=1&query=${label}`;

  // Detecta iOS
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  if (isIOS) {
    // Tenta Apple Maps, depois Google Maps
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = appleUri;
    document.body.appendChild(iframe);
    setTimeout(() => {
      document.body.removeChild(iframe);
      window.open(gmapsUrl, '_blank', 'noopener');
    }, 800);
  } else {
    // Android/Desktop: tenta geo:, fallback Google Maps
    const a = document.createElement('a');
    a.href = geoUri;
    a.click();
    setTimeout(() => window.open(gmapsUrl, '_blank', 'noopener'), 800);
  }
};

// ─── Skeleton de loading ──────────────────────────────────────────────────────
const SkeletonCard = memo(() => (
  <div className="h-24 rounded-2xl animate-pulse bg-gray-200 dark:bg-gray-700/60" />
));

// ─── Card de rota individual (memoizado) ──────────────────────────────────────
const RouteCard = memo(({ route, idx, onWalkOpen }) => {
  const cardClass = useMemo(() => {
    if (route.isWalk)  return 'border-cyan-300/50 bg-cyan-50/20 dark:border-cyan-800/40 dark:bg-cyan-900/10';
    if (route.isLive)  return 'border-green-300/60 bg-green-50/30 dark:border-green-800/50 dark:bg-green-900/10';
    return 'border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-800/80 hover:shadow-md';
  }, [route.isWalk, route.isLive]);

  const handleDeepLink = useCallback(() => {
    openNativeNav(
      route.toStop || route.destination,
      route.toLat  || null,
      route.toLon  || null
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
      // ── whileHover com transform leve — não usa layout (evita lag) ────────
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      className={`rounded-2xl border p-4 transition-colors duration-150 ${cardClass}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">

        {/* ── Lado esquerdo: ícone + info ── */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Ícone */}
          {route.isWalk ? (
            <div className="rounded-full p-2 flex-shrink-0"
              style={{ background: 'rgba(0,243,255,0.1)', border: '1px solid rgba(0,243,255,0.25)' }}>
              <Footprints className="h-4 w-4 text-cyan-400" strokeWidth={1.5} />
            </div>
          ) : route.bacia ? (
            <div className="rounded-full p-2 flex-shrink-0"
              style={{ background: `${route.bacia.cor}18`, border: `1px solid ${route.bacia.cor}35` }}>
              {route.bacia.tipo === 'metro'
                ? <Train className="h-4 w-4" style={{ color: route.bacia.cor }} strokeWidth={1.5} />
                : <Bus   className="h-4 w-4" style={{ color: route.bacia.cor }} strokeWidth={1.5} />}
            </div>
          ) : null}

          <div className="flex-1 min-w-0">
            {/* Badge + nome */}
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              {route.isWalk ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(0,243,255,0.1)', color: '#00f3ff' }}>
                  Caminhada
                </span>
              ) : route.bacia ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: `${route.bacia.cor}18`, color: route.bacia.cor }}>
                  {route.bacia.nome}
                </span>
              ) : null}
              <span className="font-semibold text-sm text-gray-900 dark:text-white tracking-tight">
                {route.isWalk ? 'Rota a pé' : `Linha ${route.line}`}
              </span>
            </div>

            {/* Métricas */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-gray-400" strokeWidth={1.5} />
                <span className="text-xs font-semibold text-blue-500 dark:text-blue-400">{route.time} min</span>
              </div>
              {!route.isWalk && route.stops ? (
                <div className="flex items-center gap-1">
                  <MapPin className="h-3 w-3 text-gray-400" strokeWidth={1.5} />
                  <span className="text-xs text-gray-500 dark:text-gray-400">{route.stops} paradas</span>
                </div>
              ) : null}
              {route.distance && (
                <span className="text-xs text-gray-400">{route.distance} km</span>
              )}

              {/* Badge de caminhada até o ponto (rotas de ônibus) */}
              {!route.isWalk && route.caminhadaInfo && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleWalkOpen}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full"
                  style={{
                    background: 'rgba(0,243,255,0.07)',
                    border: '1px solid rgba(0,243,255,0.28)',
                    boxShadow: '0 0 8px rgba(0,243,255,0.08)',
                  }}
                  title="Ver rota a pé no mapa"
                >
                  <Footprints className="h-3 w-3 text-cyan-400" strokeWidth={1.5} />
                  <span className="text-xs font-semibold text-cyan-400">
                    {route.caminhadaInfo.distancia}km • {route.caminhadaInfo.tempo}min
                  </span>
                  <span className="text-[9px] text-cyan-300 hidden sm:inline ml-0.5">ver mapa</span>
                </motion.button>
              )}
            </div>

            {/* Ponto de embarque / instrução */}
            {route.isWalk ? (
              <p className="text-[10px] text-gray-400 mt-1 truncate">{route.instruction}</p>
            ) : route.fromStop ? (
              <p className="text-[10px] text-gray-400 mt-1 truncate">Embarque: {route.fromStop}</p>
            ) : null}
          </div>
        </div>

        {/* ── Lado direito: badge + botões ── */}
        <div className="flex items-center gap-2 self-start sm:self-center flex-wrap">
          {route.isWalk ? (
            <>
              {/* Botão mapa interno */}
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

              {/* Deep link para app nativo */}
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
              <BadgeTempo
                gps_active={route.badgeEstado.gps_active}
                time={route.badgeEstado.time}
                modo={route.badgeEstado.modo}
              />

              {/* Caminhar até o ponto (sem caminhadaInfo calculada) */}
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

              {/* Detalhes / Ver mapa */}
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold text-white ${
                  route.isLive ? 'bg-green-600' : 'bg-blue-500'
                }`}
              >
                {route.isLive ? 'Ver mapa' : 'Detalhes'}
              </motion.button>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
});

// ─── Componente principal ─────────────────────────────────────────────────────
const RouteResultRefatorado = ({ routes, origin, destination, loading, userLocation, isDark }) => {
  const [walkRoute, setWalkRoute] = useState(null);

  // ── Memoização dos dados processados ─────────────────────────────────────
  const processedRoutes = useMemo(() => {
    if (!routes?.length) return [];
    return routes.map(route => {
      const bacia = identificarBacia(route.line, route.mode);

      // calcularDistancia e calcularTempoCaminhada são chamados uma vez por rota,
      // e processedRoutes só é recalculado quando routes ou userLocation mudam
      let caminhadaInfo = null;
      if (userLocation && route.fromStop) {
        const distKm = calcularDistancia(
          userLocation.lat, userLocation.lon,
          route.lat  || -15.7934,
          route.lon  || -47.8823
        );
        caminhadaInfo = {
          distancia: distKm.toFixed(1),
          tempo: Math.ceil(calcularTempoCaminhada(distKm)),
        };
      }

      return {
        ...route,
        bacia:      route.isWalk ? null : bacia,
        caminhadaInfo,
        badgeEstado: {
          gps_active: route.isLive || false,
          time:       route.time   || 0,
          modo:       route.isWalk ? 'caminhada' : (bacia?.tipo || (route.mode === 'BUS' ? 'onibus' : 'metro')),
        },
      };
    });
  }, [routes, userLocation]);

  const hasLive = useMemo(() => processedRoutes.some(r => r.isLive), [processedRoutes]);

  // useCallback garante referência estável para os RouteCard memoizados
  const handleWalkOpen = useCallback(route => setWalkRoute(route), []);
  const handleClose    = useCallback(() => setWalkRoute(null), []);

  if (loading) return (
    <div className="mt-6 space-y-3">
      {[1,2,3].map(i => <SkeletonCard key={i} />)}
    </div>
  );

  if (!processedRoutes.length) return null;

  return (
    <>
      {/* ── Modal de navegação a pé ── */}
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
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[140px]">{origin}</p>
              <ArrowRight className="h-3 w-3 text-gray-400 flex-shrink-0" />
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[140px]">{destination}</p>
            </div>
          </div>
          <span className="text-xs text-gray-500 flex-shrink-0 mt-1">
            {processedRoutes.length} {processedRoutes.length === 1 ? 'opção' : 'opções'}
          </span>
        </div>

        {/* Status GPS */}
        <div className="flex items-center gap-2">
          <div className={`h-1.5 w-1.5 rounded-full animate-pulse ${hasLive ? 'bg-green-500' : 'bg-gray-400'}`} />
          <span className={`text-[10px] font-semibold ${hasLive ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
            {hasLive ? '🚀 GPS REAL — Veículos ao vivo' : 'Dados de horários — SEMOB/DFTrans'}
          </span>
        </div>

        {/* Cards */}
        <div className="space-y-2.5">
          <AnimatePresence>
            {processedRoutes.map((route, idx) => (
              <RouteCard
                key={route.id}
                route={route}
                idx={idx}
                onWalkOpen={handleWalkOpen}
              />
            ))}
          </AnimatePresence>
        </div>
      </motion.div>
    </>
  );
};

export default React.memo(RouteResultRefatorado);
