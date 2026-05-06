import React, { useState, useEffect, useRef, useCallback, Component } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bus, Footprints, MapPin, Train, Clock, ArrowRight,
  ChevronDown, Circle, Navigation, Search, AlertCircle,
  Loader2, Sun, Moon, AlertTriangle
} from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import RouteResultRefatorado from './comp/RouteResultRefatorado';
import { normalizeTransitlandItineraryMode } from './services/transitland';
import { findLocalDfPlaces, getAllSemobStops } from './services/semobStops';
import { planMobilibusRoute } from './services/mobilibusOtp';
import {
  fetchDftransVehicles,
  getLiveVehiclesByLine,
} from './services/dftransGps';

// ─── API CONFIG ────────────────────────────────
const TOMTOM_API_KEY = 'kVt12B5jgJTHfcvXLLDSPgcX6bz4f7R1';
// TomTom permanece para mapa, busca, geocoding e caminhada.
// DFTrans/DF no Ponto agora é a fonte principal de ônibus ao vivo.


// Normaliza códigos para comparar linhas de transporte (ex: "Linha 143.2", "143.2", "0.143 e etc")
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

const isBusLineSearch = (text) => {
  const value = String(text || '').trim();
  return /^\d{1,3}(\.\d{1,2})?$/.test(value);
};

const getVehicleOperatorName = (vehicle) => {
  if (!vehicle?.operadora) return 'operadora';
  if (typeof vehicle.operadora === 'string') return vehicle.operadora;
  return vehicle.operadora?.nome || 'operadora';
};

const getVehicleLine = (vehicle) => {
  return String(vehicle?.linha || vehicle?.line || '').trim();
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
const decodeOtpPolyline = (encoded) => {
  if (!encoded || typeof encoded !== 'string') return [];

  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;
  const coordinates = [];

  while (index < len) {
    let b;
    let shift = 0;
    let result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coordinates.push([lng / 1e5, lat / 1e5]);
  }

  return coordinates;
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

  const getRealtimeVehicles = useCallback(async (signal) => {
    try {
      const vehicles = await fetchDftransVehicles({ signal });
      setRealtimeVehicles(vehicles);
      return vehicles;
    } catch (error) {
      console.warn('[DFTrans GPS] Não foi possível carregar veículos ao vivo:', error?.message || error);
      setRealtimeVehicles([]);
      return [];
    }
  }, []);

  const geocodeAddress = async (address, signal) => {
    const safe = sanitizeInput(address);

    // 1) Primeiro tenta a base oficial/local do DF/SEMOB/Mobilibus. Isso evita o TomTom jogar
    // Rodoviária/paradas para CEPs ou endereços genéricos.
    const localMatches = await findLocalDfPlaces(safe);
    const exactLocal = localMatches.find((place) => {
      const a = String(place.address || '').toLowerCase();
      const n = String(place.name || '').toLowerCase();
      const q = safe.toLowerCase();
      return a === q || n === q || a.includes(q) || n.includes(q);
    });

    if (exactLocal?.position) {
      return {
        lat: exactLocal.position.lat,
        lon: exactLocal.position.lon,
        displayName: exactLocal.address || exactLocal.name,
        source: exactLocal.source || 'Mobilibus/SEMOB',
        stopId: exactLocal.stopId,
      };
    }

    // 2) Depois usa TomTom, com viés forte para Brasília e resultados completos.
    const response = await axios.get(
      `https://api.tomtom.com/search/2/search/${encodeURIComponent(safe)}.json`,
      {
        params: {
          key: TOMTOM_API_KEY,
          countrySet: 'BR',
          lat: -15.7939,
          lon: -47.8828,
          radius: 70000,
          limit: 5,
          language: 'pt-BR',
          idxSet: 'POI,PAD,STR,XSTR,GEO,ADDR',
        },
        signal,
      }
    );

    const result = response.data.results?.find((item) => item.position?.lat && item.position?.lon);
    if (result) {
      const loc = result.position;
      return {
        lat: loc.lat,
        lon: loc.lon,
        displayName: result.address?.freeformAddress || result.poi?.name || safe,
        source: 'TomTom',
      };
    }

    throw new Error('Endereço não encontrado');
  };

  const getTomTomWalkingPlan = async (origin, destination, signal) => {
    try {
      const response = await axios.get(
        `https://api.tomtom.com/routing/1/calculateRoute/${origin.lat},${origin.lon}:${destination.lat},${destination.lon}/json`,
        {
          params: {
            key: TOMTOM_API_KEY,
            travelMode: 'pedestrian',
            routeType: 'fastest',
            instructionsType: 'text',
            language: 'pt-BR',
          },
          signal,
        }
      );

      const route = response.data?.routes?.[0];
      if (!route) return [];

      const points = (route.legs || [])
        .flatMap((leg) => leg.points || [])
        .map((point) => [point.longitude, point.latitude]);

      return [{
        duration: route.summary?.travelTimeInSeconds || 0,
        legs: [{
          mode: 'WALK',
          duration: route.summary?.travelTimeInSeconds || 0,
          distance: route.summary?.lengthInMeters || 0,
          from: { name: 'Origem' },
          to: { name: 'Destino' },
          legGeometry: points.length ? { points, length: points.length } : null,
        }],
        routePoints: points,
        source: 'TomTom Routing',
      }];
    } catch (error) {
      console.warn('[TomTom walking plan]', error?.message || error);
      return [];
    }
  };

  const getTodayOtpDate = () => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const yyyy = now.getFullYear();

    return `${mm}-${dd}-${yyyy}`;
  };

  const getNowOtpTime = () => {
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const suffix = hours >= 12 ? 'pm' : 'am';

    hours = hours % 12;
    if (hours === 0) hours = 12;

    return `${hours}:${minutes}${suffix}`;
  };

  const getTransportPlan = async (origin, destination, signal, mode = 'bus') => {
    if (mode === 'bus') {
      try {
        const data = await planMobilibusRoute({
          fromLat: origin.lat,
          fromLon: origin.lon,
          toLat: destination.lat,
          toLon: destination.lon,
          date: getTodayOtpDate(),
          time: getNowOtpTime(),
          mode: 'TRANSIT,WALK',
          maxWalkDistance: 1200,
          signal,
        });

        return data?.plan?.itineraries || [];
      } catch (error) {
        const msg = String(error?.message || error || '');

        const isAbort =
          error?.name === 'AbortError' ||
          msg.toLowerCase().includes('aborted') ||
          msg.toLowerCase().includes('signal is aborted');

        if (!isAbort) {
          console.warn('[Mobilibus OTP plan]', msg);
        }

        return [];
      }
    }

    if (mode === 'metro') {
      return [];
    }

    if (mode === 'walk') {
      return getTomTomWalkingPlan(origin, destination, signal);
    }

    return [];
  };


  const calcDist = (p1, p2) => {
    const R = 6371, dLat = (p2.lat - p1.lat) * Math.PI / 180, dLon = (p2.lon - p1.lon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };
  const snapVehicleToRoute = (vehicle, route) => {
    if (!vehicle?.lat || !vehicle?.lon) {
      return null;
    }

    const vehicleCoords = {
      lat: Number(vehicle.lat),
      lon: Number(vehicle.lon),
    };

    const routePoints =
      route.routePoints?.length
        ? route.routePoints
        : decodeOtpPolyline(route.routeGeometry);

    if (!routePoints?.length) {
      return {
        lat: vehicleCoords.lat,
        lon: vehicleCoords.lon,
        snappedToRoute: false,
        snapDistanceKm: null,
      };
    }

    let best = null;

    routePoints.forEach(([lon, lat]) => {
      const pointCoords = {
        lat: Number(lat),
        lon: Number(lon),
      };

      const distanceKm = calcDist(vehicleCoords, pointCoords);

      if (!best || distanceKm < best.distanceKm) {
        best = {
          lat: pointCoords.lat,
          lon: pointCoords.lon,
          distanceKm,
        };
      }
    });

    // Se o GPS estiver até 350m da rota oficial, gruda na rota.
    // Se estiver mais longe, mantém GPS cru para não mentir muito.
    if (best && best.distanceKm <= 0.35) {
      return {
        lat: best.lat,
        lon: best.lon,
        snappedToRoute: true,
        snapDistanceKm: best.distanceKm,
      };
    }

    return {
      lat: vehicleCoords.lat,
      lon: vehicleCoords.lon,
      snappedToRoute: false,
      snapDistanceKm: best?.distanceKm ?? null,
    };
  };

  const findBestVehicleForRoute = (vehicles, route) => {
    const matching = (vehicles || []).filter((vehicle) =>
      sameLine(vehicle.line, route.line) || sameLine(vehicle.routeId, route.routeId)
    );

    if (!matching.length) return null;

    if (!route.nearestStopLat || !route.nearestStopLon) {
      return matching[0];
    }

    const stopCoords = {
      lat: Number(route.nearestStopLat),
      lon: Number(route.nearestStopLon),
    };

    return matching
      .map((vehicle) => {
        const vehicleCoords = {
          lat: Number(vehicle.lat),
          lon: Number(vehicle.lon),
        };

        return {
          vehicle,
          distanceToStopKm: calcDist(vehicleCoords, stopCoords),
        };
      })
      .sort((a, b) => a.distanceToStopKm - b.distanceToStopKm)[0]?.vehicle || null;
  };

  const estimateEtaToStop = (vehicle, stop) => {
    if (!vehicle?.lat || !vehicle?.lon || !stop?.lat || !stop?.lon) return null;

    const distanceKm = calcDist(
      { lat: Number(vehicle.lat), lon: Number(vehicle.lon) },
      { lat: Number(stop.lat), lon: Number(stop.lon) }
    );

    const rawSpeed = Number(vehicle.speed || vehicle.velocidade || 0);

    // Se a API vier sem velocidade ou com ônibus parado, usa média urbana segura.
    const speedKmh = rawSpeed >= 8 ? rawSpeed : 22;
    const etaMin = Math.round((distanceKm / speedKmh) * 60);

    return Number.isFinite(etaMin) ? Math.max(1, etaMin) : null;
  };
  const getVehicleTimestamp = (vehicle) => {
    return vehicle?.horario || vehicle?.updatedAt || vehicle?.timestamp || null;
  };

  const getGpsAgeMinutes = (vehicle) => {
    const timestamp = getVehicleTimestamp(vehicle);
    if (!timestamp) return null;

    const gpsTime = Number(timestamp);
    if (!Number.isFinite(gpsTime)) return null;

    const diff = Date.now() - gpsTime;
    if (diff < 0) return 1;

    const minutes = Math.round(diff / 60000);
    return Math.max(1, minutes);
  };

  const getVehicleSpeedKmh = (vehicle) => {
    const speed = Number(vehicle?.speed ?? vehicle?.velocidade ?? 0);

    // Se vier velocidade confiável, usa ela.
    if (Number.isFinite(speed) && speed >= 5 && speed <= 90) {
      return speed;
    }

    // Média urbana realista para ônibus no DF.
    return 22;
  };

  const estimateBusEtaToStop = (vehicle, stop) => {
    if (!vehicle?.lat || !vehicle?.lon || !stop?.lat || !stop?.lon) {
      return null;
    }

    const distanceKm = calcDist(
      {
        lat: Number(vehicle.lat),
        lon: Number(vehicle.lon),
      },
      {
        lat: Number(stop.lat),
        lon: Number(stop.lon),
      }
    );

    const speedKmh = getVehicleSpeedKmh(vehicle);

    // Multiplicador porque ônibus não anda em linha reta.
    // 1.35 deixa mais próximo do mundo real sem API de rota.
    const correctedDistanceKm = distanceKm * 1.35;

    const eta = Math.round((correctedDistanceKm / speedKmh) * 60);

    if (!Number.isFinite(eta)) return null;

    return Math.max(1, eta);
  };

  const getTargetUserStops = (nearbyStops, limit = 3) => {
    return (nearbyStops || [])
      .filter((stop) => stop?.lat && stop?.lon)
      .sort((a, b) => Number(a.distanceKm || 999) - Number(b.distanceKm || 999))
      .slice(0, limit);
  };

  const getBestUserStopForVehicle = (vehicle, userStops) => {
    const stops = getTargetUserStops(userStops, 3);

    if (!stops.length) return null;

    // Por enquanto, usa a parada mais próxima do usuário/origem.
    // Depois dá pra evoluir para filtrar pela linha/sentido.
    return stops[0];
  };

  const getNearbyStops = async (coords) => {
    try {
      const stops = await getAllSemobStops();
      return stops
        .filter((s) => s?.position?.lat && s?.position?.lon)
        .map((s) => ({
          stopId: s.stopId,
          stopName: s.name,
          lat: s.position.lat,
          lon: s.position.lon,
          source: s.source || 'Mobilibus/SEMOB',
          distanceKm: calcDist(coords, { lat: s.position.lat, lon: s.position.lon }),
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 8);
    } catch (error) {
      console.warn('[SEMOB stops nearby]', error?.message || error);
      return [];
    }
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
            destination,
            origin,
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

          nearestStopName: leg.from?.name || 'Ponto de embarque',
          nearestStopLat: leg.from?.lat || leg.from?.stop?.lat || null,
          nearestStopLon: leg.from?.lon || leg.from?.stop?.lon || null,

          routeGeometry: leg.legGeometry?.points || null,
          routeGeometryLength: leg.legGeometry?.length || 0,
          routePoints: decodeOtpPolyline(leg.legGeometry?.points),

          mode: normalizedMode,
          source: 'Mobilibus OTP',
          instruction: `Pegue ${normalizedMode === 'METRO' ? 'o metrô' : 'a linha'} ${shortName} no ponto ${leg.from?.name || 'próximo'}`,
          tripId: leg.tripId || leg.trip?.id,
          isLive: false,
        });
      });
    });
    return out.slice(0, 5);
  };

  const buildLiveBusRoutes = (
    vehicles,
    originCoords,
    destinationCoords,
    originAddress,
    destinationAddress,
    nearbyStops = []
  ) => {
    const userTargetStops = getTargetUserStops(nearbyStops, 3);

    const withLine = (vehicles || [])
      .filter((vehicle) => {
        return (
          vehicle?.valid !== false &&
          vehicle?.line &&
          vehicle?.lat &&
          vehicle?.lon
        );
      })
      .map((vehicle) => {
        const vehicleCoords = {
          lat: Number(vehicle.lat),
          lon: Number(vehicle.lon),
        };

        const distanceToOriginKm = calcDist(originCoords, vehicleCoords);

        const distanceToDestinationKm = calcDist(destinationCoords, vehicleCoords);

        const gpsUpdatedMinutes = getGpsAgeMinutes(vehicle);

        const targetStop = getBestUserStopForVehicle(vehicle, userTargetStops);

        const distanceToTargetStopKm = targetStop
          ? calcDist(vehicleCoords, {
            lat: Number(targetStop.lat),
            lon: Number(targetStop.lon),
          })
          : distanceToOriginKm;

        const etaToNearestStopMinutes = targetStop
          ? estimateBusEtaToStop(vehicle, targetStop)
          : null;

        return {
          ...vehicle,
          distanceToOriginKm,
          distanceToDestinationKm,
          distanceToTargetStopKm,
          gpsUpdatedMinutes,
          targetStop,
          etaToNearestStopMinutes,
        };
      })
      // Primeiro mostra ônibus mais perto da parada/origem do usuário.
      .sort((a, b) => {
        const etaA = a.etaToNearestStopMinutes ?? 9999;
        const etaB = b.etaToNearestStopMinutes ?? 9999;

        if (etaA !== etaB) return etaA - etaB;

        return Number(a.distanceToTargetStopKm || 999) - Number(b.distanceToTargetStopKm || 999);
      });

    const candidates = withLine
      .filter((vehicle) => vehicle.distanceToTargetStopKm <= 6)
      .slice(0, 5);

    const selected = candidates.length ? candidates : withLine.slice(0, 5);

    return selected.map((vehicle, index) => {
      const operatorName = getVehicleOperatorName(vehicle);
      const timestamp = getVehicleTimestamp(vehicle);
      const targetStop = vehicle.targetStop;

      const etaToNearestStopMinutes = vehicle.etaToNearestStopMinutes;

      const walkMinutes = targetStop?.distanceKm
        ? Math.max(1, Math.ceil((Number(targetStop.distanceKm) / 4.8) * 60))
        : Math.max(1, Math.ceil((vehicle.distanceToOriginKm / 4.8) * 60));

      const stopName =
        targetStop?.stopName ||
        targetStop?.name ||
        'parada próxima';

      return {
        id: `dftrans_live_${vehicle.numero || index}_${vehicle.line}`,
        line: vehicle.line,
        routeId: vehicle.line,

        destination: destinationAddress,
        origin: originAddress,

        // AGORA é tempo estimado até a parada do usuário.
        time: etaToNearestStopMinutes,
        etaToNearestStopMinutes,

        // Separado: idade do GPS.
        gpsUpdatedMinutes: vehicle.gpsUpdatedMinutes,

        estimatedTime: etaToNearestStopMinutes,
        stops: 0,

        distance: Number(vehicle.distanceToTargetStopKm || vehicle.distanceToOriginKm || 0).toFixed(1),
        walkMinutes,

        fromStop: stopName,
        toStop: destinationAddress,

        mode: 'BUS',
        source: 'DFTrans GPS / DF no Ponto',
        instruction: targetStop
          ? `Linha ${vehicle.line} estimada para passar em ${stopName} em cerca de ${etaToNearestStopMinutes ?? '--'} min. Sentido: ${vehicle.sentido || 'não informado'}. Velocidade: ${Math.round(vehicle.speed || vehicle.velocidade || 0)} km/h.`
          : `Linha ${vehicle.line} detectada ao vivo pela ${operatorName}. Sentido: ${vehicle.sentido || 'não informado'}.`,

        tripId: null,
        isLive: true,
        isGpsOnly: true,

        // Coordenada real do ônibus.
        lat: Number(vehicle.lat),
        lon: Number(vehicle.lon),

        // Coordenada da parada do usuário.
        nearestStopName: stopName,
        nearestStopLat: targetStop?.lat || null,
        nearestStopLon: targetStop?.lon || null,
        nearestStopDistanceKm: targetStop?.distanceKm ?? null,

        realTimeGPS: {
          lat: Number(vehicle.lat),
          lon: Number(vehicle.lon),
          bearing: vehicle.bearing ?? vehicle.direcao ?? 0,
          speed: vehicle.speed ?? vehicle.velocidade ?? 0,
          horario: timestamp,
          updatedAt: timestamp,
          numero: vehicle.numero,
          line: vehicle.line,
          sentido: vehicle.sentido || null,
          operadora: operatorName,
        },
      };
    });
  };

  const buildLiveBusLineRoutes = (vehicles, linha, originAddress, destinationAddress) => {
    return (vehicles || [])
      .filter((vehicle) => {
        const line = getVehicleLine(vehicle);
        return vehicle?.valid !== false && line && vehicle?.lat && vehicle?.lon;
      })
      .map((vehicle, index) => {
        const line = getVehicleLine(vehicle);
        const operatorName = getVehicleOperatorName(vehicle);
        const timestamp = vehicle?.horario || vehicle?.updatedAt || null;

        const updatedAgeMinutes = timestamp
          ? Math.max(1, Math.round((Date.now() - Number(timestamp)) / 60000))
          : 1;

        return {
          id: `dftrans_line_${vehicle.numero || index}_${line}_${index}`,
          line,
          routeId: line,

          destination: destinationAddress,
          origin: originAddress,

          time: updatedAgeMinutes,
          estimatedTime: null,
          stops: 0,
          distance: null,
          walkMinutes: 0,

          fromStop: `Ônibus ${vehicle.numero || 'ao vivo'}`,
          toStop: destinationAddress,

          mode: 'BUS',
          source: 'DFTrans GPS / Cloudflare',
          instruction: `Linha ${line} detectada ao vivo pela ${operatorName}. Sentido: ${vehicle.sentido || 'não informado'}. Velocidade: ${Math.round(vehicle.speed || vehicle.velocidade || 0)} km/h.`,

          tripId: null,
          isLive: true,
          isGpsOnly: true,

          lat: Number(vehicle.lat),
          lon: Number(vehicle.lon),

          realTimeGPS: {
            lat: Number(vehicle.lat),
            lon: Number(vehicle.lon),
            bearing: vehicle.bearing ?? vehicle.direcao ?? 0,
            speed: vehicle.speed ?? vehicle.velocidade ?? 0,
            horario: timestamp,
            updatedAt: timestamp,
            numero: vehicle.numero,
            line,
            sentido: vehicle.sentido || null,
            operadora: operatorName,
          },
        };
      });
  };

  const searchBusLine = async (linha, originAddress, destinationAddress) => {
    if (!linha || isSearchingRef.current) return;

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    isSearchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      window.__lastLiveLine = linha;
      window.__lastSearchType = 'line';

      const vehicles = await getLiveVehiclesByLine(linha);

      if (!vehicles?.length) {
        setRoutes([]);
        setRealtimeVehicles([]);
        setError(`Nenhum ônibus ao vivo encontrado para a linha ${linha}.`);
        return;
      }

      const liveRoutes = buildLiveBusLineRoutes(
        vehicles,
        linha,
        originAddress || linha,
        destinationAddress || 'ônibus ao vivo'
      );

      setRealtimeVehicles(vehicles);
      setRoutes(liveRoutes);
    } catch (error) {
      console.error('[DFTrans GPS] Erro ao buscar linha ao vivo:', error);
      setRoutes([]);
      setError('Não foi possível buscar ônibus ao vivo agora.');
    } finally {
      setLoading(false);
      isSearchingRef.current = false;
    }
  };
const searchRoute = async (originAddress, destinationAddress, mode) => {
  if (!originAddress || !destinationAddress || isSearchingRef.current) return;

  abortControllerRef.current?.abort();
  abortControllerRef.current = new AbortController();

  const { signal } = abortControllerRef.current;

  isSearchingRef.current = true;
  setLoading(true);
  setError(null);

  try {
    const [originCoords, destCoords] = await Promise.all([
      geocodeAddress(originAddress, signal),
      geocodeAddress(destinationAddress, signal),
    ]);

    const nearbyStopsPromise = getNearbyStops(originCoords);

    const realtimeDataPromise =
      mode === 'bus'
        ? getRealtimeVehicles(signal)
        : Promise.resolve([]);

    const [nearbyStops, realtimeData] = await Promise.all([
      nearbyStopsPromise,
      realtimeDataPromise,
    ]);

    window.__lastOriginCoords = originCoords;
    window.__lastDestinationCoords = destCoords;
    window.__lastOriginAddress = originAddress;
    window.__lastDestinationAddress = destinationAddress;
    window.__lastNearbyStops = nearbyStops;
    window.__lastSearchMode = mode;
    window.__lastSearchType = mode === 'bus' ? 'route' : mode;

    let alreadyShowedFastResult = false;

    if (mode === 'bus') {
      const fastLiveRoutes = buildLiveBusRoutes(
        realtimeData,
        originCoords,
        destCoords,
        originAddress,
        destinationAddress,
        nearbyStops
      );

      if (fastLiveRoutes.length > 0) {
        const fastRoutesWithStops = fastLiveRoutes.map((route) => ({
          ...route,
          nearbyStops,
        }));

        window.__lastOtpRoutes = [];

        setRealtimeVehicles(realtimeData);
        setRoutes(fastRoutesWithStops);
        setLoading(false);

        alreadyShowedFastResult = true;
      }
    }

    let transitRoute = [];

    try {
      transitRoute = await getTransportPlan(
        originCoords,
        destCoords,
        signal,
        mode
      );
    } catch (error) {
      const msg = String(error?.message || error || '');

      const isAbort =
        error?.name === 'AbortError' ||
        msg.toLowerCase().includes('aborted') ||
        msg.toLowerCase().includes('signal is aborted');

      if (!isAbort) {
        console.warn('[Mobilibus OTP plan]', msg);
      }

      transitRoute = [];
    }

    let finalCombined = combineRoutes(
      transitRoute,
      nearbyStops,
      originAddress,
      destinationAddress,
      mode
    );

    window.__lastOtpRoutes = finalCombined;

    if (mode === 'bus' && finalCombined.length === 0) {
      finalCombined = buildLiveBusRoutes(
        realtimeData,
        originCoords,
        destCoords,
        originAddress,
        destinationAddress,
        nearbyStops
      );
    }

    if (mode !== 'walk' && finalCombined.length === 0 && nearbyStops.length > 0) {
      finalCombined = nearbyStops.slice(0, 5).map((stop, index) => ({
        id: `semob_stop_${stop.stopId || index}`,
        line: mode === 'metro' ? 'Estação/parada próxima' : 'Parada próxima',
        routeId: stop.stopId || 'SEMOB_STOP',
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
        source: 'Mobilibus/SEMOB',
        instruction: `Vá até ${stop.stopName || 'uma parada próxima'} para consultar linhas disponíveis`,
        tripId: null,
        isLive: false,
        isStopFallback: true,
        lat: stop.lat,
        lon: stop.lon,
        nearestStopName: stop.stopName || 'Parada próxima',
        nearestStopLat: stop.lat,
        nearestStopLon: stop.lon,
        nearbyStops,
      }));
    }

    if (mode === 'walk' && finalCombined.length === 0) {
      const distKm = calcDist(originCoords, destCoords);
      const walkMinutes = Math.ceil((distKm / 5) * 60);

      finalCombined = [{
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
        nearbyStops,
      }];
    }

    finalCombined = finalCombined.map((route) => ({
      ...route,
      nearbyStops,
    }));

    const finalRoutes = finalCombined.map((r) => {
      const rv = findBestVehicleForRoute(realtimeData, r);

      if (rv) {
        const etaMin = getEtaMinutes(rv.eta);
        const snappedPosition = snapVehicleToRoute(rv, r);

        const stopForEta = {
          lat: r.nearestStopLat,
          lon: r.nearestStopLon,
        };

        const etaToNearestStopMinutes =
          estimateBusEtaToStop(rv, stopForEta) ??
          etaMin ??
          r.etaToNearestStopMinutes ??
          r.time;

        return {
          ...r,
          time: etaToNearestStopMinutes,
          etaToNearestStopMinutes,
          realTimeGPS: {
            lat: snappedPosition?.lat ?? Number(rv.lat),
            lon: snappedPosition?.lon ?? Number(rv.lon),

            rawLat: Number(rv.lat),
            rawLon: Number(rv.lon),

            snappedToRoute: snappedPosition?.snappedToRoute || false,
            snapDistanceKm: snappedPosition?.snapDistanceKm ?? null,

            bearing: rv.bearing,
            speed: rv.speed,
            eta: rv.eta,
            horario: rv.horario || rv.updatedAt,
            updatedAt: rv.updatedAt || rv.horario,
            numero: rv.numero,
            line: rv.line,
            sentido: rv.sentido || null,
            operadora: getVehicleOperatorName(rv),
          },
          gpsUpdatedMinutes: getGpsAgeMinutes(rv),
          isLive: true,
        };
      }

      return r.isLive ? r : { ...r, isLive: false };
    });

    if (finalRoutes.length > 0 || !alreadyShowedFastResult) {
      setRealtimeVehicles(realtimeData);
      setRoutes(finalRoutes);
    }
  } catch (err) {
    if (!axios.isCancel(err) && err.name !== 'AbortError') {
      setError(err.message || 'Erro ao buscar rotas');
    }
  } finally {
    setLoading(false);
    isSearchingRef.current = false;
  }
};
  useEffect(() => {
    const refresh = async () => {
      try {
        // Atualiza busca por linha específica
        if (window.__lastSearchType === 'line' && window.__lastLiveLine) {
          const vehicles = await getLiveVehiclesByLine(window.__lastLiveLine);

          if (vehicles?.length) {
            const liveRoutes = buildLiveBusLineRoutes(
              vehicles,
              window.__lastLiveLine,
              window.__lastLiveLine,
              'ônibus ao vivo'
            );

            setRealtimeVehicles(vehicles);
            setRoutes(liveRoutes);
          }

          return;
        }

        // Atualiza busca normal por origem/destino recalculando ETA até a parada
        if (
          window.__lastOriginCoords &&
          window.__lastDestinationCoords &&
          window.__lastSearchMode === 'bus'
        ) {
          const nv = await getRealtimeVehicles();

          const baseRoutes = window.__lastOtpRoutes?.length
            ? window.__lastOtpRoutes
            : buildLiveBusRoutes(
              nv,
              window.__lastOriginCoords,
              window.__lastDestinationCoords,
              window.__lastOriginAddress || 'origem',
              window.__lastDestinationAddress || 'destino',
              window.__lastNearbyStops || []
            );

          const baseRoutesWithStops = baseRoutes.map((route) => ({
            ...route,
            nearbyStops: route.nearbyStops || window.__lastNearbyStops || [],
          }));

          const rebuiltRoutes = baseRoutesWithStops.map((r) => {
            const rv = findBestVehicleForRoute(nv, r);

if (rv) {
  const etaMin = getEtaMinutes(rv.eta);
  const snappedPosition = snapVehicleToRoute(rv, r);

  const stopForEta = {
    lat: r.nearestStopLat,
    lon: r.nearestStopLon,
  };

  const etaToNearestStopMinutes =
    estimateBusEtaToStop(rv, stopForEta) ??
    etaMin ??
    r.etaToNearestStopMinutes ??
    r.time;

  return {
    ...r,
    time: etaToNearestStopMinutes,
    etaToNearestStopMinutes,
    realTimeGPS: {
      lat: snappedPosition?.lat ?? Number(rv.lat),
      lon: snappedPosition?.lon ?? Number(rv.lon),

      rawLat: Number(rv.lat),
      rawLon: Number(rv.lon),

      snappedToRoute: snappedPosition?.snappedToRoute || false,
      snapDistanceKm: snappedPosition?.snapDistanceKm ?? null,

      bearing: rv.bearing,
      speed: rv.speed,
      eta: rv.eta,
      horario: rv.horario || rv.updatedAt,
      updatedAt: rv.updatedAt || rv.horario,
      numero: rv.numero,
      line: rv.line,
      sentido: rv.sentido || null,
      operadora: getVehicleOperatorName(rv),
    },
    gpsUpdatedMinutes: getGpsAgeMinutes(rv),
    isLive: true,
  };
}

            return r.isLive ? r : { ...r, isLive: false };
          });

          setRealtimeVehicles(nv);
          setRoutes(rebuiltRoutes);

          return;
        }
      } catch (error) {
        console.warn(
          '[DFTrans GPS] Falha ao atualizar veículos ao vivo:',
          error?.message || error
        );
      }
    };

    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(refresh, 10000);

    return () => {
      clearInterval(intervalRef.current);
      abortControllerRef.current?.abort();
    };
  }, [getRealtimeVehicles]);


  return {
    routes,
    loading,
    error,
    searchRoute,
    searchBusLine,
    realtimeVehicles,
  };
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
      const localResults = await findLocalDfPlaces(safe, { limit: 12 });

      const r = await axios.get(
        `https://api.tomtom.com/search/2/search/${encodeURIComponent(safe)}.json`,
        {
          params: {
            key: TOMTOM_API_KEY,
            idxSet: 'POI,PAD,STR,XSTR,GEO,ADDR',
            countrySet: 'BR',
            lat: -15.7939,
            lon: -47.8828,
            radius: 70000,
            limit: 8,
            language: 'pt-BR'
          },
          signal: abortRef.current.signal
        }
      );

      const tomtomResults = (r.data.results || []).map((item) => ({
        ...item,
        source: 'TomTom',
      }));

      const localSuggestions = localResults.map((place) => ({
        source: place.source || 'SEMOB/DF',
        poi: { name: place.name },
        address: {
          freeformAddress: place.address || place.name,
          municipality: place.type || 'DF',
          countrySubdivision: 'Distrito Federal',
        },
        position: place.position,
        stopId: place.stopId,
      }));

      const merged = [...localSuggestions, ...tomtomResults]
        .filter((item, index, arr) => {
          const key = String(item.address?.freeformAddress || item.poi?.name || '').toLowerCase();
          return key && arr.findIndex((x) => String(x.address?.freeformAddress || x.poi?.name || '').toLowerCase() === key) === index;
        })
        .slice(0, 10);

      setSuggestions(merged);
      setShowSuggestions(merged.length > 0);
    } catch (e) {
      if (!axios.isCancel(e)) {
        console.error('Erro na busca TomTom:', e);
        // Tratar erro de localização negada
        if (e.response?.status === 403) {
          console.warn('Serviço de localização temporariamente indisponível');
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
                <p className="text-xs text-[var(--text-tertiary)] truncate">{s.source ? `${s.source} • ` : ''}{s.address.municipality || s.address.countrySubdivision}</p>
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
  const {
    routes,
    loading,
    error,
    searchRoute,
    searchBusLine,
  } = useRouteSearch();
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

    if (selectedMode === 'bus') {
      if (isBusLineSearch(safeO)) {
        await searchBusLine(safeO, safeO, safeD);
        return;
      }

      if (isBusLineSearch(safeD)) {
        await searchBusLine(safeD, safeO, safeD);
        return;
      }
    }

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
              <span className="text-[11px] md:text-xs font-medium text-white/90 tracking-wide">DFTrans GPS — ônibus ao vivo no DF</span>
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
                  { name: 'Ônibus', type: 'bus', icon: Bus, desc: 'DFTrans GPS' },
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

<footer className="pb-8 text-center">
  <p className="text-[11px] font-semibold tracking-wide text-[var(--text-tertiary)]">
    LocalizaBus — Mobilidade urbana inteligente
  </p>
  <p className="mt-1 text-[10px] text-[var(--text-tertiary)]/70">
    Transporte público do Distrito Federal em tempo real
  </p>
</footer>
    </div>
  );
}

export default function WrappedApp() {
  return <ErrorBoundary><App /></ErrorBoundary>;
}