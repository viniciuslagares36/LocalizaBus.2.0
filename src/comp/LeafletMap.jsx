import React, { useEffect, useMemo, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';

const BUS_ICON_URL = '/assets/bus-marker.svg';
const BUS_STOP_ICON_URL = '/assets/bus-stop-marker.svg';

const createIcon = (url, size = 28, anchorY = 28) =>
  L.icon({
    iconUrl: url,
    iconSize: [size, size],
    iconAnchor: [size / 2, anchorY],
    popupAnchor: [0, -anchorY],
  });

const busIcon = createIcon(BUS_ICON_URL, 20, 20);
const boardingStopIcon = createIcon(BUS_STOP_ICON_URL, 20, 20);
const nearbyStopIcon = createIcon(BUS_STOP_ICON_URL, 14, 14);

const fallbackBusIcon = L.divIcon({
  className: '',
  html: `
    <div style="
      width: 20px;
      height: 20px;
      border-radius: 999px;
      background: #2563eb;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 900;
      border: 2px solid white;
      box-shadow: 0 4px 12px rgba(0,0,0,.35);
    ">🚌</div>
  `,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const fallbackStopIcon = L.divIcon({
  className: '',
  html: `
    <div style="
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: #16a34a;
      border: 2px solid white;
      box-shadow: 0 3px 8px rgba(0,0,0,.25);
    "></div>
  `,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

const isValidCoord = (lat, lon) =>
  Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));

const getRoutePolylines = (routes = []) => {
  return routes
    .filter((route) => Array.isArray(route.routePoints) && route.routePoints.length > 1)
    .map((route) => ({
      id: route.id,
      line: route.line,
      points: route.routePoints
        .map(([lon, lat]) => [Number(lat), Number(lon)])
        .filter(([lat, lon]) => isValidCoord(lat, lon)),
    }))
    .filter((route) => route.points.length > 1);
};

const getStopsFromRoutes = (routes = []) => {
  const map = new Map();

  const addPassingRouteToStop = (key, route) => {
    const current = map.get(key);
    if (!current) return;

    const passingRoutes = current.passingRoutes || [];

    const alreadyExists = passingRoutes.some(
      (item) => item.id === route.id || item.line === route.line
    );

    if (!alreadyExists) {
      passingRoutes.push({
        id: route.id,
        line: route.line,
        vehicleNumber: route.realTimeGPS?.numero || '',
        etaMinutes: route.etaToNearestStopMinutes ?? route.time ?? null,
        fromStop: route.fromStop || route.nearestStopName || 'Parada próxima',
        toStop: route.toStop || route.destination || 'Destino',
        sentido: route.realTimeGPS?.sentido || route.sentido || null,
        isGpsOnly: route.isGpsOnly || false,
      });
    }

    map.set(key, {
      ...current,
      passingRoutes,
    });
  };

  routes.forEach((route) => {
    const nearbyStops = Array.isArray(route.nearbyStops) ? route.nearbyStops : [];

    nearbyStops.forEach((stop) => {
      if (isValidCoord(stop.lat, stop.lon)) {
        const key = `nearby_${stop.stopId || stop.id || stop.lat}_${stop.lon}`;

        if (!map.has(key)) {
          map.set(key, {
            id: key,
            name: stop.stopName || stop.name || 'Parada próxima',
            lat: Number(stop.lat),
            lon: Number(stop.lon),
            line: route.line,
            type: 'nearby',
            distanceKm: stop.distanceKm ?? null,
            passingRoutes: [],
          });
        }
      }
    });

    if (isValidCoord(route.nearestStopLat, route.nearestStopLon)) {
      const key = `boarding_${route.nearestStopLat}_${route.nearestStopLon}`;

      if (!map.has(key)) {
        map.set(key, {
          id: key,
          name: route.nearestStopName || route.fromStop || 'Parada de embarque',
          lat: Number(route.nearestStopLat),
          lon: Number(route.nearestStopLon),
          line: route.line,
          type: 'boarding',
          passingRoutes: [],
        });
      }

      addPassingRouteToStop(key, route);
    }
  });

  return Array.from(map.values());
};

function MapController({ center, markers, routeLines, userPosition, boardingStop }) {
  const map = useMap();
  const didInitialFitRef = useRef(false);

  useEffect(() => {
    if (didInitialFitRef.current) return;

    const boundsPoints = [];

    if (center?.length === 2) {
      boundsPoints.push([Number(center[1]), Number(center[0])]);
    }

    if (userPosition && isValidCoord(userPosition.lat, userPosition.lon)) {
      boundsPoints.push([Number(userPosition.lat), Number(userPosition.lon)]);
    }

    if (boardingStop && isValidCoord(boardingStop.lat, boardingStop.lon)) {
      boundsPoints.push([Number(boardingStop.lat), Number(boardingStop.lon)]);
    }

    markers.forEach((marker) => {
      if (isValidCoord(marker.lat, marker.lon)) {
        boundsPoints.push([Number(marker.lat), Number(marker.lon)]);
      }
    });

    routeLines.forEach((route) => {
      route.points.forEach((point) => boundsPoints.push(point));
    });

    if (boundsPoints.length >= 2) {
      map.fitBounds(boundsPoints, {
        padding: [35, 35],
        maxZoom: 16,
      });
    } else if (boundsPoints.length === 1) {
      map.setView(boundsPoints[0], 15);
    }

    didInitialFitRef.current = true;
  }, [center, markers, routeLines, userPosition, boardingStop, map]);

  return null;
}

export default function LeafletMap({
  center,
  markers = [],
  routes = [],
  userPosition = null,
  height = 430,
  isDark = false,
}) {
  const safeCenter = useMemo(() => {
    if (center?.length === 2 && isValidCoord(center[1], center[0])) {
      return [Number(center[1]), Number(center[0])];
    }

    const firstMarker = markers.find((marker) => isValidCoord(marker.lat, marker.lon));

    if (firstMarker) {
      return [Number(firstMarker.lat), Number(firstMarker.lon)];
    }

    return [-15.7939, -47.8828];
  }, [center, markers]);

  const routeLines = useMemo(() => getRoutePolylines(routes), [routes]);
  const routeStops = useMemo(() => getStopsFromRoutes(routes), [routes]);

  const boardingStop = useMemo(() => {
  const firstRouteWithStop = routes.find(
    (route) => isValidCoord(route.nearestStopLat, route.nearestStopLon)
  );

  if (!firstRouteWithStop) return null;

  return {
    lat: Number(firstRouteWithStop.nearestStopLat),
    lon: Number(firstRouteWithStop.nearestStopLon),
    name: firstRouteWithStop.nearestStopName || firstRouteWithStop.fromStop || 'Parada de embarque',
  };
}, [routes]);

  const visibleMarkers = useMemo(
    () =>
      markers
        .filter((marker) => isValidCoord(marker.lat, marker.lon))
        .slice(0, 8),
    [markers]
  );

  return (
    <div
      style={{
        height,
        width: '100%',
        borderRadius: 18,
        overflow: 'hidden',
        position: 'relative',
        background: isDark ? '#020617' : '#e5e7eb',
      }}
    >
      <MapContainer
        center={safeCenter}
        zoom={15}
        scrollWheelZoom
        style={{
          height: '100%',
          width: '100%',
        }}
      >
<TileLayer
  attribution='&copy; OpenStreetMap contributors'
  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
  className={isDark ? 'leaflet-dark-tiles' : ''}
/>
<MapController
  center={center}
  markers={visibleMarkers}
  routeLines={routeLines}
  userPosition={userPosition}
  boardingStop={boardingStop}
/>
       {userPosition && isValidCoord(userPosition.lat, userPosition.lon) && (
  <>
    <CircleMarker
      center={[Number(userPosition.lat), Number(userPosition.lon)]}
      radius={16}
      pathOptions={{
        color: '#22d3ee',
        fillColor: '#22d3ee',
        fillOpacity: 0.18,
        weight: 2,
        opacity: 0.85,
      }}
    />
    <CircleMarker
      center={[Number(userPosition.lat), Number(userPosition.lon)]}
      radius={8}
      pathOptions={{
        color: '#ffffff',
        fillColor: '#00e5ff',
        fillOpacity: 1,
        weight: 3,
        opacity: 1,
      }}
    >
      <Popup>
        <strong>Você está aqui</strong>
      </Popup>
    </CircleMarker>
  </>
)}

{userPosition &&
 boardingStop &&
 isValidCoord(userPosition.lat, userPosition.lon) &&
 isValidCoord(boardingStop.lat, boardingStop.lon) && (
  <Polyline
    positions={[
      [Number(userPosition.lat), Number(userPosition.lon)],
      [Number(boardingStop.lat), Number(boardingStop.lon)],
    ]}
    pathOptions={{
      color: '#00e5ff',
      weight: 4,
      opacity: 0.95,
      dashArray: '10 8',
    }}
  />
)}

        {routeLines.map((route) => (
          <Polyline
            key={`route_${route.id}`}
            positions={route.points}
            pathOptions={{
              weight: 5,
              opacity: 0.85,
            }}
          />
        ))}

{routeStops.map((stop) => {
  const isBoarding = stop.type === 'boarding';
  const passingRoutes = stop.passingRoutes || [];

  return (
    <Marker
      key={`stop_${stop.id}`}
      position={[stop.lat, stop.lon]}
      icon={isBoarding ? boardingStopIcon : nearbyStopIcon}
    >
      <Popup>
        <div style={{ minWidth: 230 }}>
          <strong>
            {isBoarding ? 'Parada de embarque' : 'Parada próxima'}
          </strong>

          <br />
          {stop.name}

          {stop.distanceKm != null ? (
            <>
              <br />
              <span>{Number(stop.distanceKm).toFixed(1)} km da origem</span>
            </>
          ) : null}

          <div style={{ marginTop: 10 }}>
            <strong>Ônibus previstos:</strong>

            {passingRoutes.length ? (
              <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
                {passingRoutes.map((route) => (
                  <div
                    key={`${stop.id}_${route.id}_${route.line}`}
                    style={{
                      padding: '7px 8px',
                      borderRadius: 10,
                      background: 'rgba(15, 23, 42, 0.75)',
                      border: '1px solid rgba(34, 211, 238, 0.22)',
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>
                      Linha {route.line}
                      {route.etaMinutes != null
                        ? ` • ${route.etaMinutes} min`
                        : ''}
                    </div>

                    <div style={{ fontSize: 11, opacity: 0.82 }}>
                      {route.fromStop} → {route.toStop}
                    </div>

                    {route.sentido ? (
                      <div style={{ fontSize: 11, opacity: 0.72 }}>
                        Sentido: {route.sentido}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                Nenhum ônibus previsto nesta busca.
              </div>
            )}
          </div>
        </div>
      </Popup>
    </Marker>
  );
})}
{visibleMarkers.map((marker, index) => (
{visibleMarkers.map((marker, index) => (
  <Marker
    key={marker.id || `bus_${index}`}
    position={[Number(marker.lat), Number(marker.lon)]}
    icon={busIcon || fallbackBusIcon}
  >
    <Popup>
      <div style={{ minWidth: 230 }}>
        <strong>Linha {marker.line || 'ônibus'}</strong>

        <br />

        {marker.itinerary ? (
          <span>{marker.itinerary}</span>
        ) : (
          <span>
            {marker.fromStop || 'Origem'} → {marker.toStop || 'Destino'}
          </span>
        )}

        <div style={{ marginTop: 10 }}>
          {marker.vehicleNumber ? (
            <>
              <strong>Veículo:</strong> {marker.vehicleNumber}
              <br />
            </>
          ) : null}

          {marker.etaMinutes != null ? (
            <>
              <strong>Passa na parada em:</strong> {marker.etaMinutes} min
              <br />
            </>
          ) : null}

          {marker.sentido ? (
            <>
              <strong>Sentido:</strong> {marker.sentido}
              <br />
            </>
          ) : null}

          <strong>Velocidade:</strong> {Math.round(marker.speed || 0)} km/h

          {marker.gpsUpdatedMinutes != null ? (
            <>
              <br />
              <span style={{ opacity: 0.72 }}>
                GPS atualizado há {marker.gpsUpdatedMinutes} min
              </span>
            </>
          ) : null}

          {marker.isGpsOnly ? (
            <>
              <br />
              <span style={{ opacity: 0.72 }}>
                Previsão estimada por GPS
              </span>
            </>
          ) : null}
        </div>
      </div>
    </Popup>
  </Marker>
))}
      </MapContainer>

      <div
        style={{
          position: 'absolute',
          left: 10,
          bottom: 10,
          zIndex: 500,
          background: isDark ? 'rgba(15,23,42,.88)' : 'rgba(255,255,255,.92)',
          color: isDark ? '#e5e7eb' : '#111827',
          borderRadius: 999,
          padding: '6px 10px',
          fontSize: 11,
          fontWeight: 800,
          boxShadow: '0 4px 14px rgba(0,0,0,.18)',
        }}
      >
        {visibleMarkers.length} ônibus ao vivo • {routeStops.length} paradas
      </div>
    </div>
  );
}