import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bus,
  Train,
  Clock,
  MapPin,
  Footprints,
  ArrowRight,
} from 'lucide-react';

import TomTomMap from './TomTomMap';

const spring = { type: 'spring', stiffness: 120, damping: 22 };

const normalizeNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
};

const getMainEta = (route) => {
  const eta =
    route?.etaToNearestStopMinutes ??
    route?.time ??
    route?.estimatedTime ??
    null;

  return normalizeNumber(eta);
};

const getBadgeState = (route) => {
  const time = getMainEta(route);

  if (route?.isLive && time !== null && time <= 1) {
    return {
      key: 'imminent',
      label: 'Chegando',
      timeLabel: 'agora',
      classes:
        'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
      dot: 'bg-red-500',
    };
  }

  if (route?.isLive) {
    return {
      key: 'live',
      label: 'Passa em',
      timeLabel: time !== null ? `${time} min` : null,
      classes:
        'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
      dot: 'bg-red-500',
    };
  }

  return {
    key: 'scheduled',
    label: 'Programado',
    timeLabel: time !== null ? `${time} min` : null,
    classes:
      'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
    dot: 'bg-gray-400',
  };
};

const getLineStyle = (route) => {
  const line = String(route?.line || route?.routeId || '').toLowerCase();
  const mode = String(route?.mode || '').toUpperCase();

  if (
    mode.includes('SUBWAY') ||
    mode.includes('RAIL') ||
    mode.includes('METRO') ||
    line.includes('metro')
  ) {
    if (line.includes('laranja') || line.includes('orange')) {
      return {
        border: 'border-orange-500/50',
        pill: 'bg-orange-500',
        label: 'Metrô Laranja',
      };
    }

    return {
      border: 'border-green-500/50',
      pill: 'bg-green-500',
      label: 'Metrô Verde',
    };
  }

  if (line.startsWith('0.') || line.startsWith('0')) {
    return {
      border: 'border-orange-500/40',
      pill: 'bg-orange-500',
      label: 'Bacia Leste',
    };
  }

  return {
    border: 'border-cyan-500/40',
    pill: 'bg-cyan-500',
    label: 'Linha DF',
  };
};

const TempoBadge = ({ route }) => {
  const badge = getBadgeState(route);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${badge.key}-${badge.timeLabel || ''}`}
        initial={{ opacity: 0, y: 4, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.96 }}
        transition={{ duration: 0.18 }}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-wide ${badge.classes}`}
      >
        <span className="relative flex h-2 w-2">
          {badge.key !== 'scheduled' && (
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-70 ${badge.dot}`}
            />
          )}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${badge.dot}`} />
        </span>

        <span>{badge.label}</span>

        {badge.timeLabel && (
          <span className="font-semibold opacity-90">• {badge.timeLabel}</span>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

const RouteResultRefatorado = ({
  routes,
  origin,
  destination,
  loading,
  userLocation,
  isDark = true,
}) => {
  const processedRoutes = useMemo(() => {
    if (!Array.isArray(routes)) return [];

    return routes.map((route) => ({
      ...route,
      visual: getLineStyle(route),
      badge: getBadgeState(route),
    }));
  }, [routes]);

  const hasLiveRoutes = useMemo(
    () => processedRoutes.some((route) => route.isLive),
    [processedRoutes]
  );

  const liveMarkers = useMemo(
    () =>
      processedRoutes
        .filter((route) => route.realTimeGPS?.lat && route.realTimeGPS?.lon)
        .slice(0, 8)
        .map((route) => ({
          lat: Number(route.realTimeGPS.lat),
          lon: Number(route.realTimeGPS.lon),
          type: 'bus',
          line: route.line,
          bearing: route.realTimeGPS.bearing ?? 0,
          vehicleNumber: route.realTimeGPS.numero || route.numero || '',
          popup: `Linha ${route.line} • Veículo ${
            route.realTimeGPS.numero || 'ao vivo'
          } • ${Math.round(route.realTimeGPS.speed || 0)} km/h`,
        })),
    [processedRoutes]
  );

  const stopMarkers = useMemo(
    () =>
      processedRoutes
        .filter((route) => route.nearestStopLat && route.nearestStopLon)
        .map((route) => ({
          lat: Number(route.nearestStopLat),
          lon: Number(route.nearestStopLon),
          type: 'stop',
          popup: `Parada próxima: ${
            route.nearestStopName || route.fromStop || 'Parada'
          }`,
        }))
        .filter((marker, index, arr) => {
          const key = `${marker.lat.toFixed(6)}_${marker.lon.toFixed(6)}`;

          return (
            arr.findIndex(
              (m) => `${m.lat.toFixed(6)}_${m.lon.toFixed(6)}` === key
            ) === index
          );
        }),
    [processedRoutes]
  );

  const mapMarkers = useMemo(() => {
    return [...stopMarkers, ...liveMarkers];
  }, [stopMarkers, liveMarkers]);

  const liveCenter = useMemo(() => {
    const first = liveMarkers[0] || stopMarkers[0];

    return first ? [first.lon, first.lat] : null;
  }, [liveMarkers, stopMarkers]);

  if (loading) {
    return (
      <div className="mt-6 space-y-3">
        {[1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-24 rounded-2xl animate-pulse bg-[var(--skeleton-bg)]"
          />
        ))}
      </div>
    );
  }

  if (!processedRoutes.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="mt-7 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
            Rotas SEMOB / DFTrans
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            <p className="max-w-[140px] truncate text-sm font-semibold text-[var(--text-primary)]">
              {origin}
            </p>

            <ArrowRight className="h-3 w-3 flex-shrink-0 text-[var(--text-tertiary)]" />

            <p className="max-w-[140px] truncate text-sm font-semibold text-[var(--text-primary)]">
              {destination}
            </p>
          </div>
        </div>

        <span className="mt-1 flex-shrink-0 text-xs font-medium text-[var(--text-tertiary)]">
          {processedRoutes.length}{' '}
          {processedRoutes.length === 1 ? 'opção' : 'opções'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div
          className={`h-1.5 w-1.5 rounded-full ${
            hasLiveRoutes ? 'animate-pulse bg-green-500' : 'bg-gray-400'
          }`}
        />

        <span
          className={`text-[10px] font-semibold ${
            hasLiveRoutes
              ? 'text-green-500'
              : 'text-[var(--text-tertiary)]'
          }`}
        >
          {hasLiveRoutes
            ? 'GPS real — veículos ao vivo'
            : 'Sem GPS real — horários programados'}
        </span>
      </div>

      {hasLiveRoutes && liveCenter && (
        <div className="rounded-2xl overflow-hidden border border-cyan-400/20">
          <TomTomMap
            center={liveCenter}
            markers={mapMarkers}
            isDark={isDark}
          />
        </div>
      )}

      <div className="space-y-2.5">
        {processedRoutes.map((route, index) => {
          const isBus = String(route.mode || '').toUpperCase().includes('BUS');
          const Icon = isBus ? Bus : Train;
          const eta = getMainEta(route);

          return (
            <motion.div
              key={route.id || `${route.line}-${index}`}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05, ...spring }}
              whileHover={{ y: -2 }}
              className={`rounded-2xl border bg-[var(--card-inner)] p-4 transition-all duration-200 ${route.visual.border}`}
            >
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="relative flex-shrink-0 rounded-full bg-[var(--accent)]/10 p-2">
                    <Icon
                      className="h-4 w-4 text-[var(--accent)]"
                      strokeWidth={1.7}
                    />

                    <span
                      className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--card-inner)] ${route.visual.pill}`}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold tracking-tight text-[var(--text-primary)]">
                        Linha {route.line || route.routeId || 'N/A'}
                      </span>

                      <span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--accent)]">
                        {route.visual.label}
                      </span>

                      <TempoBadge route={route} />
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {eta !== null && (
                        <div className="flex items-center gap-1">
                          <Clock
                            className="h-3 w-3 text-[var(--text-tertiary)]"
                            strokeWidth={1.5}
                          />

                          <span className="text-xs font-semibold text-[var(--accent)]">
                            {eta} min
                          </span>
                        </div>
                      )}

                      {route.distance && (
                        <div className="flex items-center gap-1">
                          <MapPin
                            className="h-3 w-3 text-[var(--text-tertiary)]"
                            strokeWidth={1.5}
                          />

                          <span className="text-xs text-[var(--text-secondary)]">
                            {route.distance} km
                          </span>
                        </div>
                      )}

                      {route.walkMinutes > 0 && (
                        <div className="flex items-center gap-1">
                          <Footprints
                            className="h-3 w-3 text-[var(--text-tertiary)]"
                            strokeWidth={1.5}
                          />

                          <span className="text-xs text-[var(--text-secondary)]">
                            {route.walkMinutes} min a pé
                          </span>
                        </div>
                      )}
                    </div>

                    <p className="mt-1 truncate text-[10px] text-[var(--text-tertiary)]">
                      Embarque: {route.fromStop || 'ponto próximo'}
                    </p>

                    {route.instruction && (
                      <p className="mt-1 line-clamp-2 text-[10px] text-[var(--text-secondary)]">
                        {route.instruction}
                      </p>
                    )}
                  </div>
                </div>

                <button
                  className={`self-start rounded-full px-4 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90 sm:self-center ${
                    route.isLive ? 'bg-green-600' : 'bg-[var(--accent)]'
                  }`}
                >
                  {route.isLive ? 'Ver mapa' : 'Detalhes'}
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
};

export default React.memo(RouteResultRefatorado);