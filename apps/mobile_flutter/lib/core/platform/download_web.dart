import 'dart:js_interop';

import 'package:web/web.dart' as web;

bool get canDownloadFiles => true;

/// Hands [text] to the browser as a file download named [fileName].
Future<void> downloadTextFile(String fileName, String text, {String mimeType = 'application/json'}) async {
  final blob = web.Blob([text.toJS].toJS, web.BlobPropertyBag(type: mimeType));
  final url = web.URL.createObjectURL(blob);
  final anchor = web.HTMLAnchorElement()
    ..href = url
    ..download = fileName
    ..style.display = 'none';
  web.document.body?.append(anchor);
  anchor.click();
  anchor.remove();
  web.URL.revokeObjectURL(url);
}
