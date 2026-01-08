import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  // StrictMode can sometimes cause double-initialization issues with Phaser in dev mode, 
  // but cleanup logic in PhaserGame handles it. Keeping it for best practices.
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
