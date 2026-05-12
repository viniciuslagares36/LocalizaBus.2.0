// src/config/apiKeys.js
// Centraliza chaves públicas do front-end. Em produção, configure essas variáveis na Vercel.
// Observação: chaves usadas direto no navegador continuam públicas; restrinja por domínio no painel do provedor.

export const TOMTOM_API_KEY = import.meta.env.VITE_TOMTOM_API_KEY || '';

export const ORS_API_KEY = import.meta.env.VITE_ORS_API_KEY || '';

export const TRANSITLAND_API_KEY = import.meta.env.VITE_TRANSITLAND_API_KEY || '';
