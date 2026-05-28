import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import './global.css';
import App from './App';
import UiModeProvider from './UiModeProvider';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UiModeProvider>
      <App />
    </UiModeProvider>
  </React.StrictMode>
);
