/*
  LocalizaBus — src/config/apiKeys.js
  Central das chaves do front-end. Sempre pega valores de variáveis da Vercel/Vite para não deixar chave fixa espalhada nos componentes.
  Comentários feitos em linguagem simples para você conseguir mexer depois sem se perder.
*/

// src/config/apiKeys.js
// Centraliza chaves públicas do front-end. Em produção, configure essas variáveis na Vercel.
// Observação: chaves usadas direto no navegador continuam públicas; restrinja por domínio no painel do provedor.

export const TOMTOM_API_KEY = import.meta.env.VITE_TOMTOM_API_KEY || "";
export const ORS_API_KEY = import.meta.env.VITE_ORS_API_KEY || "";
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "";
export const TRANSITLAND_API_KEY = import.meta.env.VITE_TRANSITLAND_API_KEY || "";
export const DFTRANS_WORKER_URL = import.meta.env.VITE_DFTRANS_WORKER_URL || "";