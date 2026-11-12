// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/content/content_bundle.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/core/services/learner_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('startup reads the catalog and the learner’s courses only; the others are known from the catalog', () async {
    final assets = DiskAssets();
    final bundle = await ContentBundle.load(assets, tracks: ['spanish-spain']);
    expect(assets.reads.where((k) => k.contains('/chapters/')), ['assets/content/chapters/spanish-spain.json']);
    expect(bundle.hasChaptersOf('spanish-spain'), isTrue);
    expect(bundle.hasChaptersOf('russian'), isFalse);
    // What the course list shows of a course whose chapters are not read yet.
    expect(bundle.sourcesFor('russian'), ['en', 'fr']);
    expect(bundle.isAvailable('russian', 'fr'), isTrue);
    expect(bundle.missionCountOf('russian', 'fr'), 7);
    expect(bundle.isDraftCourse('russian'), isTrue);
    expect(bundle.sourcesFor('english'), ['fr'], reason: 'English is taught from French (and Russian, not an interface language)');
    expect(bundle.availableFrom('fr').map((t) => t.id), contains('arabic-moroccan'));
    expect(bundle.availableFrom('en'), hasLength(29), reason: 'every course but English');
    // The same answers as with every course's chapters read.
    for (final t in testBundle.tracks) {
      expect(bundle.sourcesFor(t.id), testBundle.sourcesFor(t.id), reason: t.id);
      for (final s in testBundle.sourcesFor(t.id)) {
        expect(bundle.missionCountOf(t.id, s), testBundle.course(t.id, s)!.missions.length, reason: '${t.id} $s');
      }
    }
  });

  test('a course opened later is read once, joins the content, and the learner’s state stays as it was', () async {
    SharedPreferences.setMockInitialValues({});
    final assets = DiskAssets();
    final start = await ContentBundle.load(assets);
    final container = ProviderContainer(
      overrides: [
        initialContentProvider.overrideWithValue(start),
        assetBundleProvider.overrideWithValue(assets),
        learnerStoreProvider.overrideWithValue(LearnerStore(await SharedPreferences.getInstance())),
        clockProvider.overrideWithValue(() => testNow),
        deviceLanguageProvider.overrideWithValue('en'),
      ],
    );
    addTearDown(container.dispose);
    final app = container.read(appStateProvider.notifier);
    app.setUiLanguage('fr');
    expect(container.read(appStateProvider).content.hasChaptersOf('russian'), isFalse);

    // Two screens asking at once (the course page opening, then "Start this course") read the file once.
    await Future.wait([app.prepareCourse('russian'), app.prepareCourse('russian')]);
    expect(assets.reads.where((k) => k.endsWith('chapters/russian.json')), hasLength(1));
    await app.prepareCourse('russian');
    expect(assets.reads.where((k) => k.endsWith('chapters/russian.json')), hasLength(1), reason: 'already read');

    final state = container.read(appStateProvider);
    expect(state.content.hasChaptersOf('russian'), isTrue);
    expect(state.uiLanguage, 'fr', reason: 'the learner’s state is kept when content joins');
    expect(app.enroll('russian', 'fr'), isTrue);
    final course = container.read(appStateProvider).activeCourse!;
    expect(course.id, 'russian|fr');
    expect(course.missions, hasLength(7));
    expect(course.missions.first.titleIn('fr'), isNotEmpty);
  });

  test('a course without a chapters file is asked for once and stays without content', () async {
    final assets = DiskAssets();
    final container = ProviderContainer(
      overrides: [initialContentProvider.overrideWithValue(await ContentBundle.load(assets)), assetBundleProvider.overrideWithValue(assets)],
    );
    addTearDown(container.dispose);
    final library = container.read(contentBundleProvider.notifier);
    await library.ensureTrack('not-a-course');
    expect(assets.reads.where((k) => k.contains('not-a-course')), isEmpty, reason: 'unknown to the catalog');
  });
}
