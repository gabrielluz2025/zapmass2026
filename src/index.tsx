import './bootstrapAnalytics';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';
import './index.css';

const rootElement = document.getElementById('app-mount') ?? document.getElementById('root');
if (!rootElement) {
  throw new Error('Não foi encontrado #app-mount nem #root para montar a aplicação.');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);