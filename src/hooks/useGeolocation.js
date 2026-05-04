// src/hooks/useGeolocation.js
// Hook de geolocalização com interpolação suave, anti memory-leak e throttle
import { useState, useEffect, useRef, useCallback } from 'react';

const SPEED_MS = 1.33;  // 4.8 km/h em m/s (caminhada média)
const LERP_ALPHA = 0.18;  // coeficiente de interpolação suave (0 = lento, 1 = instantâneo)
const THROTTLE_MS = 800;  // mínimo entre updates de estado (evita re-renders excessivos)

/** Interpola linearmente entre dois valores */
const lerp = (a, b, t) => a + (b - a) * t;

/** Haversine em metros */
const haversineM = (a, b) => {
  const R = 6371000;
  const dL = (b.lat - a.lat) * Math.PI / 180;
  const dO = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dL / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dO / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

/**
 * useGeolocation
 * @param {object} opts
 * @param {boolean} opts.enableHighAccuracy
 * @param {boolean} opts.smoothTransition  – ativa interpolação de posição
 * @param {number}  opts.maxAge
 * @param {number}  opts.timeout
 * @returns {{ location, accuracy, bearing, speed, error, supported }}
 */
export const useGeolocation = ({
  enableHighAccuracy = true,
  smoothTransition = true,
  maxAge = 800,
  // ✅ FIX: timeout reduzido para 8s; se GPS travar, onError é chamado logo
  // e o sistema não fica em loop de "Calculando rota..." infinito
  timeout = 8000,
} = {}) => {
  const [location, setLocation] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [bearing, setBearing] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [error, setError] = useState(null);

  const watchIdRef = useRef(null);
  const lastRawRef = useRef(null);   // última posição bruta
  const smoothPosRef = useRef(null);   // posição interpolada atual
  const rafRef = useRef(null);   // requestAnimationFrame id
  const lastEmitRef = useRef(0);      // timestamp do último setState (throttle)
  const mountedRef = useRef(true);

  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  // ── Calcula bearing entre dois pontos ──────────────────────────────────────
  const calcBearing = (prev, next) => {
    const dLon = (next.lon - prev.lon) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(next.lat * Math.PI / 180);
    const x = Math.cos(prev.lat * Math.PI / 180) * Math.sin(next.lat * Math.PI / 180)
      - Math.sin(prev.lat * Math.PI / 180) * Math.cos(next.lat * Math.PI / 180) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  };

  // ── Loop de animação para interpolação suave (RAF) ─────────────────────────
  const startLerpLoop = useCallback(() => {
    if (rafRef.current) return; // já rodando

    const tick = () => {
      if (!mountedRef.current) return;
      const raw = lastRawRef.current;
      const smooth = smoothPosRef.current;
      if (!raw || !smooth) { rafRef.current = requestAnimationFrame(tick); return; }

      // Interpola lat/lon
      const newLat = lerp(smooth.lat, raw.lat, LERP_ALPHA);
      const newLon = lerp(smooth.lon, raw.lon, LERP_ALPHA);
      smoothPosRef.current = { lat: newLat, lon: newLon };

      // Throttle do setState para max 1 vez a cada THROTTLE_MS ms
      const now = Date.now();
      if (now - lastEmitRef.current >= THROTTLE_MS) {
        lastEmitRef.current = now;
        setLocation({ lat: newLat, lon: newLon });
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Callback do watchPosition ──────────────────────────────────────────────
  const onSuccess = useCallback((pos) => {
    if (!mountedRef.current) return;
    const { latitude: lat, longitude: lon, accuracy: acc, speed: spd, heading } = pos.coords;
    const raw = { lat, lon };

    // Bearing: usa heading da API se disponível, senão calcula
    if (lastRawRef.current) {
      const b = (heading != null && !isNaN(heading))
        ? heading
        : calcBearing(lastRawRef.current, raw);
      setBearing(b);
    }

    setAccuracy(Math.round(acc));
    setSpeed(spd ?? SPEED_MS);
    setError(null);

    lastRawRef.current = raw;

    if (smoothTransition) {
      if (!smoothPosRef.current) smoothPosRef.current = raw; // bootstrap
      startLerpLoop();
    } else {
      // Sem interpolação: emite direto com throttle
      const now = Date.now();
      if (now - lastEmitRef.current >= THROTTLE_MS) {
        lastEmitRef.current = now;
        setLocation(raw);
      }
    }
  }, [smoothTransition, startLerpLoop]);

  const onError = useCallback((err) => {
    if (!mountedRef.current) return;
    const msgs = {
      1: 'Permissão de localização negada.',
      2: 'Posição indisponível. Verifique o GPS.',
      3: 'Tempo esgotado ao obter localização.',
    };
    setError(msgs[err.code] || `Erro de GPS (${err.code})`);
  }, []);

  // ── Inicializa e limpa o watchPosition ────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    if (!supported) { setError('Geolocalização não suportada neste dispositivo.'); return; }

    watchIdRef.current = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy,
      maximumAge: maxAge,
      timeout,
    });

    return () => {
      mountedRef.current = false;
      // ── ANTI MEMORY LEAK ──────────────────────────────────────────────────
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [enableHighAccuracy, maxAge, timeout, onSuccess, onError, supported]);

  return { location, accuracy, bearing, speed, error, supported };
};

export default useGeolocation;
