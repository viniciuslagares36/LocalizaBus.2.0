/*
  LocalizaBus — src/comp/BadgeTempo.jsx
  Componente pequeno para mostrar tempo/estado visual nos cards sem repetir código em vários lugares.
  Comentários feitos em linguagem simples para você conseguir mexer depois sem se perder.
*/

// src/comp/BadgeTempo.jsx
// [TASK 2] Resiliência de estados: gps_active, SCHEDULED com tempo, coerção numérica
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── [TASK 2] Coerção segura: garante que `time` seja sempre Number ──────────
const toSafeNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};

// ─── [TASK 2] Lógica de estados corrigida ────────────────────────────────────
//  • gps_active === true  → estado LIVE (neon/synthwave com pulso cyan)
//  • gps_active === false && time > 0 → estado SCHEDULED (programado com tempo)
//  • gps_active === false && time === 0 → estado UNKNOWN (sem informação)
const getBadgeConfig = ({ gps_active, time: rawTime, modo }) => {
  const time = toSafeNumber(rawTime); // [TASK 2] coerção explícita para Number

  // GPS ativo — estilo Neon/Synthwave
  if (gps_active === true) {
    if (time <= 1) {
      // Ônibus iminente
      return {
        key: 'imminent',
        label: 'Agora!',
        timeLabel: null,
        containerClass:
          'border-2 border-red-400 bg-red-900/30 text-red-300 shadow-[0_0_8px_#f87171]',
        dotClass: 'bg-red-400',
        ping: true,
      };
    }
    // [TASK 2] GPS ativo → borda cyan com pulso (Neon/Synthwave)
    return {
      key: 'live',
      label: modo === 'metro' ? 'Metrô ao vivo' : 'GPS ao vivo',
      timeLabel: `${time} min`,
      containerClass:
        'border-2 border-cyan-400 bg-cyan-900/20 text-cyan-300 shadow-[0_0_10px_#22d3ee] animate-pulse',
      dotClass: 'bg-cyan-400',
      ping: true,
    };
  }

  // [TASK 2] GPS inativo mas com tempo > 0 → SCHEDULED ainda exibe o tempo
  if (time > 0) {
    return {
      key: 'scheduled',
      label: 'Programado',
      timeLabel: `${time} min`,
      containerClass:
        'border border-slate-500/60 bg-slate-800/40 text-slate-300',
      dotClass: 'bg-slate-400',
      ping: false,
    };
  }

  // Sem informação
  return {
    key: 'unknown',
    label: 'Sem dados',
    timeLabel: null,
    containerClass:
      'border border-gray-600/40 bg-gray-800/30 text-gray-500',
    dotClass: 'bg-gray-600',
    ping: false,
  };
};

// ─── COMPONENTE ───────────────────────────────────────────────────────────────
const BadgeTempo = ({ gps_active = false, time = 0, modo = 'onibus' }) => {
  const cfg = getBadgeConfig({ gps_active, time, modo });

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={cfg.key}
        initial={{ opacity: 0, scale: 0.88, y: 4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.88, y: -4 }}
        transition={{ duration: 0.18 }}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${cfg.containerClass}`}
      >
        {/* Dot com ping opcional */}
        <span className="relative flex h-2 w-2 flex-shrink-0">
          {cfg.ping && (
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-70 ${cfg.dotClass}`}
            />
          )}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${cfg.dotClass}`} />
        </span>

        <span>{cfg.label}</span>

        {cfg.timeLabel && (
          <span className="font-semibold opacity-80">• {cfg.timeLabel}</span>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

export default BadgeTempo;
