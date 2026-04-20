import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css'; // Opcional se usar CDN do Tailwind, mas bom ter

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);