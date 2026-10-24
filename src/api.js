// window.api is injected by electron/preload.js
const missing = async () => {
  throw new Error('window.api not found. Start the app with `npm run dev` (Electron), not a plain browser.');
};
const stub = new Proxy({}, { get: () => new Proxy({}, { get: () => missing }) });
export const api = window.api || stub;
