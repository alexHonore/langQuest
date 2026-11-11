{{flutter_js}}
{{flutter_build_config}}

// The splash from index.html sits under the Flutter view: it shows until the app paints its first frame, then is
// removed. Flutter's own service worker is not used (deprecated: it only unregisters itself); sw.js keeps the app
// usable offline instead (network first, so a redeploy shows on the next load).
const removeSplash = () => document.getElementById('splash')?.remove();

// Offline: register sw.js, then hand it the same-origin files this page loaded, so the next visit works without a
// network. Only in a secure context (https or localhost), and never in the way of the app if it fails.
const keepForOffline = async () => {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    const registration = await navigator.serviceWorker.register('sw.js');
    const urls = [location.href.split('#')[0], ...performance.getEntriesByType('resource').map((entry) => entry.name)];
    const send = (worker) => worker.postMessage({ type: 'precache', urls });
    if (registration.active) {
      send(registration.active);
    } else {
      const worker = registration.installing || registration.waiting;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'activated') send(worker);
      });
    }
  } catch (_) {
    // No offline support in this browser: the app works online as before.
  }
};

window.addEventListener(
  'flutter-first-frame',
  () => {
    removeSplash();
    // After the first frame the engine, fonts and content are loaded; wait a little for late assets.
    setTimeout(keepForOffline, 3000);
  },
  { once: true },
);

_flutter.loader.load({
  onEntrypointLoaded: async (engineInitializer) => {
    const appRunner = await engineInitializer.initializeEngine();
    await appRunner.runApp();
    setTimeout(removeSplash, 10000);
  },
});
