{{flutter_js}}
{{flutter_build_config}}

// The splash from index.html sits under the Flutter view: it shows until the app paints its first frame, then is
// removed. No service worker: Flutter's is deprecated (it only unregisters itself), and the server sends
// `no-cache`, so a redeploy is picked up on the next load.
const removeSplash = () => document.getElementById('splash')?.remove();
window.addEventListener('flutter-first-frame', removeSplash, { once: true });

_flutter.loader.load({
  onEntrypointLoaded: async (engineInitializer) => {
    const appRunner = await engineInitializer.initializeEngine();
    await appRunner.runApp();
    setTimeout(removeSplash, 10000);
  },
});
