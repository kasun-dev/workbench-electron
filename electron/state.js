// Tiny shared state for the main process (avoids circular requires)
module.exports = { mainWindow: null, quitting: false };
