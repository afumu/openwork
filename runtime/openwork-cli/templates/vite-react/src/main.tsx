import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function App() {
  return (
    <main className="app-shell">
      <h1><%= appName %></h1>
      <p>Created with Open Work.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
