import 'package:web/web.dart' as web;

/// Shows [url] in the address bar without loading it (and without a history entry).
void replaceBrowserUrl(String url) => web.window.history.replaceState(null, '', url);
