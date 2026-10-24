import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import App from './App.jsx';
import Mini from './views/Mini.jsx';
import { StoreProvider } from './store.jsx';

// The floating timer window loads this same bundle with #mini
const isMini = window.location.hash === '#mini';
if (isMini) document.documentElement.classList.add('mini');

createRoot(document.getElementById('root')).render(
  isMini ? <Mini /> : (
    <StoreProvider>
      <App />
    </StoreProvider>
  )
);
