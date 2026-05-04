import React, { useState, useEffect, useRef, useCallback, Component } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bus, Footprints, MapPin, Train, Clock, ArrowRight,
  ChevronDown, Circle, Navigation, Search, AlertCircle,
  Loader2, Sun, Moon, AlertTriangle
} from 'lucide-react';
import axios from 'axios';
import RouteResultRefatorado from './comp/RouteResultRefatorado';
import {
  getTransitlandStopsNearby,
  getTransitlandTransitPlan,
  getTransitlandWalkingPlan,
  normalizeTransitlandItineraryMode,
} from './services/transitland';

// ─── API CONFIG ────────────────────────────────
const TOMTOM_API_KEY = 'kVt12B5jgJTHfcvXLLDSPgcX6bz4f7R1';
// Transitland fica em src/services/transitland.js.
// TomTom permanece apenas para mapa, busca e geocoding.


// Normaliza códigos para comparar linhas de transporte (ex: "Linha 143.2", "143.2", "0.143")
const normalizeLineCode = (value) => String(value || '')
  .toLowerCase()
  .replace('linha', '')
  .replace(/[^0-9a-z.]/g, '')
  .replace(/^0+(?=\d)/, '')
  .trim();

const sameLine = (a, b) => {
  const x = normalizeLineCode(a);
  const y = normalizeLineCode(b);
  return !!x && !!y && (x === y || x.endsWith(y) || y.endsWith(x));
};

const getEtaMinutes = (eta) => {
  if (!eta) return null;
  const minutes = Math.round((new Date(eta).getTime() - Date.now()) / 60000);
  return Number.isFinite(minutes) ? Math.max(minutes, 0) : null;
};

// ─── XSS PREVENTION ────────────────────────────
const sanitizeInput = (value) => {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/[<>"'`]/g, '')
    .slice(0, 300);
};

// ─── ERROR BOUNDARY ─────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(e, i) { console.error('[ErrorBoundary]', e, i); }
  render() {
    if (this.state.hasError) return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center p-8 rounded-3xl bg-[var(--card-bg)] border border-[var(--border)] shadow-2xl max-w-sm mx-4">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2 tracking-tight">Algo deu errado</h2>
          <p className="text-sm text-[var(--text-secondary)] mb-6">Um erro inesperado ocorreu. Recarregue a página.</p>
          <button onClick={() => window.location.reload()}
            className="px-6 py-3 rounded-full bg-[var(--accent)] text-white text-sm font-semibold hover:opacity-90 transition-opacity">
            Recarregar
          </button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

// ─── SPRING ─────────────────────────────────────
const spring = { type: 'spring', stiffness: 120, damping: 22 };

const carouselImages = [
  { src: 'https://wallpaperaccess.com/full/2073412.jpg', title: 'Catedral de Brasília' },
  { src: 'https://wallpaperaccess.com/full/2073407.jpg', title: 'Estádio Mané Garrincha' },
  { src: 'https://wallpaperaccess.com/full/2073416.jpg', title: 'Brasília à noite' },
];

// Pré-carrega próxima imagem sem bloquear a main thread
const preloadImage = (src) => {
  const img = new Image();
  img.decoding = 'async';
  img.fetchPriority = 'low';
  img.src = src;
};

// ─── ROUTE SEARCH HOOK ───────────────────────────
const useRouteSearch = () => {
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [realtimeVehicles, setRealtimeVehicles] = useState([]);
  const isSearchingRef = useRef(false);
  const intervalRef = useRef(null);
  const abortControllerRef = useRef(null);

  const getRealtimeVehicles = useCallback(async () => {
    // A Transitland Routing API Beta não expõe VehiclePositions/GTFS-RT no roteamento.
    // Mantemos a estrutura pronta para receber GPS real depois sem quebrar a UI.
    setRealtimeVehicles([]);
    return [];
  }, []);

  const geocodeAddress = async (address, signal) => {
    const safe = sanitizeInput(address);
    const response = await axios.get(
      `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(safe)}.json`,
      { params: { key: TOMTOM_API_KEY, countrySet: 'BR', limit: 1 }, signal }
    );
    if (response.data.results?.[0]) {
      const loc = response.data.results[0].position;
      return { lat: loc.lat, lon: loc.lon, displayName: response.data.results[0].address.freeformAddress };
    }
    throw new Error('Endereço não encontrado');
  };

  const getTransitlandRoute = async (origin, destination, signal, mode = 'bus') => {
    if (mode === 'walk') {
      return getTransitlandWalkingPlan(origin, destination, { signal });
    }

    const itineraries = await getTransitlandTransitPlan(origin, destination, { signal, maxItineraries: 5 });

    // Filtra o que for possível para ônibus ou metrô. Se a API não retornar o modo exato,
    // deixa passar para manter o MVP apresentável.
    if (mode === 'bus') {
      const busOnly = itineraries.filter(it => (it.legs || []).some(l => normalizeTransitlandItineraryMode(l.mode) === 'BUS'));
      return busOnly.length ? busOnly : itineraries;
    }

    if (mode === 'metro') {
      const metroOnly = itineraries.filter(it => (it.legs || []).some(l => normalizeTransitlandItineraryMode(l.mode) === 'METRO'));
      return metroOnly.length ? metroOnly : itineraries;
    }

    return itineraries;
  };

  const calcDist = (p1, p2) => {
    const R = 6371, dLat = (p2.lat - p1.lat) * Math.PI / 180, dLon = (p2.lon - p1.lon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const getNearbyStops = async (coords, signal) => {
    const stops = await getTransitlandStopsNearby(coords, { radius: 1000, limit: 8, signal });
    return stops.map(s => ({
      ...s,
      distanceKm: s.distanceKm || (s.lat && s.lon ? calcDist(coords, { lat: s.lat, lon: s.lon }) : 0),
    })).slice(0, 8);
  };

  const combineRoutes = (itineraries, _stops, origin, destination, mode) => {
    if (!itineraries?.length) return [];
    const out = [];
    itineraries.forEach((it, idx) => {
      const legs = it.legs || [];
      const totalDur = (it.duration || 0) / 60;
      const totalDist = legs.reduce((s, l) => s + (l.distance || 0), 0) / 1000;

      // Modo caminhada: criar uma rota com as pernas WALK
      if (mode === 'walk') {
        const walkLegs = legs.filter(l => l.mode === 'WALK');
        if (walkLegs.length > 0 || it.duration > 0) {
          out.push({
            id: `walk_${idx}`,
            line: 'A pé',
            routeId: 'WALK',
            destination, origin,
            time: Math.ceil(totalDur),
            estimatedTime: totalDur,
            stops: 0,
            distance: totalDist.toFixed(1),
            walkMinutes: Math.ceil(totalDur),
            fromStop: legs[0]?.from?.name || origin,
            toStop: legs[legs.length - 1]?.to?.name || destination,
            mode: 'WALK',
            instruction: `Caminhe ${totalDist.toFixed(1)} km (~${Math.ceil(totalDur)} min) até o destino`,
            tripId: null,
            isWalk: true,
          });
        }
        return;
      }

      // Modo ônibus/metrô: pegar legs de transporte
      const transit = legs.filter(l => l.mode && normalizeTransitlandItineraryMode(l.mode) !== 'WALK');
      const walkTime = legs.filter(l => normalizeTransitlandItineraryMode(l.mode) === 'WALK').reduce((s, l) => s + (l.duration || 0), 0) / 60;
      transit.forEach((leg, li) => {
        const routeId = leg.route || leg.routeId || leg.routeId || leg.trip?.routeId || leg.routeLongName || 'N/A';
        const shortName = leg.routeShortName || leg.route || leg.trip?.routeShortName || routeId;
        const normalizedMode = normalizeTransitlandItineraryMode(leg.mode);
        out.push({
          id: `${routeId}_${idx}_${li}`,
          line: shortName,
          routeId,
          destination,
          origin,
          time: Math.ceil((leg.duration || it.duration || 0) / 60),
          estimatedTime: Math.ceil(totalDur),
          stops: leg.intermediateStops?.length || leg.to?.stopSequence || 0,
          distance: ((leg.distance || 0) / 1000).toFixed(1),
          walkMinutes: Math.ceil(walkTime),
          fromStop: leg.from?.name || 'Ponto de embarque',
          toStop: leg.to?.name || 'Ponto de desembarque',
          mode: normalizedMode,
          source: 'Transitland',
          instruction: `Pegue ${normalizedMode === 'METRO' ? 'o metrô' : 'a linha'} ${shortName} no ponto ${leg.from?.name || 'próximo'}`,
          tripId: leg.tripId || leg.trip?.id,
          isLive: false,
        });
      });
    });
    return out.slice(0, 5);
  };

  const searchRoute = async (originAddress, destinationAddress, mode) => {
    if (!originAddress || !destinationAddress || isSearchingRef.current) return;
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;
    isSearchingRef.current = true;
    setLoading(true); setError(null);
    try {
      const [originCoords, destCoords] = await Promise.all([
        geocodeAddress(originAddress, signal),
        geocodeAddress(destinationAddress, signal)
      ]);
      const realtimeData = await getRealtimeVehicles();
      window.__lastOriginCoords = originCoords;
      const transitRoute = await getTransitlandRoute(originCoords, destCoords, signal, mode);
      const nearbyStops = await getNearbyStops(originCoords, signal);
      let combined = combineRoutes(transitRoute, nearbyStops, originAddress, destinationAddress, mode);

      // Fallback apresentável para ônibus/metrô: quando o roteamento beta não cobre Brasília,
      // mostramos paradas próximas retornadas pela REST API da Transitland.
      if (mode !== 'walk' && combined.length === 0 && nearbyStops.length > 0) {
        combined = nearbyStops.slice(0, 5).map((stop, index) => ({
          id: `tl_stop_${stop.stopId || index}`,
          line: mode === 'metro' ? 'Metrô/Estação próxima' : 'Parada próxima',
          routeId: stop.stopId || 'TRANSITLAND_STOP',
          destination: destinationAddress,
          origin: originAddress,
          time: Math.max(3, Math.ceil((stop.distanceKm || 0.3) * 12)),
          estimatedTime: null,
          stops: 0,
          distance: Number(stop.distanceKm || 0).toFixed(1),
          walkMinutes: Math.max(3, Math.ceil((stop.distanceKm || 0.3) * 12)),
          fromStop: stop.stopName || 'Parada próxima',
          toStop: destinationAddress,
          mode: mode === 'metro' ? 'METRO' : 'BUS',
          source: 'Transitland REST',
          instruction: `Vá até ${stop.stopName || 'uma parada próxima'} para consultar linhas disponíveis`,
          tripId: null,
          isLive: false,
          isStopFallback: true,
        }));
      }

      // Fallback para caminhada: se a API não retornou nada, calcular localmente
      if (mode === 'walk' && combined.length === 0) {
        const distKm = calcDist(originCoords, destCoords);
        const walkMinutes = Math.ceil((distKm / 5) * 60); // ~5 km/h
        combined = [{
          id: 'walk_local',
          line: 'A pé',
          routeId: 'WALK',
          destination: destinationAddress,
          origin: originAddress,
          time: walkMinutes,
          estimatedTime: walkMinutes,
          stops: 0,
          distance: distKm.toFixed(1),
          walkMinutes,
          fromStop: originAddress,
          toStop: destinationAddress,
          mode: 'WALK',
          instruction: `Caminhe ${distKm.toFixed(1)} km (~${walkMinutes} min) até o destino`,
          tripId: null,
          isWalk: true,
          isLive: false,
        }];
      }
      setRoutes(combined.map(r => {
        const rv = realtimeData.find(v => sameLine(v.line, r.line) || sameLine(v.routeId, r.routeId));
        if (rv) {
          const etaMin = getEtaMinutes(rv.eta);
          return { ...r, time: etaMin ?? r.time, realTimeGPS: { lat: rv.lat, lon: rv.lon, bearing: rv.bearing, speed: rv.speed, eta: rv.eta }, isLive: true };
        }
        return { ...r, isLive: false };
      }));
    } catch (err) {
      if (!axios.isCancel(err) && err.name !== 'AbortError') setError(err.message || 'Erro ao buscar rotas');
    } finally {
      setLoading(false); isSearchingRef.current = false;
    }
  };

  useEffect(() => {
    const refresh = async () => {
      if (window.__lastOriginCoords) {
        const nv = await getRealtimeVehicles();
        setRoutes(prev => prev.map(r => {
          const rv = nv.find(v => sameLine(v.line, r.line) || sameLine(v.routeId, r.routeId));
          if (rv) {
            const etaMin = getEtaMinutes(rv.eta);
            return { ...r, time: etaMin ?? r.time, realTimeGPS: { lat: rv.lat, lon: rv.lon, bearing: rv.bearing, speed: rv.speed, eta: rv.eta }, isLive: true };
          }
          return { ...r, isLive: false };
        }));
      }
    };
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(refresh, 60000);
    return () => { clearInterval(intervalRef.current); abortControllerRef.current?.abort(); };
  }, [getRealtimeVehicles]);

  return { routes, loading, error, searchRoute, realtimeVehicles };
};

// ─── LOCATION INPUT ──────────────────────────────
const LocationInput = ({ value, onChange, placeholder, icon: Icon, onDetectLocation, detectingLocation }) => {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [sugLoading, setSugLoading] = useState(false);
  const inputRef = useRef(null);
  const debRef = useRef(null);
  const abortRef = useRef(null);

  // Adicionar na função fetchSuggestions do LocationInput em App.jsx
  const fetchSuggestions = async (q) => {
    const safe = sanitizeInput(q);
    if (!safe || safe.length < 3) { setSuggestions([]); return; }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setSugLoading(true);

    try {
      const r = await axios.get(
        `https://api.tomtom.com/search/2/search/${encodeURIComponent(safe)}.json`,
        {
          params: {
            key: TOMTOM_API_KEY,
            idxSet: 'POI,PAD,STR',
            countrySet: 'BR',
            lat: -15.7934,
            lon: -47.8823,
            radius: 50000,
            limit: 8,
            language: 'pt-BR'
          },
          signal: abortRef.current.signal
        }
      );

      if (r.data.results) {
        setSuggestions(r.data.results);
        setShowSuggestions(true);
      }
    } catch (e) {
      if (!axios.isCancel(e)) {
        console.error('Erro na busca TomTom:', e);
        // Tratar erro de localização negada
        if (e.response?.status === 403) {
          setError('Serviço de localização temporariamente indisponível');
        }
      }
    } finally {
      setSugLoading(false);
    }
  };

  const handleChange = (e) => {
    const safe = sanitizeInput(e.target.value);
    onChange(safe);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => fetchSuggestions(safe), 500);
  };

  useEffect(() => {
    const h = (e) => { if (inputRef.current && !inputRef.current.contains(e.target)) setShowSuggestions(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div className="relative" ref={inputRef}>
      <div className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 z-10">
        <div className="rounded-full bg-[var(--accent)]/10 p-1 md:p-1.5">
          <Icon className="h-3.5 w-3.5 md:h-4 md:w-4 text-[var(--accent)]" strokeWidth={1.5} />
        </div>
      </div>
      <input
        type="text" value={value} onChange={handleChange} placeholder={placeholder}
        autoComplete="off" spellCheck={false} maxLength={300}
        onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
        className="w-full rounded-xl md:rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] pl-10 md:pl-12 pr-20 md:pr-28 py-3 md:py-3.5 text-sm md:text-base text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 transition-all duration-200"
      />
      <div className="absolute right-2 md:right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {sugLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent)]" />}
        {onDetectLocation && (
          <motion.button whileTap={{ scale: 0.92 }} onClick={onDetectLocation} disabled={detectingLocation}
            className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] md:text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors duration-200">
            {detectingLocation ? <Loader2 className="h-3 w-3 animate-spin" /> : <Navigation className="h-3 w-3" />}
            <span className="hidden sm:inline">Usar local</span>
          </motion.button>
        )}
      </div>
      <AnimatePresence>
        {showSuggestions && suggestions.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }}
            className="absolute z-20 w-full mt-1.5 bg-[var(--dropdown-bg)] backdrop-blur-xl rounded-xl shadow-xl border border-[var(--border)] max-h-56 overflow-y-auto">
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => { onChange(s.address.freeformAddress); setShowSuggestions(false); setSuggestions([]); }}
                className="w-full text-left px-4 py-2.5 hover:bg-[var(--accent)]/8 transition-colors border-b border-[var(--border)] last:border-0">
                <p className="text-sm font-medium text-[var(--text-primary)] truncate">{s.address.freeformAddress}</p>
                <p className="text-xs text-[var(--text-tertiary)] truncate">{s.address.municipality || s.address.countrySubdivision}</p>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── ROUTE RESULT ────────────────────────────────
const RouteResult = ({ routes, origin, destination, loading }) => {
  if (loading) return (
    <div className="mt-6 space-y-3">
      {[1, 2, 3].map(i => <div key={i} className="h-24 rounded-2xl animate-pulse bg-[var(--skeleton-bg)]" />)}
    </div>
  );
  if (!routes?.length) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="mt-7 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest mb-1">Rotas Transitland</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate max-w-[140px]">{origin}</p>
            <ArrowRight className="h-3 w-3 text-[var(--text-tertiary)] flex-shrink-0" />
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate max-w-[140px]">{destination}</p>
          </div>
        </div>
        <span className="text-xs font-medium text-[var(--text-tertiary)] flex-shrink-0 mt-1">{routes.length} {routes.length === 1 ? 'opção' : 'opções'}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
        <span className="text-[10px] font-semibold text-green-600 dark:text-green-400">
          {routes.some(r => r.isLive) ? '🚀 GPS real disponível' : 'Dados previstos — Transitland'}
        </span>
      </div>
      <div className="space-y-2.5">
        {routes.map((route, idx) => (
          <motion.div key={route.id}
            initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.06, ...spring }}
            whileHover={{ y: -2 }} whileTap={{ scale: 0.99 }}
            className={`rounded-2xl border p-4 cursor-pointer transition-all duration-200 ${route.isLive ? 'border-green-300/60 bg-green-50/40 dark:border-green-800/50 dark:bg-green-900/10'
              : 'border-[var(--border)] bg-[var(--card-inner)]'
              }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className={`rounded-full p-2 flex-shrink-0 ${route.isLive ? 'bg-green-100 dark:bg-green-900/40' : 'bg-[var(--accent)]/10'}`}>
                  {route.mode === 'BUS' || route.mode === 'TRAM'
                    ? <Bus className={`h-4 w-4 ${route.isLive ? 'text-green-600' : 'text-[var(--accent)]'}`} strokeWidth={1.5} />
                    : <Train className={`h-4 w-4 ${route.isLive ? 'text-green-600' : 'text-[var(--accent)]'}`} strokeWidth={1.5} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="font-semibold text-sm text-[var(--text-primary)] tracking-tight">Linha {route.line}</span>
                    {route.isLive && <span className="text-[9px] font-bold text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/40 px-1.5 py-0.5 rounded-full tracking-wide">AO VIVO</span>}
                    {route.mode && <span className="text-[10px] text-[var(--text-tertiary)]">{route.mode}</span>}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1"><Clock className="h-3 w-3 text-[var(--text-tertiary)]" strokeWidth={1.5} /><span className="text-xs font-semibold text-[var(--accent)]">{route.time} min</span></div>
                    <div className="flex items-center gap-1"><MapPin className="h-3 w-3 text-[var(--text-tertiary)]" strokeWidth={1.5} /><span className="text-xs text-[var(--text-secondary)]">{route.stops} paradas</span></div>
                    {route.walkMinutes > 0 && <div className="flex items-center gap-1"><Footprints className="h-3 w-3 text-[var(--text-tertiary)]" strokeWidth={1.5} /><span className="text-xs text-[var(--text-secondary)]">{route.walkMinutes} min a pé</span></div>}
                    {route.realTimeGPS?.eta && (
                      <div className="flex items-center gap-1 bg-green-100 dark:bg-green-900/40 px-1.5 py-0.5 rounded-full">
                        <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-[9px] font-bold text-green-700 dark:text-green-400">{Math.round((new Date(route.realTimeGPS.eta) - new Date()) / 60000)} min</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-1 truncate">Embarque: {route.fromStop}</p>
                </div>
              </div>
              <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold text-white flex-shrink-0 self-start sm:self-center transition-opacity hover:opacity-90 ${route.isLive ? 'bg-green-600' : 'bg-[var(--accent)]'}`}>
                {route.isLive ? 'Ver no mapa' : 'Detalhes'}
              </motion.button>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
};

// ─── THEME TOGGLE ────────────────────────────────
const ThemeToggle = ({ dark, onToggle }) => (
  <motion.button onClick={onToggle} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} aria-label="Alternar tema"
    className="fixed top-4 right-4 z-50 w-10 h-10 rounded-full bg-white/20 dark:bg-black/30 backdrop-blur-xl border border-white/30 dark:border-white/10 flex items-center justify-center shadow-lg">
    <AnimatePresence mode="wait">
      <motion.div key={dark ? 'sun' : 'moon'} initial={{ opacity: 0, rotate: -40, scale: 0.5 }} animate={{ opacity: 1, rotate: 0, scale: 1 }} exit={{ opacity: 0, rotate: 40, scale: 0.5 }} transition={{ duration: 0.18 }}>
        {dark ? <Sun className="h-4 w-4 text-yellow-300" strokeWidth={1.8} /> : <Moon className="h-4 w-4 text-slate-800" strokeWidth={1.8} />}
      </motion.div>
    </AnimatePresence>
  </motion.button>
);

// ─── APP ─────────────────────────────────────────
function App() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [selectedMode, setSelectedMode] = useState('bus');
  const [hasSearched, setHasSearched] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('lb-theme') === 'dark'; } catch { return false; } });
  const [userLocationCoords, setUserLocationCoords] = useState(null);
  const { routes, loading, error, searchRoute } = useRouteSearch();
  const searchRef = useRef(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('lb-theme', dark ? 'dark' : 'light'); } catch { }
  }, [dark]);

  useEffect(() => {
    // Pré-carrega a próxima imagem antes da transição
    const preloadNext = (current) => {
      const nextIdx = (current + 1) % carouselImages.length;
      preloadImage(carouselImages[nextIdx].src);
    };
    preloadNext(0); // pré-carrega a segunda ao montar
    const id = setInterval(() => {
      setActiveSlide(p => {
        const next = (p + 1) % carouselImages.length;
        preloadNext(next);
        return next;
      });
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const detectLocation = async (setter) => {
    setLocationLoading(true);
    if (!navigator.geolocation) { setLocationLoading(false); return; }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        // Salvar coords brutas para o modal de caminhada
        setUserLocationCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        try {
          const r = await axios.get(`https://api.tomtom.com/search/2/reverseGeocode/${pos.coords.latitude},${pos.coords.longitude}.json`,
            { params: { key: TOMTOM_API_KEY, returnSpeedLimit: false, language: 'pt-BR' } });
          if (r.data.addresses?.[0]) setter(r.data.addresses[0].address.freeformAddress);
        } catch { } finally { setLocationLoading(false); }
      },
      () => setLocationLoading(false)
    );
  };

  const handleSearch = async () => {
    const safeO = sanitizeInput(origin);
    const safeD = sanitizeInput(destination);
    if (!safeO || !safeD) return;
    setHasSearched(true);
    await searchRoute(safeO, safeD, selectedMode);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] transition-colors duration-500 font-apple">
      <ThemeToggle dark={dark} onToggle={() => setDark(d => !d)} />

      {/* HERO */}
      <div className="relative h-screen flex items-center justify-center overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={activeSlide}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: 'easeInOut' }}
            className="absolute inset-0">
            {/* loading="lazy" + decoding="async" — não bloqueia main thread */}
            <img
              src={carouselImages[activeSlide].src}
              alt={carouselImages[activeSlide].title}
              className="h-full w-full object-cover"
              loading={activeSlide === 0 ? 'eager' : 'lazy'}
              decoding="async"
              fetchPriority={activeSlide === 0 ? 'high' : 'low'}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/35 to-black/70" />
          </motion.div>
        </AnimatePresence>

        <div className="relative z-10 text-center px-4 sm:px-6 max-w-4xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, ...spring }}>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-xl px-4 py-2 mb-6 border border-white/20">
              <Circle className="h-1.5 w-1.5 fill-green-400 text-green-400 animate-pulse" />
              <span className="text-[11px] md:text-xs font-medium text-white/90 tracking-wide">Transitland — rotas previstas e mapa em tempo real</span>
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-[5.5rem] font-bold text-white mb-4 leading-[1.04] tracking-[-0.03em]">
              Mobilidade em<br className="hidden sm:block" /> Brasília
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-white/85 mb-8 md:mb-10 tracking-[-0.01em]">
              O monitoramento mais veloz da capital, a um toque de você.
            </p>
            <motion.button onClick={() => searchRef.current?.scrollIntoView({ behavior: 'smooth' })}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              className="bg-[var(--accent)] text-white rounded-full px-7 py-3.5 md:px-9 md:py-4 font-semibold text-sm md:text-base inline-flex items-center gap-2 shadow-2xl shadow-blue-600/25 hover:opacity-92 transition-opacity duration-200">
              Planejar minha viagem
              <ChevronDown className="h-4 w-4 md:h-5 md:w-5" />
            </motion.button>
          </motion.div>
        </div>

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2">
          {carouselImages.map((_, i) => (
            <button key={i} onClick={() => setActiveSlide(i)}
              className={`h-1 rounded-full transition-all duration-500 ${i === activeSlide ? 'w-7 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/60'}`} />
          ))}
        </div>
      </div>

      {/* SEARCH */}
      <div ref={searchRef} className="max-w-2xl mx-auto px-4 -mt-14 md:-mt-20 pb-24 relative z-10">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, ...spring }}
          className="bg-[var(--card-bg)] backdrop-blur-xl rounded-2xl md:rounded-3xl shadow-2xl border border-[var(--border)] overflow-hidden">
          <div className="px-6 md:px-8 py-4 md:py-5 border-b border-[var(--border)] bg-gradient-to-r from-[var(--accent)]/5 to-transparent">
            <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)] tracking-tight">Planeje sua rota</h2>
            <p className="text-xs md:text-sm text-[var(--text-secondary)] mt-0.5">Busque por ônibus, metrô e caminhada</p>
          </div>

          <div className="p-6 md:p-8">
            <div className="space-y-3">
              <LocationInput value={origin} onChange={setOrigin} placeholder="Ponto de partida" icon={MapPin}
                onDetectLocation={() => detectLocation(setOrigin)} detectingLocation={locationLoading} />
              <LocationInput value={destination} onChange={setDestination} placeholder="Para onde você vai?" icon={Search}
                onDetectLocation={() => detectLocation(setDestination)} detectingLocation={locationLoading} />
            </div>

            <div className="mt-6">
              <p className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest mb-3">Tipo de transporte</p>
              <div className="grid grid-cols-3 gap-2 md:gap-3">
                {[
                  { name: 'Ônibus', type: 'bus', icon: Bus, desc: 'Transitland' },
                  { name: 'Metrô', type: 'metro', icon: Train, desc: 'Metrô-DF' },
                  { name: 'Caminhada', type: 'walk', icon: Footprints, desc: 'Trajeto a pé' },
                ].map((m) => (
                  <motion.button key={m.type} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                    onClick={() => setSelectedMode(m.type)}
                    className={`rounded-xl md:rounded-2xl border p-3 md:p-4 text-center transition-all duration-200 ${selectedMode === m.type
                      ? 'border-[var(--accent)] bg-[var(--accent)]/8 shadow-sm'
                      : 'border-[var(--border)] bg-[var(--input-bg)] hover:border-[var(--accent)]/40'}`}>
                    <m.icon className={`h-5 w-5 mx-auto mb-1.5 ${selectedMode === m.type ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'}`} strokeWidth={1.6} />
                    <p className={`text-xs font-semibold tracking-tight ${selectedMode === m.type ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>{m.name}</p>
                    <p className="hidden md:block text-[10px] text-[var(--text-tertiary)] mt-0.5">{m.desc}</p>
                  </motion.button>
                ))}
              </div>
            </div>

            <motion.button whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.98 }}
              onClick={handleSearch} disabled={!origin || !destination || loading}
              className={`mt-6 w-full rounded-xl md:rounded-2xl py-3 md:py-3.5 font-semibold flex items-center justify-center gap-2 text-sm md:text-base tracking-tight transition-all duration-200 ${origin && destination && !loading
                ? 'bg-[var(--accent)] text-white hover:opacity-92 shadow-lg shadow-[var(--accent)]/20'
                : 'bg-[var(--disabled-bg)] text-[var(--disabled-text)] cursor-not-allowed'}`}>
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Buscando rota…</> : 'Buscar rota agora'}
            </motion.button>

            {(hasSearched || routes.length > 0) && <RouteResultRefatorado routes={routes} origin={origin} destination={destination} loading={loading} userLocation={userLocationCoords} isDark={dark} />}

            {error && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="mt-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-xl text-sm flex items-center gap-2 border border-red-200 dark:border-red-800/50">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />{error}
              </motion.div>
            )}

            {!loading && hasSearched && !routes.length && !error && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="mt-4 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 p-3 rounded-xl text-sm text-center border border-amber-200 dark:border-amber-800/50">
                Nenhuma rota encontrada. Tente ajustar origem ou destino.
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>

      <footer className="pb-8 text-center text-[10px] text-[var(--text-tertiary)]">
        Dados de transporte: <a href="https://www.transit.land/" target="_blank" rel="noreferrer" className="underline hover:text-[var(--accent)]">Transitland</a>
        {' '}• Mapas e busca: TomTom
      </footer>
    </div>
  );
}

export default function WrappedApp() {
  return <ErrorBoundary><App /></ErrorBoundary>;
}
