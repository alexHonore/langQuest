// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'LangQuest';

  @override
  String get tabHome => 'Home';

  @override
  String get tabMissions => 'Missions';

  @override
  String get tabProgress => 'Progress';

  @override
  String get back => 'Back';

  @override
  String get close => 'Close';

  @override
  String get cancel => 'Cancel';

  @override
  String get next => 'Next';

  @override
  String get you => 'You';

  @override
  String get listen => 'Listen';

  @override
  String get listenSlowly => 'Slowly';

  @override
  String get listenSlowlySemantics => 'Listen slowly';

  @override
  String get syntheticVoice => 'Synthetic voice';

  @override
  String stepOf(int step, int total) {
    return 'Step $step of $total';
  }

  @override
  String xpGain(int xp) {
    return '+$xp XP';
  }

  @override
  String languageName(String code) {
    String _temp0 = intl.Intl.selectLogic(code, {'en': 'English', 'fr': 'French', 'ru': 'Russian', 'other': '$code'});
    return '$_temp0';
  }

  @override
  String fromLanguage(String code) {
    String _temp0 = intl.Intl.selectLogic(code, {'en': 'from English', 'fr': 'from French', 'ru': 'from Russian', 'other': 'from $code'});
    return '$_temp0';
  }

  @override
  String get notNativeReviewed => 'Not yet reviewed by native speakers';

  @override
  String get draftChapterNotice => 'AI-drafted chapter, not yet reviewed by native speakers. It may contain mistakes.';

  @override
  String missionsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count missions', one: '1 mission');
    return '$_temp0';
  }

  @override
  String get settings => 'Settings';

  @override
  String get switchCourse => 'Switch course';

  @override
  String get welcomeTitle => 'Learn a language by using it';

  @override
  String get welcomeBody => 'Real situations and real dialects, taught before you are tested. Free: no subscriptions, credits or paywalls.';

  @override
  String get welcomeLanguageLabel => 'App and explanations in';

  @override
  String get welcomeContinue => 'Choose a course';

  @override
  String get pickCourseTitle => 'What do you want to learn?';

  @override
  String get pickCourseReady => 'Ready to start';

  @override
  String get pickCourseNone => 'No course can be taught from this language yet.';

  @override
  String get seeAllCourses => 'See all 30 courses';

  @override
  String get courseIncludesTitle => 'What this course includes';

  @override
  String courseIncludesMissions(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count missions', one: '1 mission');
    return 'Mission pathway ($_temp0)';
  }

  @override
  String get courseIncludesLearn => 'Before each mission: a scene, phrase cards and a practice session';

  @override
  String get courseIncludesReview => 'Spaced review of the phrases you use';

  @override
  String get courseIncludesVoice => 'Lines read by your phone\'s synthetic voice, when it has one for this language';

  @override
  String get courseMissingTitle => 'What this course does not have yet';

  @override
  String get courseMissingNativeReview => 'Native-speaker review: the content is an AI draft and may contain mistakes';

  @override
  String get courseMissingConversation => 'Live conversation with AI characters';

  @override
  String get courseMissingAudio => 'Audio library';

  @override
  String get courseMissingPronunciation => 'Spoken pronunciation feedback';

  @override
  String get courseMissingVoiceDialect => 'A voice for this dialect: phone voices speak Modern Standard Arabic, which is not this variety';

  @override
  String get courseLearnFrom => 'Learn from';

  @override
  String get coursePlanned => 'Not available yet. Planned.';

  @override
  String get courseStart => 'Start this course';

  @override
  String get courseContinue => 'Continue this course';

  @override
  String get courseLoading => 'Loading the course…';

  @override
  String get courseLoadFailed => 'This course could not be loaded. Check your connection and try again.';

  @override
  String get courseLoadRetry => 'Try again';

  @override
  String courseExplanationsIn(String language) {
    return 'Explanations in $language';
  }

  @override
  String get homeNextMission => 'Next mission';

  @override
  String homeNextStop(String stop) {
    return 'Next: $stop';
  }

  @override
  String get homeChapterDone => 'Chapter complete';

  @override
  String get homeChapterDoneBody => 'You have used every phrase of this chapter. Review keeps them alive.';

  @override
  String get homeReviewTitle => 'Review';

  @override
  String reviewsDue(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count reviews due', one: '1 review due', zero: 'No reviews due');
    return '$_temp0';
  }

  @override
  String nextReviewAt(String when) {
    return 'Next review $when';
  }

  @override
  String streakDays(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count days in a row', one: '1 day in a row');
    return '$_temp0';
  }

  @override
  String get streakPaused => 'Streak paused. Resume whenever you like.';

  @override
  String chapterLabel(int index) {
    return 'Chapter $index';
  }

  @override
  String missionLabel(int index) {
    return 'Mission $index';
  }

  @override
  String missionLocked(String title) {
    return 'Finish “$title” first';
  }

  @override
  String get lockedSemantics => 'locked';

  @override
  String get stopLearn => 'Learn';

  @override
  String get stopPractise => 'Practise';

  @override
  String get stopMission => 'Mission';

  @override
  String get stopTalk => 'Talk';

  @override
  String stopsDoneSemantics(int done, int total) {
    return '$done of $total steps done';
  }

  @override
  String pathLearnSubtitle(String name, int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count phrases', one: '1 phrase');
    return 'A scene with $name, then $_temp0';
  }

  @override
  String get pathPractiseSubtitle => 'Pairs, listening, sentences to build';

  @override
  String get pathPractisePairsOnly => 'Match the pairs';

  @override
  String pathMissionSubtitle(int count, String name) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count exchanges', one: '1 exchange');
    return '$_temp0 with $name';
  }

  @override
  String get pathComplete => 'Mission path complete';

  @override
  String pathStartStop(String stop) {
    return 'Start: $stop';
  }

  @override
  String pathContinueStop(String stop) {
    return 'Continue: $stop';
  }

  @override
  String get pathDoneSemantics => 'done';

  @override
  String get pathNextSemantics => 'next';

  @override
  String sceneTitle(String title) {
    return 'Learn · $title';
  }

  @override
  String get sceneYourLine => 'Your line — say it out loud';

  @override
  String get sceneISaidIt => 'I said it';

  @override
  String get sceneLearnPhrases => 'Learn the phrases';

  @override
  String speakingSemantics(String name) {
    return '$name is speaking';
  }

  @override
  String cardsTitle(String title) {
    return 'New phrases · $title';
  }

  @override
  String get cardsNextPhrase => 'Next phrase';

  @override
  String get cardsPractise => 'Practise';

  @override
  String get noteLabel => 'Note';

  @override
  String practiseTitle(String title) {
    return 'Practise · $title';
  }

  @override
  String get pairsPrompt => 'Match each phrase with its meaning';

  @override
  String get pairsDone => 'All matched!';

  @override
  String get pairsNextRound => 'Next round';

  @override
  String matchedSemantics(String label) {
    return '$label, matched';
  }

  @override
  String get tilesPrompt => 'Build the sentence';

  @override
  String get tilesCheck => 'Check';

  @override
  String get tilesWrong => 'Not quite — tap a word to take it back.';

  @override
  String tilesRemoveSemantics(String word) {
    return '$word, remove';
  }

  @override
  String get startMission => 'Start the mission';

  @override
  String missionCue(String name) {
    return '$name says';
  }

  @override
  String get missionWhatDoYouAnswer => 'What do you answer?';

  @override
  String missionHowDoYouSay(String meaning) {
    return 'How do you say “$meaning”?';
  }

  @override
  String get missionWrong => 'Not quite — think of what you practised.';

  @override
  String get missionSayIt => 'Say it out loud';

  @override
  String get missionRecapTitle => 'What you used';

  @override
  String get missionComplete => 'Complete the mission';

  @override
  String get missionCompleted => 'Mission completed!';

  @override
  String get missionXpOnce => 'XP for a mission counts once; this replay is practice.';

  @override
  String missionJoinReview(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count phrases join your review', one: '1 phrase joins your review');
    return '$_temp0';
  }

  @override
  String get missionBackToPath => 'Back to the mission path';

  @override
  String get missionNext => 'Next mission';

  @override
  String get missionNotFound => 'This mission is not part of your current course.';

  @override
  String get backHome => 'Back home';

  @override
  String get reviewTitle => 'Review';

  @override
  String get reviewHowDoYouSay => 'How do you say…';

  @override
  String get reviewSayThenShow => 'Say it out loud, then show the answer.';

  @override
  String get reviewShowAnswer => 'Show answer';

  @override
  String get reviewAgain => 'Again';

  @override
  String get reviewHard => 'Hard';

  @override
  String get reviewGood => 'Good';

  @override
  String get reviewEasy => 'Easy';

  @override
  String reviewLeft(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count left', one: '1 left');
    return '$_temp0';
  }

  @override
  String get reviewAllDone => 'All caught up for today.';

  @override
  String get reviewEmpty => 'Phrases you use in missions come back here, just before you would forget them.';

  @override
  String get progressTitle => 'Your progress';

  @override
  String get xpLabel => 'XP';

  @override
  String get xpNote => 'XP tracks how much you practise, not how well you speak.';

  @override
  String get streakTitle => 'Streak';

  @override
  String get thisWeek => 'This week';

  @override
  String get missionsDoneTitle => 'Missions completed';

  @override
  String countOfTotal(int done, int total) {
    return '$done of $total';
  }

  @override
  String get phrasesTitle => 'Phrases';

  @override
  String get phrasesMet => 'Met in lessons';

  @override
  String get phrasesInReview => 'In review';

  @override
  String get strengthLearning => 'Learning';

  @override
  String get strengthYoung => 'Getting there';

  @override
  String get strengthSolid => 'Solid';

  @override
  String get strengthNote => 'From your review schedule — not a score of your speech.';

  @override
  String get progressEmpty => 'Start a mission to see your progress here.';

  @override
  String get freeTitle => 'Free for every learner';

  @override
  String get freeBody => 'LangQuest has no paywalls, subscriptions, credits or usage meters.';

  @override
  String get appLanguage => 'App language';

  @override
  String get yourCourses => 'Your courses';

  @override
  String get addCourse => 'Add a course';

  @override
  String get removeCourse => 'Remove';

  @override
  String removeCourseTitle(String course) {
    return 'Remove $course?';
  }

  @override
  String get removeCourseBody => 'Its progress and reviews on this device are deleted. Your other courses are not touched.';

  @override
  String get yourData => 'Your data';

  @override
  String get yourDataBody => 'Everything is saved on this device only. There is no account in this version.';

  @override
  String get resetAll => 'Reset all progress';

  @override
  String get resetAllTitle => 'Reset all progress?';

  @override
  String get resetAllBody => 'All courses, reviews, XP and calls on this device are deleted.';

  @override
  String get resetConfirm => 'Reset';

  @override
  String get activeCourse => 'Active';

  @override
  String get openSourceLicenses => 'Open-source licenses';

  @override
  String get catalogTitle => 'Courses';

  @override
  String get catalogSubtitle => '30 courses. Real dialects. Free.';

  @override
  String get catalogSearch => 'Search languages and dialects';

  @override
  String get catalogReady => 'Ready · draft';

  @override
  String get catalogPlanned => 'Planned';

  @override
  String get catalogEnrolled => 'Enrolled';

  @override
  String catalogNoResults(String query) {
    return 'No course matches “$query”';
  }

  @override
  String get browseAllCourses => 'Browse all 30 courses';

  @override
  String get sceneCafe => 'Café';

  @override
  String get sceneStreet => 'Street';

  @override
  String get sceneAirport => 'Airport';

  @override
  String get sceneMarket => 'Market';

  @override
  String get sceneHome => 'Home';

  @override
  String get sceneOffice => 'Office';

  @override
  String get sceneTransit => 'On the move';

  @override
  String get sceneRestaurant => 'Restaurant';

  @override
  String get sceneGathering => 'Rooftop';

  @override
  String get sceneStation => 'Station';

  @override
  String get scenePark => 'Park';

  @override
  String get sceneClinic => 'Clinic';

  @override
  String get accountTitle => 'Account';

  @override
  String get accountPitch => 'Save your courses and completed missions to an account, and pick up where you left off on another device or browser.';

  @override
  String get accountDeviceOnly =>
      'Practice XP and your review schedule stay on this device: the server counts XP only for missions with a spoken attempt it has assessed, and recordings made here never leave this device.';

  @override
  String get accountEmail => 'Email';

  @override
  String get accountPassword => 'Password';

  @override
  String get accountSignIn => 'Sign in';

  @override
  String get accountCreate => 'Create account';

  @override
  String get accountMissingFields => 'Enter your email and a password.';

  @override
  String get accountConfirmEmail => 'Check your email: the link in it confirms the account and signs you in here.';

  @override
  String accountSignedInAs(String email) {
    return 'Signed in as $email';
  }

  @override
  String get accountSaving => 'Saving to your account…';

  @override
  String get accountSaved => 'Your courses and completed missions are saved to your account.';

  @override
  String get accountSyncFailed => 'Couldn’t reach your account. Your progress is safe on this device and will be saved later.';

  @override
  String get accountTryAgain => 'Try again';

  @override
  String accountNotSaved(String courses) {
    return 'Not saved to your account: $courses. Another instruction language of the same course is already active there.';
  }

  @override
  String get accountSignOut => 'Sign out';

  @override
  String get yourDataBodyAccount =>
      'Your courses and completed missions are also kept in your account. Everything else — practice XP, reviews, settings — is saved on this device only.';

  @override
  String get yourDataBodySignedOut =>
      'Everything is saved on this device only, unless you sign in above to keep your courses and completed missions in an account.';

  @override
  String get accountExport => 'Export my data';

  @override
  String accountExported(String file) {
    return 'Saved $file';
  }

  @override
  String get accountDelete => 'Delete my account';

  @override
  String get accountDeleteTitle => 'Delete your account?';

  @override
  String get accountDeleteBody =>
      'This permanently removes your account and the courses and progress saved in it. It cannot be undone. The progress on this device stays until you reset it.';

  @override
  String accountDeleteType(String word) {
    return 'Type $word to confirm.';
  }

  @override
  String get accountDeleteWord => 'DELETE';

  @override
  String get accountDeleted => 'Your account was deleted.';

  @override
  String get accountDeleteScheduled => 'Your account will be deleted within 30 days. Sign in again to cancel.';

  @override
  String get recordYourself => 'Record yourself';

  @override
  String get recordStop => 'Stop';

  @override
  String get recordStopSemantics => 'Stop recording';

  @override
  String get recordingNow => 'Recording';

  @override
  String get recordMyVoice => 'My voice';

  @override
  String get recordMyVoiceSemantics => 'Play your recording';

  @override
  String get recordStopPlayingSemantics => 'Stop playing your recording';

  @override
  String get recordAgain => 'Again';

  @override
  String get recordAgainSemantics => 'Record again';

  @override
  String get recordTryAgain => 'Try again';

  @override
  String get recordStaysOnDevice => 'Your recording stays on this device.';

  @override
  String recordCompare(String listen, String mine) {
    return 'Compare: $listen, then $mine.';
  }

  @override
  String get recordSilent => 'I didn’t hear anything. Check your microphone and try again.';

  @override
  String get recordBlocked => 'The microphone is blocked. Allow it for this site, then try again.';

  @override
  String get recordNoMicrophone => 'No microphone found.';

  @override
  String get recordFailed => 'Recording didn’t work.';

  @override
  String get display => 'Display';

  @override
  String get themeDark => 'Dark';

  @override
  String get themeLight => 'Light';

  @override
  String get themeDevice => 'Device';

  @override
  String get textSize => 'Text size';

  @override
  String get textSizeBody => 'On top of your device\'s text size.';

  @override
  String get reduceMotion => 'Reduce motion';

  @override
  String get reduceMotionBody => 'Scenes, Melo and page changes stay still.';

  @override
  String get reduceMotionDevice => 'On in your device\'s settings.';

  @override
  String get showMascot => 'Show Melo, the mascot';

  @override
  String get showMascotBody => 'Melo cheers you on; hiding it hides nothing else.';

  @override
  String get textSmaller => 'Smaller text';

  @override
  String get textLarger => 'Larger text';

  @override
  String textSizeValue(String percent) {
    return 'Text size $percent';
  }

  @override
  String get forgotPassword => 'Forgot password?';

  @override
  String get enterEmailFirst => 'Enter your email address first.';

  @override
  String get passwordResetSent => 'If an account uses this address, an email with a link to choose a new password is on its way.';

  @override
  String get emailConfirmed => 'Email confirmed. You\'re signed in.';

  @override
  String get emailLinkFailed =>
      'This email link can\'t be used: it may have expired, been used already, or been opened in another browser than the one that asked for it. Ask for a new one in Settings.';

  @override
  String get newPasswordTitle => 'Choose a new password';

  @override
  String newPasswordBody(String email) {
    return 'You opened a password reset link for $email.';
  }

  @override
  String get newPasswordLabel => 'New password';

  @override
  String get newPasswordSave => 'Save password';

  @override
  String get newPasswordFailed => 'The password could not be saved. Try again.';

  @override
  String get later => 'Later';

  @override
  String get passwordChanged => 'Your password was changed.';

  @override
  String get practiseSayingEntry => 'Practise saying the phrases';

  @override
  String practiseSayingTitle(String mission) {
    return 'Practise saying · $mission';
  }

  @override
  String get practiseSayingNote => 'Listen, record yourself, then compare. There is no score: a number needs a speech assessor this course does not have.';

  @override
  String get practiseSayingDone => 'Done';

  @override
  String get previousPhrase => 'Previous phrase';

  @override
  String get warmupTitle => 'Try your first phrase';

  @override
  String get warmupBody => 'Listen, then say it out loud. Nothing is scored here.';

  @override
  String get warmupContinue => 'Start learning';

  @override
  String get warmupBodyNoVoice => 'Say it out loud. Nothing is scored here.';

  @override
  String get recordChecked => 'LangQuest checks what you said; the recording isn’t kept.';

  @override
  String get recordCheckedKept => 'LangQuest checks what you said; recordings are kept as your privacy settings allow.';

  @override
  String get recordChecking => 'Checking what you said…';

  @override
  String get recordCheckFailed => 'Couldn’t check this take.';

  @override
  String get verdictUnderstood => 'Understood!';

  @override
  String get verdictNotQuite => 'Not quite';

  @override
  String get verdictNotQuiteHint => 'Listen to the model, then try again.';

  @override
  String get verdictUnsure => 'I couldn’t make that out';

  @override
  String get verdictUnsureHint => 'Try again, a little closer to the microphone.';

  @override
  String verdictHeard(String heard) {
    return 'I heard: “$heard”';
  }

  @override
  String missionSpokenSummary(int understood, int checked) {
    return 'Understood out loud: $understood of $checked';
  }

  @override
  String get practiseSayingNoteChecked =>
      'Listen, record yourself: LangQuest tells you whether what you said came across, and Pronunciation (AI) estimates how it sounded, word by word.';

  @override
  String get callIntroTitle => 'Practise it in a real conversation';

  @override
  String get callIntroBody =>
      'Someone from this mission picks up and talks with you in the language you’re learning. Answer out loud, or type. When you hang up, LangQuest tells you how it went.';

  @override
  String get callIntroBodyText =>
      'Someone from this mission chats with you in the language you’re learning. When you end the chat, LangQuest tells you how it went.';

  @override
  String get callIntroNote => 'Uses LangQuest’s AI. Your recordings aren’t kept.';

  @override
  String get callIntroNoteKept => 'Uses LangQuest’s AI. Recordings are kept as your privacy settings allow.';

  @override
  String get callStart => 'Call';

  @override
  String get callStartText => 'Start the chat';

  @override
  String get callCalling => 'Calling…';

  @override
  String get callFailedUnavailable => 'Live calls aren’t available for this course yet.';

  @override
  String get callFailedNetwork => 'The call didn’t go through. Check your connection and try again.';

  @override
  String get callFailedEnded => 'This call has ended.';

  @override
  String get callTryAgain => 'Try again';

  @override
  String callSpeaking(String name) {
    return '$name is speaking';
  }

  @override
  String callThinking(String name) {
    return '$name is thinking…';
  }

  @override
  String get callListening => 'Listening to you…';

  @override
  String get callYourTurnVoice => 'Your turn: tap the microphone and answer';

  @override
  String get callYourTurnText => 'Your turn: type your answer';

  @override
  String get callTalk => 'Talk';

  @override
  String get callSend => 'Send';

  @override
  String get callCancelTake => 'Cancel';

  @override
  String get callType => 'Type instead';

  @override
  String get callTypeHint => 'Write your answer…';

  @override
  String get callHangUp => 'Hang up';

  @override
  String get callEndChat => 'End the chat';

  @override
  String get callHint => 'Hint';

  @override
  String get callRepeat => 'Repeat';

  @override
  String get callSlower => 'Slower';

  @override
  String get callTranslate => 'Translate';

  @override
  String get callGoals => 'Goals';

  @override
  String callGoalDone(String goal) {
    return '$goal: done';
  }

  @override
  String callGoalProbably(String goal) {
    return '$goal: probably done';
  }

  @override
  String callGoalNotYet(String goal) {
    return '$goal: not yet';
  }

  @override
  String get callNoSpeech => 'I didn’t hear anything. Try again, a little closer to the microphone.';

  @override
  String get callTurnFailed => 'That didn’t go through. Try again.';

  @override
  String callSaidGoodbye(String name) {
    return '$name said goodbye. Hang up to see how it went.';
  }

  @override
  String get callEnding => 'Hanging up… LangQuest is looking at how it went.';

  @override
  String get callEndedTitle => 'Call ended';

  @override
  String get callChatEndedTitle => 'Chat ended';

  @override
  String callGoalsMet(int met, int total) {
    return 'Goals met: $met of $total';
  }

  @override
  String get callNextTime => 'Next time, try';

  @override
  String callYouSaid(String text) {
    return 'You said: “$text”';
  }

  @override
  String get callNotEvaluated => 'LangQuest couldn’t evaluate this call, so nothing was counted.';

  @override
  String get callAgain => 'Call again';

  @override
  String get callYou => 'You';

  @override
  String get callReplayLine => 'Play this line again';

  @override
  String get callHeardYou => 'Hearing you…';

  @override
  String get pathTalkSubtitle => 'A live call: use what you learned, out loud';

  @override
  String get pathTalkSubtitleText => 'A live chat: use what you learned';

  @override
  String get missionTryLiveCall => 'Try it in a live call';

  @override
  String courseIncludesLiveCalls(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count AI characters', one: 'the course’s AI character');
    return 'Live calls with $_temp0, by voice or in writing (with a free account)';
  }

  @override
  String get courseIncludesSpokenCheck =>
      'Your spoken answers checked: LangQuest tells you whether you were understood, and an AI estimates your pronunciation word by word (with a free account)';

  @override
  String get courseMissingPronunciationScore => 'A measured pronunciation score: the AI’s feedback is an estimate, not an acoustic measurement';

  @override
  String get courseLimitedForDialect => 'Speech recognition and AI voices are still limited for this dialect (not yet reviewed by native speakers)';

  @override
  String get listenAiVoiceSemantics => 'Listen (AI voice)';

  @override
  String get listenSlowlyAiVoiceSemantics => 'Listen slowly (AI voice)';

  @override
  String get tabAudio => 'Audio';

  @override
  String get audioLibraryTitle => 'Audio lessons';

  @override
  String get audioLibraryBody => 'Each lesson goes four ways: you listen, you repeat, you recall from memory, then you take your part in the conversation.';

  @override
  String get audioReadByAi => 'Read by an AI voice';

  @override
  String get audioReadByDevice => 'Read by your device’s voice';

  @override
  String audioLessonMeta(int phrases, int minutes) {
    String _temp0 = intl.Intl.pluralLogic(phrases, locale: localeName, other: '$phrases phrases', one: '1 phrase');
    return '$_temp0 · about $minutes min';
  }

  @override
  String get audioListened => 'Listened';

  @override
  String get audioLessonLabel => 'Audio lesson';

  @override
  String audioIntro(String mission) {
    return '$mission. Listen to the conversation.';
  }

  @override
  String get audioPhrasesIntro => 'Now phrase by phrase. Listen, then say it out loud.';

  @override
  String get audioOutro => 'That’s the end of the lesson. Well done!';

  @override
  String get audioSectionConversation => 'Listen';

  @override
  String get audioSectionPhrases => 'Repeat';

  @override
  String get audioYourTurn => 'Your turn: say it';

  @override
  String get audioPlay => 'Play';

  @override
  String get audioPause => 'Pause';

  @override
  String get audioNextLine => 'Next line';

  @override
  String get audioPreviousLine => 'Previous line';

  @override
  String get audioSlowly => 'Slowly';

  @override
  String get audioTurns => 'Time to repeat';

  @override
  String get audioFinished => 'Lesson finished';

  @override
  String get audioPlayAgain => 'Play again';

  @override
  String get audioYou => 'You';

  @override
  String courseIncludesAudioLessons(String voice) {
    return 'Audio lessons made from each mission, read by $voice';
  }

  @override
  String get courseVoiceAi => 'an AI voice (with a free account)';

  @override
  String get courseVoiceDevice => 'your device’s voice';

  @override
  String get courseMissingAudioRecorded => 'Audio recorded by native speakers';

  @override
  String get courseIncludesAiVoiceDialect => 'An AI voice for this dialect (with a free account)';

  @override
  String get tabSpeak => 'Speak';

  @override
  String get speakTitle => 'Talk with the locals';

  @override
  String get speakBody =>
      'Free conversations with the course’s characters, by voice or in writing. Use what you’ve learned; ask for a hint whenever you need one.';

  @override
  String get speakNoCharacters => 'No characters are published for this course yet.';

  @override
  String speakCall(String name) {
    return 'Call $name';
  }

  @override
  String callFreeTitle(String name) {
    return 'Call $name';
  }

  @override
  String get callFreeBody =>
      'A free conversation, in the language you’re learning, about everyday things. Answer out loud, or type. When you hang up, LangQuest tells you how it went.';

  @override
  String get callFreeBodyText => 'A free chat, in the language you’re learning, about everyday things. When you end it, LangQuest tells you how it went.';

  @override
  String get missionAnswerOutLoud => 'Answer out loud';

  @override
  String get missionAnswerOutLoudHint => 'Say your reply: LangQuest checks it. Or choose it below.';

  @override
  String get missionAnsweredOutLoud => 'Answered out loud';

  @override
  String get reviewSayItChecked => 'Say it out loud: LangQuest checks it, then shows the answer. Or show it yourself.';

  @override
  String get reviewSuggested => 'suggested';

  @override
  String get progressSpeakingTitle => 'Out loud';

  @override
  String get progressUnderstood => 'Takes understood (checked by LangQuest)';

  @override
  String get progressCalls => 'Live calls';

  @override
  String progressCallsValue(int calls, int minutes) {
    return '$calls · $minutes min';
  }

  @override
  String get progressLessons => 'Audio lessons heard to the end';

  @override
  String get progressCanDoTitle => 'What you can do';

  @override
  String get progressCanDoNote => 'Measured by LangQuest from your spoken answers, missions and live calls.';

  @override
  String get progressCanDoEmpty => 'Nothing measured yet. Answer out loud in a mission or call a character: what you can do appears here.';

  @override
  String get progressCanDoFailed => 'Couldn’t load what you can do.';

  @override
  String get masteryEmerging => 'Emerging';

  @override
  String get masteryPracticed => 'Practised';

  @override
  String get masteryIndependent => 'Independent';

  @override
  String get masteryDurable => 'Durable';

  @override
  String get masteryHintEmerging => 'You have tried it with help.';

  @override
  String get masteryHintPracticed => 'You can do it with occasional hints.';

  @override
  String get masteryHintIndependent => 'You did it on your own in conversation.';

  @override
  String get masteryHintDurable => 'You have done it on your own several times, over weeks.';

  @override
  String progressEvidenceCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count observations', one: '1 observation');
    return '$_temp0';
  }

  @override
  String progressSkillLabel(String skill, String level, int step, String evidence) {
    return '$skill: $level, step $step of 4, $evidence';
  }

  @override
  String get progressHowMeasured => 'How this is measured';

  @override
  String get progressHowMeasuredNote =>
      'Each level rests on what LangQuest observed, and on how often and how recently. Fewer observations means less certainty. CEFR bands (A1, A2…) describe the skill, not your level: this is not a certificate.';

  @override
  String get callNothingSaid => 'You hung up before answering, so there was nothing to evaluate. Call again when you’re ready.';

  @override
  String get callPhrasesTitle => 'Phrases you might need';

  @override
  String get callPhrases => 'Phrases';

  @override
  String get speakRecentCalls => 'Recent calls';

  @override
  String speakRecordLabel(String name, String date, String duration) {
    return 'Call with $name, $date, $duration';
  }

  @override
  String speakRecordCorrections(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count corrections', one: '1 correction');
    return '$_temp0';
  }

  @override
  String get callRecordConversation => 'The conversation';

  @override
  String get callRecordYou => 'You';

  @override
  String get callRecordKept => 'Kept on this device only. “Reset all progress” deletes it.';

  @override
  String get callRecordDelete => 'Delete this call';

  @override
  String get callRecordDeleteTitle => 'Delete this call?';

  @override
  String get callRecordDeleteBody => 'Its transcript and corrections are deleted from this device.';

  @override
  String get callRecordDeleteConfirm => 'Delete';

  @override
  String get callRecordMissing => 'This call is no longer on this device.';

  @override
  String pathTalkLocked(String name) {
    return 'A live call with $name: with a free account';
  }

  @override
  String get pathTalkLockedNoName => 'A live call: with a free account';

  @override
  String get missionLiveCallAccount => 'Practise it in a live call (free account)';

  @override
  String get callExplain => 'Explain';

  @override
  String get callExample => 'Example';

  @override
  String get callExplanation => 'Explanation';

  @override
  String get micHelpTitle => 'How to allow the microphone';

  @override
  String get micHelpIos =>
      'On iPhone or iPad (Safari): tap “aA” at the left of the address bar, then Website Settings › Microphone › Allow. If Safari never asks: iPhone Settings › Safari › Microphone › Ask. Then tap Record again.';

  @override
  String get micHelpAndroid =>
      'On Android (Chrome): tap the icon at the left of the address (padlock or sliders), then Permissions › Microphone › Allow. Then tap Record again.';

  @override
  String get micHelpDesktop => 'On a computer: click the icon at the left of the address (padlock or sliders), set Microphone to Allow, then try again.';

  @override
  String get callMicBlocked => 'The microphone is blocked, so you can write your answers. Allow it to speak.';

  @override
  String get pronunciationButton => 'Pronunciation (AI)';

  @override
  String get pronunciationButtonSemantics => 'Get AI feedback on your pronunciation';

  @override
  String get pronunciationListening => 'LangQuest’s AI is listening to your take…';

  @override
  String pronunciationScore(int score) {
    return '$score/100';
  }

  @override
  String get pronunciationNativeLike => 'Native-like';

  @override
  String get pronunciationClearAccent => 'Clear, with an accent';

  @override
  String get pronunciationHard => 'Hard to understand';

  @override
  String get pronunciationOffTarget => 'That wasn’t the phrase';

  @override
  String get pronunciationNoSpeech => 'I didn’t hear anything. Check your microphone and try again.';

  @override
  String get pronunciationWordGood => 'good';

  @override
  String get pronunciationWordUnclear => 'unclear';

  @override
  String get pronunciationWordToWork => 'to work on';

  @override
  String get pronunciationWordMissing => 'missing';

  @override
  String pronunciationWordLabel(String word, String status) {
    return '$word: $status';
  }

  @override
  String pronunciationSounds(String heard, String expected) {
    return 'Heard /$heard/ · expected /$expected/';
  }

  @override
  String get pronunciationNote => 'An AI’s estimate from listening to your take, not a measurement. It isn’t counted in your progress.';

  @override
  String get pronunciationFailed => 'Couldn’t get pronunciation feedback this time.';

  @override
  String get readAloud => 'Read aloud';

  @override
  String get readAloudSetting => 'Read exercises aloud';

  @override
  String get readAloudSettingBody =>
      'As each exercise appears: its context and question in your language, then the phrase in the course\'s voice. Signed in, an AI voice reads them.';

  @override
  String get realExamplesButton => 'Real examples';

  @override
  String get realExamplesButtonSemantics => 'Real examples of this phrase, from Tatoeba';

  @override
  String get realExamplesTitle => 'Real examples';

  @override
  String realExamplesIntro(String phrase) {
    return 'Sentences written by Tatoeba contributors that use “$phrase”.';
  }

  @override
  String realExamplesAttested(String phrase) {
    return '“$phrase” is itself a Tatoeba sentence: people really say it this way.';
  }

  @override
  String get realExamplesRecording => 'Native recording';

  @override
  String get realExamplesRecordingSemantics => 'Play a native speaker’s recording';

  @override
  String realExamplesBy(String id, String author) {
    return 'Tatoeba #$id by $author';
  }

  @override
  String realExamplesById(String id) {
    return 'Tatoeba #$id';
  }

  @override
  String realExamplesRecordingBy(String author, String license) {
    return 'Recording by $author · $license';
  }

  @override
  String get realExamplesRegion => 'Tatoeba doesn’t record which country a sentence comes from: an example may use another region’s wording.';

  @override
  String realExamplesCredit(String license, String date) {
    return 'From Tatoeba (tatoeba.org), sentences under $license, export of $date.';
  }

  @override
  String courseIncludesRealExamples(int attested, int total) {
    return '$attested of $total phrases found as written in Tatoeba, a collection of real sentences, with real examples to read';
  }

  @override
  String get recordSignInToCheck => 'Have LangQuest check what you said and how it sounded: create a free account';

  @override
  String get speakToContinue => 'Say it out loud to continue';

  @override
  String speakTryAgain(int tries, int max) {
    return 'Not quite yet: try again ($tries of $max)';
  }

  @override
  String get speakCantNow => 'Can’t speak now';

  @override
  String get speakCantNowDone => 'Speaking steps are paused for 15 minutes.';

  @override
  String get speakSignUpTitle => 'Call the people of this course';

  @override
  String get speakSignUpBody =>
      'Live calls with the course’s AI characters, by voice or in writing, with corrections after each call. Free: it only needs an account, so your calls and progress are kept.';

  @override
  String get speakSignUpButton => 'Create a free account to call';

  @override
  String get speakSignUpAlready => 'Already have one? Sign in';

  @override
  String get adminModelsEntry => 'AI models (admin)';

  @override
  String get adminModelsEntryBody => 'Which model does what, and change it';

  @override
  String get adminModelsTitle => 'AI models';

  @override
  String get adminModelsIntro =>
      'Each task the AI does, the model that does it (then its fallbacks, tried in order), and for which courses. A change is tested on the spot before it is saved, and takes effect within a minute.';

  @override
  String get adminModelsAllCourses => 'All courses';

  @override
  String get adminModelsDefault => 'built-in';

  @override
  String get adminModelsChanged => 'changed by an admin';

  @override
  String adminModelsFallbacks(String models) {
    return 'Then: $models';
  }

  @override
  String adminModelsVoice(String voice) {
    return 'Voice: $voice';
  }

  @override
  String get adminModelsChange => 'Change';

  @override
  String get adminModelsReadOnly => 'Not changeable here';

  @override
  String get adminModelsScope => 'For';

  @override
  String get adminModelsPrimary => 'Model';

  @override
  String get adminModelsFallbacksField => 'Fallbacks (comma-separated, in order)';

  @override
  String get adminModelsVoiceField => 'Voice';

  @override
  String get adminModelsVoiceDefault => 'The course’s default voice';

  @override
  String get adminModelsSave => 'Test and save';

  @override
  String get adminModelsSaved => 'Saved: tests passed.';

  @override
  String adminModelsFailed(String reason) {
    return 'Not saved: $reason';
  }

  @override
  String get adminModelsLoadFailed => 'Couldn’t load the models. Are you signed in as an admin?';

  @override
  String get adminTask_character_dialogue => 'Calls: what the character says';

  @override
  String get adminTask_learner_evaluation => 'Calls: the report after hanging up';

  @override
  String get adminTask_source_explanation => 'Calls: Translate, Hint, Explain, Example';

  @override
  String get adminTask_scene_planning => 'Calls: planning the scene';

  @override
  String get adminTask_meaning_assessment => 'Spoken answers: was the meaning understood?';

  @override
  String get adminTask_pronunciation_feedback => 'Pronunciation score (AI listening)';

  @override
  String get adminTask_speech_recognition => 'Speech to text (your takes, calls)';

  @override
  String get adminTask_speech_synthesis => 'Server AI voice (narrator, calls, lines without a bundled clip)';

  @override
  String get adminTask_language_quality_check => 'Checks each AI line is in the right language';

  @override
  String get adminTask_content_generation => 'Content factory: drafting course content';

  @override
  String get adminTask_transcription_alignment => 'Audio library: transcripts';

  @override
  String get adminTask_pronunciation_assessment => 'Acoustic pronunciation score (Azure, not set up)';

  @override
  String get adminTask_realtime_conversation => 'Voice calls pipeline (speech to text, dialogue, voice)';

  @override
  String get practiceListenPrompt => 'Listen. What does it mean?';

  @override
  String get practiceReadPrompt => 'What does it mean?';

  @override
  String get practiceReversePrompt => 'Which one says this?';

  @override
  String get practiceGapPrompt => 'Complete the sentence';

  @override
  String get practiceRight => 'That’s it!';

  @override
  String get practiceNext => 'Continue';

  @override
  String get practiceGapSemantics => 'missing word';

  @override
  String practiceWrongSemantics(String option) {
    return '$option, not this one';
  }

  @override
  String practiceRightSemantics(String option) {
    return '$option, right answer';
  }

  @override
  String get practiceHearPrompt => 'Listen. Which one did you hear?';

  @override
  String get practiceTrueFalsePrompt => 'Is this what it means?';

  @override
  String get practiceYes => 'Yes';

  @override
  String get practiceNo => 'No';

  @override
  String get practiceBuildByEarPrompt => 'Listen, then build what you heard';

  @override
  String get practiceTypePrompt => 'Write this phrase';

  @override
  String get practiceTypeHint => 'Type here';

  @override
  String get practiceShowAnswer => 'Show the answer';

  @override
  String get practiceWrong => 'Not quite';

  @override
  String get practiceComesBack => 'It comes back at the end.';

  @override
  String get practiceEarlier => 'From an earlier mission';

  @override
  String get practiceOnceMore => 'Once more';

  @override
  String get practiceAccents => 'Right. Mind the accents.';

  @override
  String get practiceTypo => 'Right, with one small slip: check the spelling.';

  @override
  String get practiceDoneTitle => 'Practice done';

  @override
  String get practiceDoneAllRight => 'Everything right the first time.';

  @override
  String practiceDoneScore(int right, int total) {
    return '$right of $total right the first time';
  }

  @override
  String get practiceRevisitTitle => 'Worth another look';

  @override
  String chapterProgress(int done, int total) {
    return '$done of $total missions done';
  }

  @override
  String get missionDone => 'Completed';

  @override
  String phrasesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count phrases', one: '1 phrase');
    return '$_temp0';
  }

  @override
  String missionOf(int index, int total) {
    return 'Mission $index of $total';
  }

  @override
  String get pathMoreWays => 'More ways to practise';

  @override
  String get pathAudioLesson => 'Audio lesson';

  @override
  String get pathPlayGames => 'Play the mini-games';

  @override
  String get literalLabel => 'Word for word';

  @override
  String get pronunciationLabel => 'Pronunciation';

  @override
  String get audioMixesTitle => 'Mixes';

  @override
  String get audioMixLabel => 'Mix';

  @override
  String get audioMixRecallTitle => 'Recall workout';

  @override
  String audioMixRecallBody(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count phrases you have learned, asked from memory',
      one: '1 phrase you have learned, asked from memory',
    );
    return '$_temp0';
  }

  @override
  String get audioMixConversationsTitle => 'Every conversation';

  @override
  String audioMixConversationsBody(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count conversations back to back, just to listen',
      one: '1 conversation, just to listen',
    );
    return '$_temp0';
  }

  @override
  String audioAboutMinutes(int minutes) {
    return 'About $minutes min';
  }

  @override
  String audioTimeLeft(int minutes) {
    return 'about $minutes min left';
  }

  @override
  String get audioSectionRecall => 'Recall';

  @override
  String get audioSectionRolePlay => 'Your part';

  @override
  String get audioRecallIntro => 'Now from memory. You hear a meaning: say the phrase before the voice does.';

  @override
  String get audioRolePlayIntro => 'Now take your part in the conversation. Say your lines out loud, then listen to check.';

  @override
  String audioSayCue(String meaning) {
    return 'Say: $meaning';
  }

  @override
  String get audioMixConversationsIntro => 'Every conversation of the course, one after the other. Just listen.';

  @override
  String get audioMixRecallIntro => 'From memory, the phrases you have learned. Say each one before the voice does.';

  @override
  String get audioYourTurnRecall => 'Your turn: say it from memory';

  @override
  String get gamesTitle => 'Mini-games';

  @override
  String gamesBody(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Another way to meet the $count phrases you have learned. Every mission adds more.',
      one: 'Another way to meet the phrase you have learned.',
    );
    return '$_temp0';
  }

  @override
  String homeGamesBody(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: 'Play with the $count phrases you know', one: 'Play with 1 phrase you know');
    return '$_temp0';
  }

  @override
  String get gamesNeedPhrases => 'The games are played with the phrases you have learned. Learn your first ones and they open.';

  @override
  String get gameMemoryName => 'Lantern pairs';

  @override
  String get gameMemoryPitch => 'Each phrase and its meaning hide under the lanterns. Find the pairs.';

  @override
  String get gameMemoryHint => 'Turn two lanterns: a phrase and its meaning stay lit.';

  @override
  String gameMemoryHidden(int index) {
    return 'Lantern $index, not turned';
  }

  @override
  String gameMemoryResult(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: 'All the pairs in $count moves', one: 'All the pairs in 1 move');
    return '$_temp0';
  }

  @override
  String gameMemoryDetail(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count phrases found with their meaning.',
      one: '1 phrase found with its meaning.',
    );
    return '$_temp0';
  }

  @override
  String gameMovesSemantics(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count moves', one: '1 move');
    return '$_temp0';
  }

  @override
  String get gameQuickName => 'Quick fire';

  @override
  String get gameQuickPitch => 'A phrase, a meaning: yes or no? As many as you can before time runs out.';

  @override
  String gameQuickRules(int seconds) {
    return 'You see a phrase and a meaning. Is it what the phrase means? Answer as many as you can in $seconds seconds. A wrong answer shows the right meaning.';
  }

  @override
  String gameQuickResult(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count right answers', one: '1 right answer', zero: 'No right answer this time');
    return '$_temp0';
  }

  @override
  String gameQuickDetail(int answered, int streak) {
    return 'Out of $answered answered. Longest run without a mistake: $streak.';
  }

  @override
  String gameQuickMeans(String meaning) {
    return 'It means: $meaning';
  }

  @override
  String gameRightSemantics(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count right answers', one: '1 right answer');
    return '$_temp0';
  }

  @override
  String gameSecondsLeft(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count seconds left', one: '1 second left');
    return '$_temp0';
  }

  @override
  String gameStreak(int count) {
    return '$count in a row';
  }

  @override
  String get gameEarName => 'By ear';

  @override
  String get gameEarPitch => 'A phrase is said. Find it among the written ones.';

  @override
  String gameEarResult(int right, int total) {
    return '$right of $total caught by ear';
  }

  @override
  String get gameDashName => 'Sentence dash';

  @override
  String get gameDashPitch => 'Put the words of each sentence back in order, against the clock.';

  @override
  String get gameDashRules =>
      'You get a meaning and the words of its sentence, mixed with one that does not belong. Put them in order. The clock runs until the last sentence is right.';

  @override
  String gameDashResult(int count, String time) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count sentences in $time', one: '1 sentence in $time');
    return '$_temp0';
  }

  @override
  String gameTimeSemantics(String time) {
    return 'Time: $time';
  }

  @override
  String gameBestMoves(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: 'Your record: $count moves', one: 'Your record: 1 move');
    return '$_temp0';
  }

  @override
  String gameBestRight(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: 'Your record: $count right answers', one: 'Your record: 1 right answer');
    return '$_temp0';
  }

  @override
  String gameBestTime(String time) {
    return 'Your record: $time';
  }

  @override
  String get gameStart => 'Start';

  @override
  String get gamePlayAgain => 'Play again';

  @override
  String get gameBackToGames => 'Back to the games';

  @override
  String get gameNewRecord => 'New record';

  @override
  String get courseIncludesGames => 'Mini-games with the phrases you have learned';

  @override
  String get tabPlay => 'Play';

  @override
  String get stopPlay => 'Play';

  @override
  String pathPlaySubtitle(String game) {
    return '$game, with this mission’s phrases';
  }

  @override
  String practicePlayNext(String game) {
    return 'Play: $game';
  }

  @override
  String get gameMissionDetail => 'Now use these phrases in the mission.';

  @override
  String get gamesEmptyTitle => 'Play with what you learn';

  @override
  String get gamesLearnFirst => 'Learn my first phrases';

  @override
  String get gamesInMissions => 'Each mission also has a round of its own, at its Play step.';
}
