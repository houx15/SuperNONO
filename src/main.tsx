import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './ui/styles/tokens.css';
import './ui/styles/desktop.css';
import './ui/styles/app.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
