bool get canDownloadFiles => false;

Future<void> downloadTextFile(String fileName, String text, {String mimeType = 'application/json'}) async =>
    throw UnsupportedError('No file download outside the browser in this build');
