// src/comp/WalkingMapModal.jsx
// Navegação Carro/Moto/Caminhada com MapLibre GL JS + OpenFreeMap
// Mantém o resto do site intacto e usa o TomTom/ORS apenas para cálculo de rota quando necessário.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bike,
  Car,
  Crosshair,
  ExternalLink,
  Footprints,
  LocateFixed,
  MapPin,
  Maximize2,
  Minimize2,
  Navigation,
  RotateCcw,
  Square,
  X,
} from 'lucide-react';
import { ORS_API_KEY, TOMTOM_API_KEY } from '../config/apiKeys';

const ORS_KEY = ORS_API_KEY;
const TOMTOM_KEY = TOMTOM_API_KEY;
const OPENFREEMAP_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
const OPENFREEMAP_DARK = 'https://tiles.openfreemap.org/styles/dark';

const isValidCoord = (lat, lon) =>
  Number.isFinite(Number(lat)) &&
  Number.isFinite(Number(lon)) &&
  Number(lat) >= -90 &&
  Number(lat) <= 90 &&
  Number(lon) >= -180 &&
  Number(lon) <= 180 &&
  !(Math.abs(Number(lat)) < 0.001 && Math.abs(Number(lon)) < 0.001);

const hav = (a, b, c, d) => {
  const R = 6371000;
  const dLat = (c - a) * Math.PI / 180;
  const dLon = (d - b) * Math.PI / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

const bear = (a, b, c, d) => {
  const dLon = (d - b) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(c * Math.PI / 180);
  const x =
    Math.cos(a * Math.PI / 180) * Math.sin(c * Math.PI / 180) -
    Math.sin(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
};

const formatDistance = (meters = 0) => {
  const m = Math.max(0, Number(meters) || 0);
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
};

const formatDuration = (seconds = 0) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h}h ${rest}min` : `${h}h`;
};

const stripHtmlTags = (text) => String(text || '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\s{2,}/g, ' ')
  .trim();

const getIsDarkMode = (explicit) => {
  if (typeof explicit === 'boolean') return explicit;
  if (typeof document !== 'undefined') {
    if (document.documentElement.classList.contains('dark')) return true;
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
  }
  return typeof window !== 'undefined'
    ? window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    : false;
};

const getProfile = (mode) => {
  if (mode === 'walk') return 'foot-walking';
  // ORS não tem perfil específico de moto. Para moto usamos rota de carro.
  return 'driving-car';
};

const getExternalTravelMode = (mode) => {
  if (mode === 'car' || mode === 'motorcycle') return { google: 'driving', apple: 'd' };
  return { google: 'walking', apple: 'w' };
};

const openNativeNavigation = (destLat, destLon, destName, mode = 'walk') => {
  const label = encodeURIComponent(destName || 'Destino');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const externalMode = getExternalTravelMode(mode);
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLon}&travelmode=${externalMode.google}`;

  if (isIOS) {
    const apple = `maps://?daddr=${destLat},${destLon}&dirflg=${externalMode.apple}`;
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = apple;
    document.body.appendChild(iframe);
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch (_) { }
      window.open(gmaps, '_blank', 'noopener');
    }, 700);
    return;
  }

  const a = document.createElement('a');
  a.href = `geo:${destLat},${destLon}?q=${destLat},${destLon}(${label})`;
  a.click();
  setTimeout(() => window.open(gmaps, '_blank', 'noopener'), 700);
};

const geocodeWithTomTom = async (addr, signal) => {
  if (!TOMTOM_KEY) throw new Error('Coordenadas do destino ausentes. Pesquise um endereço válido ou configure a chave TomTom para geocodificação.');

  const response = await fetch(
    `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(addr)}.json?key=${TOMTOM_KEY}&countrySet=BR&limit=1`,
    { signal }
  );

  if (!response.ok) throw new Error(`Erro ao localizar endereço (HTTP ${response.status}).`);

  const data = await response.json();
  const pos = data.results?.[0]?.position;

  if (!pos || !isValidCoord(pos.lat, pos.lon)) {
    throw new Error(`Não encontrei coordenadas válidas para: ${addr}`);
  }

  return { lat: Number(pos.lat), lon: Number(pos.lon) };
};

const routeFromOrs = async (origin, destination, signal, mode) => {
  if (!ORS_KEY) throw new Error('Chave OpenRouteService ausente. Configure VITE_ORS_API_KEY na Vercel.');

  const profile = getProfile(mode);
  const response = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: ORS_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json, application/geo+json',
    },
    body: JSON.stringify({
      coordinates: [[origin.lon, origin.lat], [destination.lon, destination.lat]],
      instructions: true,
      language: 'pt',
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Erro ao calcular rota ORS (HTTP ${response.status}): ${text.slice(0, 120)}`);
  }

  const data = await response.json();
  const feature = data.features?.[0];
  const pts = feature?.geometry?.coordinates || [];
  const summary = feature?.properties?.summary || {};
  const steps = feature?.properties?.segments?.flatMap(segment => segment.steps || []) || [];

  if (!pts.length) throw new Error('Não encontrei uma rota válida entre os pontos.');

  let currentOffset = 0;
  const instrs = steps.map((step) => {
    const item = {
      msg: stripHtmlTags(step.instruction || 'Siga pela rota destacada'),
      man: String(step.type ?? '').toLowerCase(),
      off: currentOffset,
      dist: Number(step.distance || 0),
      duration: Number(step.duration || 0),
    };
    currentOffset += Number(step.distance || 0);
    return item;
  });

  const initialBearing = pts.length > 1 ? bear(pts[0][1], pts[0][0], pts[1][1], pts[1][0]) : 0;

  return {
    pts,
    instrs: instrs.length ? instrs : [{ msg: 'Siga pela rota destacada', man: 'straight', off: 0 }],
    totalM: Number(summary.distance || 0),
    totalS: Number(summary.duration || 0),
    geo: feature,
    initialBearing,
    provider: 'OpenRouteService',
  };
};

const routeFromTomTom = async (origin, destination, signal, mode) => {
  if (!TOMTOM_KEY) throw new Error('Chave TomTom ausente para calcular rota.');

  const travelMode = mode === 'walk' ? 'pedestrian' : mode === 'motorcycle' ? 'motorcycle' : 'car';
  const routeType = travelMode === 'pedestrian' ? 'shortest' : 'fastest';
  const url =
    `https://api.tomtom.com/routing/1/calculateRoute/${origin.lat},${origin.lon}:${destination.lat},${destination.lon}/json` +
    `?key=${TOMTOM_KEY}&travelMode=${travelMode}&routeType=${routeType}&traffic=true&instructionsType=tagged&language=pt-BR`;

  const response = await fetch(url, { signal });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Erro ao calcular rota TomTom (HTTP ${response.status}): ${body.slice(0, 120)}`);
  }

  const data = await response.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('Nenhuma rota encontrada entre os pontos.');

  const pts = route.legs?.flatMap(leg => leg.points || []).map(p => [p.longitude, p.latitude]) || [];
  const instrs = (route.guidance?.instructions || []).map(i => ({
    msg: stripHtmlTags(i.message || i.street || 'Siga pela rota destacada'),
    man: String(i.maneuver || 'straight').toLowerCase(),
    off: Number(i.routeOffsetInMeters || 0),
    dist: Number(i.travelTimeInSeconds || 0),
  }));

  const initialBearing = pts.length > 1 ? bear(pts[0][1], pts[0][0], pts[1][1], pts[1][0]) : 0;

  return {
    pts,
    instrs: instrs.length ? instrs : [{ msg: 'Siga pela rota destacada', man: 'straight', off: 0 }],
    totalM: Number(route.summary?.lengthInMeters || 0),
    totalS: Number(route.summary?.travelTimeInSeconds || 0),
    geo: { type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} },
    initialBearing,
    provider: 'TomTom Routing',
  };
};

const calculateRoute = async (origin, destination, signal, mode) => {
  if (!isValidCoord(origin.lat, origin.lon)) throw new Error('Origem inválida. Verifique sua localização.');
  if (!isValidCoord(destination.lat, destination.lon)) throw new Error('Destino inválido. Verifique o endereço.');

  if (ORS_KEY) return routeFromOrs(origin, destination, signal, mode);
  return routeFromTomTom(origin, destination, signal, mode);
};

const ManIcon = ({ type, size = 28 }) => {
  const text = String(type || '').toLowerCase();
  if (text.includes('left') || text === '0' || text === '6') return <ArrowLeft width={size} height={size} strokeWidth={3} />;
  if (text.includes('right') || text === '1' || text === '7') return <ArrowRight width={size} height={size} strokeWidth={3} />;
  if (text.includes('uturn') || text.includes('turnaround')) return <RotateCcw width={size} height={size} strokeWidth={3} />;
  return <ArrowUp width={size} height={size} strokeWidth={3} />;
};

const VehiclePin = ({ mode = 'walk', dark = true }) => {
  const icon = mode === 'car' ? '🚗' : mode === 'motorcycle' ? '🏍️' : '➤';
  return `
    <div style="position:relative;width:52px;height:52px;display:flex;align-items:center;justify-content:center;">
      <div style="position:absolute;inset:0;border-radius:999px;background:${dark ? 'rgba(0,243,255,.16)' : 'rgba(37,99,235,.16)'};box-shadow:0 0 28px ${dark ? 'rgba(0,243,255,.45)' : 'rgba(37,99,235,.28)'};animation:lbPulse 2s infinite ease-out;"></div>
      <div style="position:relative;width:38px;height:38px;border-radius:999px;background:${dark ? '#07111f' : '#ffffff'};border:3px solid #00f3ff;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 22px rgba(0,0,0,.38);font-size:19px;transform:rotate(0deg);">
        ${icon}
      </div>
      <style>@keyframes lbPulse{0%{transform:scale(.9);opacity:.9}100%{transform:scale(2.1);opacity:0}}</style>
    </div>`;
};

const DestPin = ({ mode = 'walk' }) => {
  const icon = mode === 'car' ? '🚗' : mode === 'motorcycle' ? '🏍️' : '🏁';
  return `
    <div style="display:flex;flex-direction:column;align-items:center;">
      <div style="width:38px;height:38px;border-radius:50% 50% 50% 0;background:linear-gradient(135deg,#00f3ff,#5b36ff);border:3px solid #fff;box-shadow:0 8px 24px rgba(0,0,0,.34);transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;">
        <span style="transform:rotate(45deg);font-size:16px;">${icon}</span>
      </div>
    </div>`;
};

const getModeLabel = (mode) => mode === 'motorcycle' ? 'moto' : mode === 'car' ? 'carro' : 'caminhada';

const WalkingMapModal = ({ route, userLocation, onClose, isDark: isDarkProp }) => {
  const navigationMode = route?.navigationMode || (route?.isWalk ? 'walk' : 'walk');
  const isDrivingMode = navigationMode === 'car' || navigationMode === 'motorcycle';
  const modeLabel = getModeLabel(navigationMode);
  const isDark = useMemo(() => getIsDarkMode(isDarkProp), [isDarkProp]);

  const wrapRef = useRef(null);
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);
  const watchRef = useRef(null);
  const timerRef = useRef(null);
  const t0Ref = useRef(null);
  const lastRef = useRef(null);
  const rdRef = useRef(null);
  const originRef = useRef(null);
  const destRef = useRef(null);
  const mountedRef = useRef(true);

  const [mapReady, setMapReady] = useState(false);
  const [rd, setRd] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadMsg, setLoadMsg] = useState('Preparando navegação…');
  const [nav, setNav] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [overview, setOverview] = useState(false);
  const [fs, setFs] = useState(false);
  const [brng, setBrng] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [covered, setCovered] = useState(0);
  const [remain, setRemain] = useState(null);
  const [acc, setAcc] = useState(null);
  const [curI, setCurI] = useState(null);
  const [nextI, setNextI] = useState(null);
  const [arrived, setArrived] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const accent = isDrivingMode ? '#5b36ff' : '#00a8ff';
  const routeColor = isDrivingMode ? '#6c4cff' : '#008cff';
  const routeGlow = isDark ? '#00f3ff' : '#5b36ff';
  const panelBg = isDark ? 'rgba(5,8,16,.92)' : 'rgba(255,255,255,.94)';
  const panelText = isDark ? '#fff' : '#111827';
  const panelSub = isDark ? 'rgba(255,255,255,.62)' : 'rgba(17,24,39,.58)';
  const chipBg = isDark ? 'rgba(255,255,255,.08)' : 'rgba(17,24,39,.06)';
  const border = isDark ? '1px solid rgba(0,243,255,.18)' : '1px solid rgba(17,24,39,.12)';
  const styleUrl = isDark ? OPENFREEMAP_DARK : OPENFREEMAP_LIGHT;

  useEffect(() => {
    setIsMobile(/Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent));
  }, []);

  const setCameraNavigation = useCallback((position, bearingValue = brng, duration = 700) => {
    const map = mapRef.current;
    if (!map || !position) return;

    map.easeTo({
      center: [Number(position.lon), Number(position.lat)],
      zoom: 17.6,
      pitch: 62,
      bearing: Number.isFinite(Number(bearingValue)) ? Number(bearingValue) : 0,
      duration,
      padding: { top: 90, bottom: 210, left: 0, right: 0 },
      easing: t => t,
    });
  }, [brng]);

  const fitRoute = useCallback((pts) => {
    const map = mapRef.current;
    if (!map || !pts?.length) return;

    const bounds = pts.reduce(
      (b, p) => b.extend(p),
      new maplibregl.LngLatBounds(pts[0], pts[0])
    );

    map.fitBounds(bounds, {
      padding: { top: 120, bottom: 220, left: 48, right: 48 },
      duration: 800,
      pitch: 0,
      bearing: 0,
    });
  }, []);

  const addOrUpdateUserPin = useCallback((pos) => {
    const map = mapRef.current;
    if (!map || !isValidCoord(pos.lat, pos.lon)) return;

    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.innerHTML = VehiclePin({ mode: navigationMode, dark: isDark });
      userMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center', rotationAlignment: 'map' })
        .setLngLat([pos.lon, pos.lat])
        .addTo(map);
      return;
    }

    userMarkerRef.current.setLngLat([pos.lon, pos.lat]);
  }, [navigationMode, isDark]);

  const addDestinationPin = useCallback((pos) => {
    const map = mapRef.current;
    if (!map || !isValidCoord(pos.lat, pos.lon) || destMarkerRef.current) return;

    const el = document.createElement('div');
    el.innerHTML = DestPin({ mode: navigationMode });
    destMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([pos.lon, pos.lat])
      .addTo(map);
  }, [navigationMode]);

  const drawRoute = useCallback((data) => {
    const map = mapRef.current;
    if (!map || !data?.geo) return;

    const source = map.getSource('lb-route');
    if (source) {
      source.setData(data.geo);
      return;
    }

    map.addSource('lb-route', { type: 'geojson', data: data.geo });

    map.addLayer({
      id: 'lb-route-shadow',
      type: 'line',
      source: 'lb-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-width': 18, 'line-opacity': isDark ? 0.45 : 0.22, 'line-blur': 8 },
    });

    map.addLayer({
      id: 'lb-route-glow',
      type: 'line',
      source: 'lb-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': routeGlow, 'line-width': 12, 'line-opacity': isDark ? 0.62 : 0.35, 'line-blur': 3 },
    });

    map.addLayer({
      id: 'lb-route-main',
      type: 'line',
      source: 'lb-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': routeColor, 'line-width': 7, 'line-opacity': 1 },
    });

    map.addLayer({
      id: 'lb-route-highlight',
      type: 'line',
      source: 'lb-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.65 },
    });
  }, [isDark, routeColor, routeGlow]);

  const resolveCoords = useCallback(async (signal) => {
    let origin = null;
    let destination = null;

    if (isValidCoord(route?.fromLat, route?.fromLon)) {
      origin = { lat: Number(route.fromLat), lon: Number(route.fromLon) };
    } else if (isValidCoord(userLocation?.lat, userLocation?.lon)) {
      origin = { lat: Number(userLocation.lat), lon: Number(userLocation.lon) };
    } else if (route?.origin) {
      origin = await geocodeWithTomTom(route.origin, signal);
    } else {
      origin = { lat: -15.7934, lon: -47.8823 };
    }

    if (isValidCoord(route?.toLat, route?.toLon)) {
      destination = {
        lat: Number(route.toLat),
        lon: Number(route.toLon),
        name: route.destination || route.toStop || 'Destino',
      };
    } else if (isValidCoord(route?.lat, route?.lon) && !route?.isNavigationRoute) {
      destination = { lat: Number(route.lat), lon: Number(route.lon), name: route.fromStop || 'Ponto de embarque' };
    } else if (route?.destination) {
      destination = { ...(await geocodeWithTomTom(route.destination, signal)), name: route.destination };
    } else {
      destination = { lat: -15.7801, lon: -47.9292, name: 'Destino' };
    }

    const straightDistance = hav(origin.lat, origin.lon, destination.lat, destination.lon);
    if (straightDistance > 180000 && isDrivingMode) {
      throw new Error('A rota parece muito distante. Verifique origem e destino.');
    }

    return { origin, destination };
  }, [route, userLocation, isDrivingMode]);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();

    (async () => {
      try {
        setLoading(true);
        setLoadMsg('Localizando pontos…');

        const { origin, destination } = await resolveCoords(controller.signal);
        if (!mountedRef.current) return;

        originRef.current = origin;
        destRef.current = destination;

        const map = new maplibregl.Map({
          container: mapElRef.current,
          style: styleUrl,
          center: [origin.lon, origin.lat],
          zoom: 17.2,
          pitch: 62,
          bearing: 0,
          attributionControl: false,
        });

        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
        map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

        map.on('load', () => {
          if (!mountedRef.current) return;
          addOrUpdateUserPin(origin);
          addDestinationPin(destination);
          setMapReady(true);
        });

        map.on('dragstart', () => setOverview(true));
        map.on('rotatestart', () => setOverview(true));
        map.on('pitchstart', () => setOverview(true));
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (mountedRef.current) {
          setErr(e.message || 'Falha ao preparar o mapa.');
          setLoading(false);
        }
      }
    })();

    return () => {
      mountedRef.current = false;
      controller.abort();
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      clearInterval(timerRef.current);
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch (_) { }
      }
      mapRef.current = null;
      userMarkerRef.current = null;
      destMarkerRef.current = null;
    };
  }, [resolveCoords, styleUrl, addOrUpdateUserPin, addDestinationPin]);

  useEffect(() => {
    if (!mapReady) return undefined;
    const controller = new AbortController();

    (async () => {
      try {
        setLoadMsg('Calculando rota…');
        const origin = originRef.current;
        const destination = destRef.current;
        const data = await calculateRoute(origin, destination, controller.signal, navigationMode);

        if (!mountedRef.current) return;

        if (data.totalM > 180000 && isDrivingMode) {
          throw new Error('A rota parece muito distante. Verifique origem e destino.');
        }

        rdRef.current = data;
        setRd(data);
        setRemain(data.totalM);
        setCurI(data.instrs?.[0] || { msg: 'Siga pela rota destacada', man: 'straight' });
        setNextI(data.instrs?.[1] || null);
        setBrng(data.initialBearing || 0);
        drawRoute(data);
        setCameraNavigation(origin, data.initialBearing || 0, 900);
        setLoading(false);
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (mountedRef.current) {
          setErr(e.message || 'Falha ao calcular rota.');
          setLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [mapReady, navigationMode, isDrivingMode, drawRoute, setCameraNavigation]);

  const updateInstr = useCallback((distM) => {
    const data = rdRef.current;
    if (!data?.instrs?.length) return;
    let idx = 0;
    for (let i = 0; i < data.instrs.length; i += 1) {
      if (Number(data.instrs[i].off || 0) <= distM) idx = i;
      else break;
    }
    setCurI(data.instrs[idx]);
    setNextI(data.instrs[idx + 1] || null);
  }, []);

  const onGPS = useCallback((pos) => {
    const { latitude, longitude, accuracy, heading } = pos.coords;
    const current = { lat: Number(latitude), lon: Number(longitude) };
    if (!isValidCoord(current.lat, current.lon)) return;

    setAcc(Math.round(Number(accuracy || 0)));

    let nextBearing = Number.isFinite(heading) && heading >= 0 ? Number(heading) : brng;
    if ((!Number.isFinite(nextBearing) || nextBearing === 0) && lastRef.current) {
      nextBearing = bear(lastRef.current.lat, lastRef.current.lon, current.lat, current.lon);
    }

    lastRef.current = current;
    setBrng(nextBearing || 0);
    addOrUpdateUserPin(current);

    if (!overview) setCameraNavigation(current, nextBearing || 0, 650);

    const data = rdRef.current;
    const origin = originRef.current;
    const destination = destRef.current;

    if (data && origin) {
      const done = Math.min(hav(origin.lat, origin.lon, current.lat, current.lon), data.totalM || 0);
      const remaining = Math.max(0, (data.totalM || 0) - done);
      setCovered(done);
      setRemain(remaining);
      updateInstr(done);

      if (destination && hav(current.lat, current.lon, destination.lat, destination.lon) < 30) {
        setArrived(true);
        setTracking(false);
      }
    }
  }, [overview, brng, addOrUpdateUserPin, setCameraNavigation, updateInstr]);

  const stopWatch = useCallback(() => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    clearInterval(timerRef.current);
  }, []);

  const startNav = useCallback(async () => {
    if (!rdRef.current) return;
    if (!navigator.geolocation) {
      setErr('GPS não disponível neste navegador.');
      return;
    }

    setErr(null);
    setNav(true);
    setTracking(true);
    setOverview(false);
    setArrived(false);

    if (!document.fullscreenElement && wrapRef.current) {
      try { await wrapRef.current.requestFullscreen(); setFs(true); } catch (_) { }
    }

    t0Ref.current = Date.now() - elapsed * 1000;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - t0Ref.current) / 1000));
    }, 1000);

    const handleError = (e) => {
      const message = e?.code === 1
        ? 'Permissão de localização negada. Libere o GPS do navegador.'
        : e?.code === 2
          ? 'Não consegui obter sua localização. Ative o GPS e tente novamente.'
          : 'Tempo esgotado ao buscar sua localização. Tente novamente.';
      setErr(message);
      setTracking(false);
      stopWatch();
    };

    navigator.geolocation.getCurrentPosition(onGPS, handleError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 12000,
    });

    watchRef.current = navigator.geolocation.watchPosition(onGPS, handleError, {
      enableHighAccuracy: true,
      maximumAge: 800,
      timeout: 12000,
    });

    const origin = originRef.current;
    setCameraNavigation(lastRef.current || origin, rdRef.current.initialBearing || brng, 650);
  }, [elapsed, onGPS, stopWatch, setCameraNavigation, brng]);

  const pauseNav = useCallback(() => {
    setTracking(false);
    stopWatch();
  }, [stopWatch]);

  const stopNav = useCallback(() => {
    pauseNav();
    setNav(false);
    setElapsed(0);
    setCovered(0);
    setRemain(rdRef.current?.totalM || null);
    setArrived(false);
    lastRef.current = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    setFs(false);
    setOverview(false);
    setCameraNavigation(originRef.current, rdRef.current?.initialBearing || 0, 650);
  }, [pauseNav, setCameraNavigation]);

  const toggleOverview = useCallback(() => {
    setOverview(prev => {
      const next = !prev;
      if (next) fitRoute(rdRef.current?.pts);
      else setCameraNavigation(lastRef.current || originRef.current, brng || rdRef.current?.initialBearing || 0, 650);
      return next;
    });
  }, [fitRoute, setCameraNavigation, brng]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await wrapRef.current?.requestFullscreen();
        setFs(true);
      } else {
        await document.exitFullscreen();
        setFs(false);
      }
    } catch (_) {
      setFs(false);
    }
  }, []);

  useEffect(() => {
    const handle = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handle);
    return () => document.removeEventListener('fullscreenchange', handle);
  }, []);

  const recenter = useCallback(() => {
    setOverview(false);
    setCameraNavigation(lastRef.current || originRef.current, brng || rdRef.current?.initialBearing || 0, 650);
  }, [setCameraNavigation, brng]);

  const close = useCallback(() => {
    stopWatch();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    document.body.style.overflow = '';
    onClose?.();
  }, [onClose, stopWatch]);

  const progress = rd?.totalM ? Math.min(100, Math.max(0, (covered / rd.totalM) * 100)) : 0;
  const eta = remain != null && rd?.totalM ? Math.max(0, (rd.totalS || 0) * (remain / rd.totalM)) : rd?.totalS;
  const destName = destRef.current?.name || route?.toStop || route?.destination || 'Destino';
  const destCoords = destRef.current;
  const topInstruction = stripHtmlTags(curI?.msg) || 'Siga pela rota destacada';
  const nextInstruction = stripHtmlTags(nextI?.msg);

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        background: isDark ? '#050810' : '#f8fafc',
        color: panelText,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div ref={mapElRef} style={{ flex: 1, width: '100%', minHeight: 0, position: 'relative' }} />

      {loading && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'grid', placeItems: 'center', background: isDark ? '#050810' : '#f8fafc' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: 999, border: `3px solid ${isDark ? 'rgba(0,243,255,.18)' : 'rgba(91,54,255,.18)'}`, borderTopColor: accent, margin: '0 auto 16px', animation: 'lbSpin 1s linear infinite' }} />
            <p style={{ margin: 0, color: accent, fontWeight: 900, letterSpacing: .4 }}>{loadMsg}</p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: panelSub }}>MapLibre + OpenFreeMap · {modeLabel}</p>
            <style>{'@keyframes lbSpin{to{transform:rotate(360deg)}}'}</style>
          </div>
        </div>
      )}

      {err && !loading && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 25, display: 'grid', placeItems: 'center', background: isDark ? 'rgba(5,8,16,.94)' : 'rgba(248,250,252,.94)', padding: 24 }}>
          <div style={{ width: 'min(92vw, 380px)', background: panelBg, border, borderRadius: 24, padding: 24, textAlign: 'center', boxShadow: '0 20px 70px rgba(0,0,0,.35)' }}>
            <MapPin style={{ color: '#ef4444', width: 38, height: 38, margin: '0 auto 12px' }} />
            <p style={{ color: panelText, fontWeight: 800, margin: 0 }}>Não consegui abrir a navegação</p>
            <p style={{ color: panelSub, fontSize: 13, lineHeight: 1.45 }}>{err}</p>
            <button onClick={close} type="button" style={{ marginTop: 12, padding: '12px 22px', borderRadius: 999, border: 'none', background: accent, color: '#fff', fontWeight: 900, cursor: 'pointer' }}>Fechar</button>
          </div>
        </div>
      )}

      <button onClick={nav ? stopNav : close} type="button" aria-label="Fechar navegação" style={{ position: 'absolute', top: 'max(env(safe-area-inset-top,0px),14px)', left: 14, zIndex: 30, width: 44, height: 44, borderRadius: 999, border, background: panelBg, color: panelText, display: 'grid', placeItems: 'center', boxShadow: '0 10px 30px rgba(0,0,0,.25)', cursor: 'pointer' }}>
        <X width={18} height={18} />
      </button>

      <button onClick={toggleFullscreen} type="button" aria-label="Tela cheia" style={{ position: 'absolute', top: 'max(env(safe-area-inset-top,0px),14px)', right: 14, zIndex: 30, width: 44, height: 44, borderRadius: 999, border, background: panelBg, color: accent, display: 'grid', placeItems: 'center', boxShadow: '0 10px 30px rgba(0,0,0,.25)', cursor: 'pointer' }}>
        {fs ? <Minimize2 width={17} height={17} /> : <Maximize2 width={17} height={17} />}
      </button>

      {nav && (
        <button onClick={toggleOverview} type="button" style={{ position: 'absolute', top: 'max(env(safe-area-inset-top,0px),14px)', right: 66, zIndex: 30, height: 44, borderRadius: 999, border, background: overview ? accent : panelBg, color: overview ? '#fff' : panelText, padding: '0 14px', fontSize: 12, fontWeight: 900, boxShadow: '0 10px 30px rgba(0,0,0,.22)', cursor: 'pointer' }}>
          {overview ? 'Voltar 3D' : 'Visão geral'}
        </button>
      )}

      <AnimatePresence>
        {nav && !overview && !arrived && (
          <motion.div
            initial={{ y: -80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            style={{ position: 'absolute', top: 'max(env(safe-area-inset-top,0px),66px)', left: 12, right: 12, zIndex: 24 }}
          >
            <div style={{ background: 'linear-gradient(135deg,#5b36ff,#0077ff)', borderRadius: 24, color: '#fff', padding: '14px 16px', boxShadow: '0 20px 52px rgba(0,0,0,.32)' }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <div style={{ width: 56, height: 56, borderRadius: 18, background: 'rgba(255,255,255,.16)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <ManIcon type={curI?.man} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 19, fontWeight: 950, lineHeight: 1.18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{topInstruction}</p>
                  {nextInstruction && <p style={{ margin: '5px 0 0', fontSize: 12, color: 'rgba(255,255,255,.72)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Depois: {nextInstruction}</p>}
                </div>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,.22)', borderRadius: 999, marginTop: 12, overflow: 'hidden' }}>
                <motion.div animate={{ width: `${progress}%` }} style={{ height: '100%', background: '#fff', borderRadius: 999 }} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {tracking && acc != null && (
        <div style={{ position: 'absolute', left: 14, bottom: nav ? 18 : 210, zIndex: 23, background: panelBg, border, color: acc < 35 ? accent : '#f59e0b', borderRadius: 999, padding: '6px 10px', fontSize: 11, fontWeight: 900, boxShadow: '0 8px 24px rgba(0,0,0,.2)' }}>
          GPS ±{acc}m
        </div>
      )}

      {nav && (
        <div style={{ position: 'absolute', right: 14, bottom: 18, zIndex: 23, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={recenter} type="button" aria-label="Recentralizar" style={{ width: 48, height: 48, borderRadius: 999, border, background: panelBg, color: accent, display: 'grid', placeItems: 'center', boxShadow: '0 10px 30px rgba(0,0,0,.24)', cursor: 'pointer' }}>
            <LocateFixed width={20} height={20} />
          </button>
          <div style={{ background: panelBg, border, borderRadius: 18, padding: '10px 14px', textAlign: 'right', boxShadow: '0 10px 30px rgba(0,0,0,.24)' }}>
            <p style={{ margin: 0, color: accent, fontSize: 22, fontWeight: 950, lineHeight: 1 }}>{formatDistance(remain ?? rd?.totalM ?? 0)}</p>
            <p style={{ margin: '3px 0 0', color: panelSub, fontSize: 11, fontWeight: 800 }}>{formatDuration(eta ?? 0)}</p>
          </div>
        </div>
      )}

      <AnimatePresence>
        {arrived && (
          <motion.div initial={{ scale: .86, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'absolute', top: '34%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 40, width: 'min(88vw, 340px)', background: panelBg, border, borderRadius: 28, padding: 26, textAlign: 'center', boxShadow: '0 24px 80px rgba(0,0,0,.38)' }}>
            <div style={{ fontSize: 46 }}>🎉</div>
            <p style={{ margin: '8px 0 4px', color: panelText, fontSize: 22, fontWeight: 950 }}>Destino alcançado!</p>
            <p style={{ margin: 0, color: panelSub, fontSize: 13 }}>{formatDistance(rd?.totalM || 0)} · {formatDuration(elapsed)}</p>
            <button onClick={stopNav} type="button" style={{ marginTop: 16, padding: '12px 22px', borderRadius: 999, border: 'none', background: accent, color: '#fff', fontWeight: 900, cursor: 'pointer' }}>Encerrar</button>
          </motion.div>
        )}
      </AnimatePresence>

      {!nav && (
        <div style={{ position: 'absolute', left: 12, right: 12, bottom: 'max(env(safe-area-inset-bottom,0px),12px)', zIndex: 22 }}>
          <div style={{ background: panelBg, border, borderRadius: 26, padding: 16, boxShadow: '0 22px 70px rgba(0,0,0,.28)', backdropFilter: 'blur(18px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: isDark ? '1px solid rgba(255,255,255,.08)' : '1px solid rgba(17,24,39,.08)', paddingBottom: 12, marginBottom: 12 }}>
              <MapPin width={18} height={18} color={accent} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, color: panelSub, fontSize: 10, fontWeight: 900, letterSpacing: 1, textTransform: 'uppercase' }}>Destino</p>
                <p style={{ margin: 0, color: panelText, fontSize: 14, fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{destName}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ margin: 0, color: accent, fontSize: 21, fontWeight: 950, lineHeight: 1 }}>{formatDistance(remain ?? rd?.totalM ?? 0)}</p>
                <p style={{ margin: '3px 0 0', color: panelSub, fontSize: 11, fontWeight: 800 }}>{formatDuration(eta ?? rd?.totalS ?? 0)}</p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9, marginBottom: 14 }}>
              {[{ label: 'Modo', value: modeLabel }, { label: 'Mapa', value: '3D' }, { label: 'Fonte', value: rd?.provider || '—' }].map(item => (
                <div key={item.label} style={{ background: chipBg, border: isDark ? '1px solid rgba(255,255,255,.06)' : '1px solid rgba(17,24,39,.07)', borderRadius: 16, padding: '9px 8px', textAlign: 'center' }}>
                  <p style={{ margin: 0, color: panelText, fontSize: 13, fontWeight: 950, textTransform: item.label === 'Modo' ? 'capitalize' : 'none' }}>{item.value}</p>
                  <p style={{ margin: '2px 0 0', color: panelSub, fontSize: 10, fontWeight: 700 }}>{item.label}</p>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={startNav} disabled={!rd || loading} type="button" style={{ flex: 1, border: 'none', borderRadius: 20, padding: '15px 16px', background: rd && !loading ? 'linear-gradient(135deg,#00c2ff,#5b36ff)' : chipBg, color: '#fff', fontWeight: 950, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, cursor: rd && !loading ? 'pointer' : 'not-allowed', boxShadow: rd && !loading ? '0 14px 34px rgba(91,54,255,.32)' : 'none' }}>
                {navigationMode === 'car' ? <Car width={19} height={19} /> : navigationMode === 'motorcycle' ? <Bike width={19} height={19} /> : <Footprints width={19} height={19} />}
                Iniciar navegação 3D
              </button>

              {isMobile && destCoords && (
                <button onClick={() => openNativeNavigation(destCoords.lat, destCoords.lon, destName, navigationMode)} type="button" title="Abrir no Maps" style={{ width: 54, borderRadius: 20, border, background: chipBg, color: accent, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                  <ExternalLink width={18} height={18} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {nav && tracking && (
        <button onClick={pauseNav} type="button" style={{ position: 'absolute', left: 14, bottom: 18, zIndex: 24, height: 48, padding: '0 16px', borderRadius: 999, border: '1px solid rgba(239,68,68,.35)', background: isDark ? 'rgba(127,29,29,.75)' : 'rgba(254,226,226,.92)', color: isDark ? '#fecaca' : '#991b1b', fontWeight: 950, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 10px 30px rgba(0,0,0,.22)', cursor: 'pointer' }}>
          <Square width={16} height={16} fill="currentColor" /> Pausar
        </button>
      )}

      {nav && !tracking && !arrived && (
        <button onClick={startNav} type="button" style={{ position: 'absolute', left: 14, bottom: 18, zIndex: 24, height: 48, padding: '0 16px', borderRadius: 999, border: 'none', background: accent, color: '#fff', fontWeight: 950, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 10px 30px rgba(0,0,0,.22)', cursor: 'pointer' }}>
          <Navigation width={17} height={17} /> Retomar
        </button>
      )}

      {!nav && rd?.pts?.length > 1 && (
        <button onClick={() => fitRoute(rd.pts)} type="button" style={{ position: 'absolute', right: 14, bottom: 188, zIndex: 23, width: 48, height: 48, borderRadius: 999, border, background: panelBg, color: accent, display: 'grid', placeItems: 'center', boxShadow: '0 10px 30px rgba(0,0,0,.22)', cursor: 'pointer' }}>
          <Crosshair width={19} height={19} />
        </button>
      )}
    </div>
  );
};

export default WalkingMapModal;
