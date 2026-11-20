import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/content/content_models.dart';
import 'package:langquest_mobile/core/content/speaker_forms.dart';
import 'package:langquest_mobile/core/services/learner_state.dart';

import 'support.dart';

void main() {
  test('older profiles use both scripts and course grammar, and explicit choices round-trip', () {
    final previous = LearnerState.fromJson({'v': 1});
    expect(previous.speakerForm, SpeakerForm.course);
    expect(previous.latinOnly, isFalse);
    final chosen = LearnerState.fromJson(previous.copyWith(latinOnly: true, speakerForm: SpeakerForm.feminine).toJson());
    expect(chosen.latinOnly, isTrue);
    expect(chosen.speakerForm, SpeakerForm.feminine);
    expect(LearnerState.fromJson({'v': 1, 'speakerForm': 'obsolete'}).speakerForm, SpeakerForm.course);
  });

  test('Darija personal agreement keeps the review id and its Latin reading, without playing the masculine clip', () {
    final female = forSpeaker(testBundle, SpeakerForm.feminine);
    final original = testBundle.mission('ary_meet_neighbour')!.expressions.singleWhere((e) => e.key == 'ana_ljar_jdid');
    final line = female.mission('ary_meet_neighbour')!.expressions.singleWhere((e) => e.id == original.id);
    expect(line.text, 'أنا الجارة الجديدة');
    expect(line.displayLabel(latinOnly: true), 'ana ljara jdida');
    expect(line.meaningIn('fr')!.meaning, 'Je suis la nouvelle voisine.');
    expect(female.referenceFor(line.id), isNull);
    expect(forSpeaker(testBundle, SpeakerForm.masculine).referenceFor(line.id), line.id);
    expect(testBundle.mission('ary_meet_neighbour')!.expressions.singleWhere((e) => e.id == line.id).text, 'أنا الجار الجديد');
  });

  test('French instructions agree even when the Darija greeting itself is the same for both speakers', () {
    for (final form in [SpeakerForm.masculine, SpeakerForm.feminine]) {
      final course = forSpeaker(testBundle, form);
      final line = course.mission('ary_greet_and_introduce')!.expressions.singleWhere((e) => e.text == 'متشرفين');
      expect(line.meaningIn('fr')!.meaning, form == SpeakerForm.feminine ? 'Enchantée.' : 'Enchanté.');
      expect(course.referenceFor(line.id), line.id);
    }
  });

  test('Egyptian dialogue uses the authored alternate recording and preserves the character and addressee', () {
    final female = forSpeaker(testBundle, SpeakerForm.feminine);
    final raw = testBundle.mission('arabic_egyptian_meet_neighbour')!;
    final mission = female.mission(raw.key)!;
    final before = raw.expressions.singleWhere((e) => e.slotId == 'new_neighbour');
    final after = mission.expressions.singleWhere((e) => e.id == before.id);
    final alternate = raw.expressions.singleWhere((e) => e.text == 'أنا جارتك الجديدة.');
    expect(after.text, alternate.text);
    expect(after.romanization, alternate.romanization);
    expect(female.referenceFor(after.id), alternate.id);
    expect(testBundle.voices.clipOf(alternate.id), isNotNull);
    final greeting = raw.expressions.firstWhere((e) => e.text.contains('يا جاري'));
    final addressed = mission.expressions.singleWhere((e) => e.id == greeting.id);
    expect(addressed.text, contains('يا جارتي'));
    expect(addressed.byLearner, isFalse);
    final toWoman = female.mission('arabic_egyptian_ask_directions')!.expressions.singleWhere((e) => e.text == 'شكراً ليكي، تسلمي');
    expect(female.referenceFor(toWoman.id), toWoman.id);
  });
}
