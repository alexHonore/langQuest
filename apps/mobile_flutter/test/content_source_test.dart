// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:langquest_mobile/core/content/content_bundle.dart';
import 'package:langquest_mobile/core/content/content_cache.dart';
import 'package:langquest_mobile/core/content/content_source.dart';
import 'package:langquest_mobile/core/services/app_state.dart';

import 'support.dart';

const base = 'https://bucket.test/storage/v1/object/public/langquest-content/';

/// A content bucket: [files] by object name; every request is logged; [offline] makes every request fail.
class FakeBucket {
  FakeBucket(this.files);

  final Map<String, String> files;
  final requests = <String>[];
  var offline = false;

  http.Client get client => MockClient((req) async {
    final name = req.url.toString().substring(base.length);
    requests.add(name);
    if (offline) throw http.ClientException('offline', req.url);
    final body = files[name];
    return body == null ? http.Response('{"error":"not_found"}', 404) : http.Response.bytes(utf8.encode(body), 200);
  });
}

String index(Map<String, String> files) => jsonEncode({'schemaVersion': 1, 'files': files});

void main() {
  group('the content bucket', () {
    test('a file is read under its name-by-content, then kept: it is not fetched again', () async {
      final bucket = FakeBucket({
        'index.json': index({'content/chapters/spanish-spain.json': 'content/chapters/spanish-spain.abcdef123456.json'}),
        'content/chapters/spanish-spain.abcdef123456.json': '{"x":"é"}',
      });
      final cache = MemoryContentCache();
      final source = ContentSource(location: ContentLocation(Uri.parse(base)), cache: cache, client: bucket.client);
      expect(await source.read('assets/content/chapters/spanish-spain.json'), '{"x":"é"}');
      expect(await source.read('assets/content/chapters/spanish-spain.json'), '{"x":"é"}');
      expect(bucket.requests, ['index.json', 'content/chapters/spanish-spain.abcdef123456.json'], reason: 'the second read is the kept copy');
      expect(cache.files.keys, containsAll(['index.json', 'content/chapters/spanish-spain.abcdef123456.json']));
    });

    test('offline, what was kept is read; what never was says so', () async {
      final bucket = FakeBucket({
        'index.json': index({
          'content/catalog.json': 'content/catalog.111111111111.json',
          'content/chapters/japanese.json': 'content/chapters/japanese.222222222222.json',
        }),
        'content/catalog.111111111111.json': '{"catalog":1}',
        'content/chapters/japanese.222222222222.json': '{"ja":1}',
      });
      final cache = MemoryContentCache();
      await ContentSource(location: ContentLocation(Uri.parse(base)), cache: cache, client: bucket.client).read('assets/content/catalog.json');

      bucket.offline = true;
      final later = ContentSource(location: ContentLocation(Uri.parse(base)), cache: cache, client: bucket.client);
      expect(await later.read('assets/content/catalog.json'), '{"catalog":1}', reason: 'the kept index and file');
      await expectLater(later.read('assets/content/chapters/japanese.json'), throwsA(isA<http.ClientException>()));
    });

    test('a copy without an index (the repository\'s own folder, served as is) is read under the same paths', () async {
      final bucket = FakeBucket({'content/catalog.json': '{"plain":true}'});
      final source = ContentSource(location: ContentLocation(Uri.parse(base)), cache: MemoryContentCache(), client: bucket.client);
      expect(await source.read('assets/content/catalog.json'), '{"plain":true}');
      expect(bucket.requests, ['index.json', 'content/catalog.json']);
    });

    test('a new release drops the copies it no longer names; a course left is forgotten, the others stay', () async {
      final cache = MemoryContentCache()
        ..files.addAll({
          'content/chapters/spanish-spain.000000000000.json': 'old',
          'content/chapters/spanish-spain.abcdef123456.json': 'es',
          'content/voices/spanish-spain.abcdef123456.json': 'es voices',
          'content/chapters/japanese.abcdef123456.json': 'ja',
          'content/chapters/spanish-spain-latin.abcdef123456.json': 'not this course',
        });
      final bucket = FakeBucket({
        'index.json': index({
          'content/chapters/spanish-spain.json': 'content/chapters/spanish-spain.abcdef123456.json',
          'content/voices/spanish-spain.json': 'content/voices/spanish-spain.abcdef123456.json',
          'content/chapters/japanese.json': 'content/chapters/japanese.abcdef123456.json',
          'content/chapters/spanish-spain-latin.json': 'content/chapters/spanish-spain-latin.abcdef123456.json',
        }),
      });
      final source = ContentSource(location: ContentLocation(Uri.parse(base)), cache: cache, client: bucket.client);
      await source.read('assets/content/chapters/japanese.json');
      await pumpEventQueue();
      expect(cache.files.keys, isNot(contains('content/chapters/spanish-spain.000000000000.json')));

      await source.forgetCourse('spanish-spain');
      expect(cache.files.keys.toSet(), {'index.json', 'content/chapters/japanese.abcdef123456.json', 'content/chapters/spanish-spain-latin.abcdef123456.json'});
    });

    test('clips are played from the bucket under their own names; an empty setting means the published bucket', () {
      final location = ContentLocation(Uri.parse('https://bucket.test/c'));
      expect(location.clip('assets/audio/lines/es-es-puck-1.mp3').toString(), 'https://bucket.test/c/audio/lines/es-es-puck-1.mp3');
      expect(location.clip('assets/audio/tatoeba/42.mp3').toString(), 'https://bucket.test/c/audio/tatoeba/42.mp3');
      expect(ContentLocation.parse('').base.toString(), defaultContentBaseUrl);
      expect(ContentLocation.parse(null).base.toString(), defaultContentBaseUrl);
    });
  });

  group('only what the learner selected', () {
    test('a course is read with its own voices; leaving it lets go of both, other courses stay', () async {
      Future<String> read(String path) async => File(path).readAsStringSync();
      final bundle = await ContentBundle.load(read, courses: {'spanish-spain', 'japanese'});
      expect(bundle.isLoaded('spanish-spain') && bundle.isLoaded('japanese'), isTrue);
      expect(bundle.isLoaded('german'), isFalse, reason: 'no other course is read');
      final es = bundle.course('spanish-spain', 'en')!.missions.first.expressions.first.id;
      final ja = bundle.course('japanese', 'en')!.missions.first.expressions.first.id;
      expect(bundle.voices.clipOf(es), isNotNull);
      expect(bundle.voices.clipOf(ja), isNotNull);

      final container = ProviderContainer(overrides: [...await testOverrides(content: bundle, read: read)]);
      addTearDown(container.dispose);
      final notifier = container.read(appStateProvider.notifier)
        ..enroll('spanish-spain', 'en')
        ..enroll('japanese', 'en');
      notifier.unenroll('spanish-spain|en');
      final content = container.read(appStateProvider).content;
      expect(content.isLoaded('spanish-spain'), isFalse, reason: 'the course left is out of memory');
      expect(content.voices.clipOf(es), isNull);
      expect(content.isLoaded('japanese'), isTrue);
      expect(content.voices.clipOf(ja), isNotNull);
    });
  });
}
