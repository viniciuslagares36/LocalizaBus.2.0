/*
  LocalizaBus — src/index.jsx
  Entrada do React. Só monta o App dentro do elemento root do index.html.
  Comentários feitos em linguagem simples para você conseguir mexer depois sem se perder.
*/

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
