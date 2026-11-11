// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for French (`fr`).
class AppLocalizationsFr extends AppLocalizations {
  AppLocalizationsFr([String locale = 'fr']) : super(locale);

  @override
  String get appTitle => 'LangQuest';

  @override
  String get tabHome => 'Accueil';

  @override
  String get tabMissions => 'Missions';

  @override
  String get tabProgress => 'Progrès';

  @override
  String get back => 'Retour';

  @override
  String get close => 'Fermer';

  @override
  String get cancel => 'Annuler';

  @override
  String get next => 'Suivant';

  @override
  String get you => 'Vous';

  @override
  String get listen => 'Écouter';

  @override
  String get listenSlowly => 'Lentement';

  @override
  String get listenSlowlySemantics => 'Écouter lentement';

  @override
  String get syntheticVoice => 'Voix de synthèse';

  @override
  String stepOf(int step, int total) {
    return 'Étape $step sur $total';
  }

  @override
  String xpGain(int xp) {
    return '+$xp XP';
  }

  @override
  String languageName(String code) {
    String _temp0 = intl.Intl.selectLogic(code, {'en': 'anglais', 'fr': 'français', 'ru': 'russe', 'other': '$code'});
    return '$_temp0';
  }

  @override
  String fromLanguage(String code) {
    String _temp0 = intl.Intl.selectLogic(code, {
      'en': 'à partir de l’anglais',
      'fr': 'à partir du français',
      'ru': 'à partir du russe',
      'other': 'à partir de $code',
    });
    return '$_temp0';
  }

  @override
  String get notNativeReviewed => 'Pas encore relu par des locuteurs natifs';

  @override
  String get draftChapterNotice => 'Chapitre rédigé par IA, pas encore relu par des locuteurs natifs. Il peut contenir des erreurs.';

  @override
  String missionsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count missions', one: '1 mission');
    return '$_temp0';
  }

  @override
  String get settings => 'Réglages';

  @override
  String get switchCourse => 'Changer de cours';

  @override
  String get welcomeTitle => 'Apprenez une langue en la pratiquant';

  @override
  String get welcomeBody => 'De vraies situations et de vrais dialectes, enseignés avant d’être testés. Gratuit : sans abonnement, crédits ni paywall.';

  @override
  String get welcomeLanguageLabel => 'Application et explications en';

  @override
  String get welcomeContinue => 'Choisir un cours';

  @override
  String get pickCourseTitle => 'Que voulez-vous apprendre ?';

  @override
  String get pickCourseReady => 'Prêts à commencer';

  @override
  String get pickCourseNone => 'Aucun cours ne peut encore être enseigné à partir de cette langue.';

  @override
  String get seeAllCourses => 'Voir les 30 cours';

  @override
  String get courseIncludesTitle => 'Ce que ce cours comprend';

  @override
  String courseIncludesMissions(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count missions', one: '1 mission');
    return 'Parcours de missions ($_temp0)';
  }

  @override
  String get courseIncludesLearn => 'Avant chaque mission : une scène, des cartes de phrases et deux mini-jeux';

  @override
  String get courseIncludesReview => 'Révision espacée des phrases que vous utilisez';

  @override
  String get courseIncludesVoice => 'Répliques lues par la voix de synthèse du téléphone, quand il en a une pour cette langue';

  @override
  String get courseMissingTitle => 'Ce que ce cours n’a pas encore';

  @override
  String get courseMissingNativeReview => 'La relecture par des locuteurs natifs : le contenu est un brouillon rédigé par IA et peut contenir des erreurs';

  @override
  String get courseMissingConversation => 'La conversation en direct avec les personnages IA';

  @override
  String get courseMissingAudio => 'La bibliothèque audio';

  @override
  String get courseMissingPronunciation => 'Le retour oral sur la prononciation';

  @override
  String get courseMissingVoiceDialect => 'Une voix pour ce dialecte : les voix du téléphone parlent l’arabe standard moderne, qui n’est pas cette variété';

  @override
  String get courseLearnFrom => 'Apprendre à partir de';

  @override
  String get coursePlanned => 'Pas encore disponible. Prévu.';

  @override
  String get courseStart => 'Commencer ce cours';

  @override
  String get courseContinue => 'Continuer ce cours';

  @override
  String courseExplanationsIn(String language) {
    return 'Explications en $language';
  }

  @override
  String get homeNextMission => 'Prochaine mission';

  @override
  String homeNextStop(String stop) {
    return 'Ensuite : $stop';
  }

  @override
  String get homeChapterDone => 'Chapitre terminé';

  @override
  String get homeChapterDoneBody => 'Vous avez utilisé toutes les phrases de ce chapitre. La révision les garde vivantes.';

  @override
  String get homeReviewTitle => 'Révision';

  @override
  String reviewsDue(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count révisions à faire',
      one: '1 révision à faire',
      zero: 'Aucune révision à faire',
    );
    return '$_temp0';
  }

  @override
  String nextReviewAt(String when) {
    return 'Prochaine révision $when';
  }

  @override
  String streakDays(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count jours d’affilée', one: '1 jour d’affilée');
    return '$_temp0';
  }

  @override
  String get streakPaused => 'Série en pause. Reprenez quand vous voulez.';

  @override
  String get pathwayTitle => 'Votre parcours';

  @override
  String chapterLabel(int index) {
    return 'Chapitre $index';
  }

  @override
  String missionLabel(int index) {
    return 'Mission $index';
  }

  @override
  String missionLocked(String title) {
    return 'Terminez d’abord « $title »';
  }

  @override
  String get lockedSemantics => 'verrouillée';

  @override
  String get stopLearn => 'Apprendre';

  @override
  String get stopPractise => 'S’entraîner';

  @override
  String get stopMission => 'Mission';

  @override
  String get stopTalk => 'Parler';

  @override
  String stopsDoneSemantics(int done, int total) {
    return '$done étapes faites sur $total';
  }

  @override
  String pathLearnSubtitle(String name, int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count phrases', one: '1 phrase');
    return 'Une scène avec $name, puis $_temp0';
  }

  @override
  String get pathPractiseSubtitle => 'Associer les paires, construire une phrase';

  @override
  String get pathPractisePairsOnly => 'Associer les paires';

  @override
  String pathMissionSubtitle(int count, String name) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count échanges', one: '1 échange');
    return '$_temp0 avec $name';
  }

  @override
  String get pathComplete => 'Parcours de mission terminé';

  @override
  String pathStartStop(String stop) {
    return 'Commencer : $stop';
  }

  @override
  String pathContinueStop(String stop) {
    return 'Continuer : $stop';
  }

  @override
  String get pathDoneSemantics => 'fait';

  @override
  String get pathNextSemantics => 'à faire';

  @override
  String sceneTitle(String title) {
    return 'Apprendre · $title';
  }

  @override
  String get sceneYourLine => 'Votre réplique — dites-la à voix haute';

  @override
  String get sceneISaidIt => 'Je l’ai dit';

  @override
  String get sceneLearnPhrases => 'Apprendre les phrases';

  @override
  String speakingSemantics(String name) {
    return '$name parle';
  }

  @override
  String cardsTitle(String title) {
    return 'Nouvelles phrases · $title';
  }

  @override
  String get cardsNextPhrase => 'Phrase suivante';

  @override
  String get cardsPractise => 'S’entraîner';

  @override
  String get noteLabel => 'Remarque';

  @override
  String practiseTitle(String title) {
    return 'S’entraîner · $title';
  }

  @override
  String get pairsPrompt => 'Associez chaque phrase à son sens';

  @override
  String get pairsDone => 'Tout est associé !';

  @override
  String get pairsNextRound => 'Manche suivante';

  @override
  String get pairsBuildSentence => 'Construire une phrase';

  @override
  String matchedSemantics(String label) {
    return '$label, associé';
  }

  @override
  String get tilesPrompt => 'Construisez la phrase';

  @override
  String get tilesCheck => 'Vérifier';

  @override
  String get tilesWrong => 'Pas tout à fait — touchez un mot pour le retirer.';

  @override
  String tilesRemoveSemantics(String word) {
    return '$word, retirer';
  }

  @override
  String get startMission => 'Commencer la mission';

  @override
  String missionCue(String name) {
    return '$name dit';
  }

  @override
  String get missionWhatDoYouAnswer => 'Que répondez-vous ?';

  @override
  String missionHowDoYouSay(String meaning) {
    return 'Comment dit-on « $meaning » ?';
  }

  @override
  String get missionWrong => 'Pas tout à fait — pensez à ce que vous avez pratiqué.';

  @override
  String get missionSayIt => 'Dites-le à voix haute';

  @override
  String get missionRecapTitle => 'Ce que vous avez utilisé';

  @override
  String get missionComplete => 'Terminer la mission';

  @override
  String get missionCompleted => 'Mission accomplie !';

  @override
  String get missionXpOnce => 'Les XP d’une mission ne comptent qu’une fois ; cette reprise est de l’entraînement.';

  @override
  String missionJoinReview(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count phrases rejoignent votre révision', one: '1 phrase rejoint votre révision');
    return '$_temp0';
  }

  @override
  String get missionBackToPath => 'Retour au parcours de la mission';

  @override
  String get missionNext => 'Mission suivante';

  @override
  String get missionNotFound => 'Cette mission ne fait pas partie de votre cours actuel.';

  @override
  String get backHome => 'Retour à l’accueil';

  @override
  String get reviewTitle => 'Révision';

  @override
  String get reviewHowDoYouSay => 'Comment dit-on…';

  @override
  String get reviewSayThenShow => 'Dites-le à voix haute, puis affichez la réponse.';

  @override
  String get reviewShowAnswer => 'Voir la réponse';

  @override
  String get reviewAgain => 'À revoir';

  @override
  String get reviewHard => 'Difficile';

  @override
  String get reviewGood => 'Bien';

  @override
  String get reviewEasy => 'Facile';

  @override
  String reviewLeft(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: 'Encore $count', one: 'Encore 1');
    return '$_temp0';
  }

  @override
  String get reviewAllDone => 'Tout est à jour pour aujourd’hui.';

  @override
  String get reviewEmpty => 'Les phrases utilisées en mission reviennent ici, juste avant que vous ne les oubliiez.';

  @override
  String get progressTitle => 'Votre progression';

  @override
  String get xpLabel => 'XP';

  @override
  String get xpNote => 'Les XP mesurent votre pratique, pas votre niveau à l’oral.';

  @override
  String get streakTitle => 'Série';

  @override
  String get thisWeek => 'Cette semaine';

  @override
  String get missionsDoneTitle => 'Missions terminées';

  @override
  String countOfTotal(int done, int total) {
    return '$done sur $total';
  }

  @override
  String get phrasesTitle => 'Phrases';

  @override
  String get phrasesMet => 'Rencontrées en leçon';

  @override
  String get phrasesInReview => 'En révision';

  @override
  String get strengthLearning => 'En apprentissage';

  @override
  String get strengthYoung => 'En progrès';

  @override
  String get strengthSolid => 'Solides';

  @override
  String get strengthNote => 'D’après votre calendrier de révision — pas une note de votre oral.';

  @override
  String get progressEmpty => 'Commencez une mission pour voir votre progression ici.';

  @override
  String get freeTitle => 'Gratuit pour tous';

  @override
  String get freeBody => 'LangQuest n’a ni paywall, ni abonnement, ni crédits, ni compteur d’utilisation.';

  @override
  String get appLanguage => 'Langue de l’application';

  @override
  String get yourCourses => 'Vos cours';

  @override
  String get addCourse => 'Ajouter un cours';

  @override
  String get removeCourse => 'Retirer';

  @override
  String removeCourseTitle(String course) {
    return 'Retirer $course ?';
  }

  @override
  String get removeCourseBody => 'Sa progression et ses révisions sur cet appareil sont supprimées. Vos autres cours ne sont pas touchés.';

  @override
  String get yourData => 'Vos données';

  @override
  String get yourDataBody => 'Tout est enregistré sur cet appareil uniquement. Cette version n’a pas de compte.';

  @override
  String get resetAll => 'Tout réinitialiser';

  @override
  String get resetAllTitle => 'Tout réinitialiser ?';

  @override
  String get resetAllBody => 'Tous les cours, révisions, XP et appels de cet appareil sont supprimés.';

  @override
  String get resetConfirm => 'Réinitialiser';

  @override
  String get activeCourse => 'Actif';

  @override
  String get openSourceLicenses => 'Licences open source';

  @override
  String get catalogTitle => 'Cours';

  @override
  String get catalogSubtitle => '30 cours. De vrais dialectes. Gratuit.';

  @override
  String get catalogSearch => 'Rechercher une langue ou un dialecte';

  @override
  String get catalogReady => 'Prêt · brouillon';

  @override
  String get catalogPlanned => 'Prévu';

  @override
  String get catalogEnrolled => 'Inscrit';

  @override
  String catalogNoResults(String query) {
    return 'Aucun cours ne correspond à « $query »';
  }

  @override
  String get browseAllCourses => 'Parcourir les 30 cours';

  @override
  String get sceneCafe => 'Café';

  @override
  String get sceneStreet => 'Rue';

  @override
  String get sceneAirport => 'Aéroport';

  @override
  String get sceneMarket => 'Marché';

  @override
  String get sceneHome => 'Maison';

  @override
  String get sceneOffice => 'Bureau';

  @override
  String get sceneTransit => 'En route';

  @override
  String get sceneRestaurant => 'Restaurant';

  @override
  String get sceneGathering => 'Terrasse';

  @override
  String get sceneStation => 'Gare';

  @override
  String get scenePark => 'Parc';

  @override
  String get sceneClinic => 'Clinique';

  @override
  String get accountTitle => 'Compte';

  @override
  String get accountPitch =>
      'Enregistrez vos cours et vos missions terminées dans un compte, et reprenez où vous en étiez sur un autre appareil ou navigateur.';

  @override
  String get accountDeviceOnly =>
      'L’XP d’entraînement et vos révisions restent sur cet appareil : le serveur ne compte l’XP que pour les missions avec une prise de parole qu’il a évaluée, et les enregistrements faits ici ne quittent jamais cet appareil.';

  @override
  String get accountEmail => 'E-mail';

  @override
  String get accountPassword => 'Mot de passe';

  @override
  String get accountSignIn => 'Se connecter';

  @override
  String get accountCreate => 'Créer un compte';

  @override
  String get accountMissingFields => 'Saisissez votre e-mail et un mot de passe.';

  @override
  String get accountConfirmEmail => 'Vérifiez vos e-mails : le lien reçu confirme le compte et vous connecte ici.';

  @override
  String accountSignedInAs(String email) {
    return 'Connecté en tant que $email';
  }

  @override
  String get accountSaving => 'Enregistrement dans votre compte…';

  @override
  String get accountSaved => 'Vos cours et vos missions terminées sont enregistrés dans votre compte.';

  @override
  String get accountSyncFailed => 'Impossible de joindre votre compte. Votre progression reste sur cet appareil et sera enregistrée plus tard.';

  @override
  String get accountTryAgain => 'Réessayer';

  @override
  String accountNotSaved(String courses) {
    return 'Non enregistré dans votre compte : $courses. Une autre langue d’explication de ce cours y est déjà active.';
  }

  @override
  String get accountSignOut => 'Se déconnecter';

  @override
  String get yourDataBodyAccount =>
      'Vos cours et vos missions terminées sont aussi conservés dans votre compte. Tout le reste — XP d’entraînement, révisions, réglages — n’est enregistré que sur cet appareil.';

  @override
  String get yourDataBodySignedOut =>
      'Tout est enregistré uniquement sur cet appareil, sauf si vous vous connectez ci-dessus pour conserver vos cours et vos missions terminées dans un compte.';

  @override
  String get accountExport => 'Exporter mes données';

  @override
  String accountExported(String file) {
    return 'Enregistré : $file';
  }

  @override
  String get accountDelete => 'Supprimer mon compte';

  @override
  String get accountDeleteTitle => 'Supprimer votre compte ?';

  @override
  String get accountDeleteBody =>
      'Supprime définitivement votre compte, ainsi que les cours et la progression qui y sont enregistrés. Cette action est irréversible. La progression sur cet appareil reste jusqu’à ce que vous la réinitialisiez.';

  @override
  String accountDeleteType(String word) {
    return 'Tapez $word pour confirmer.';
  }

  @override
  String get accountDeleteWord => 'SUPPRIMER';

  @override
  String get accountDeleted => 'Votre compte a été supprimé.';

  @override
  String get accountDeleteScheduled => 'Votre compte sera supprimé sous 30 jours. Reconnectez-vous pour annuler.';

  @override
  String get recordYourself => 'Enregistrez-vous';

  @override
  String get recordStop => 'Arrêter';

  @override
  String get recordStopSemantics => 'Arrêter l’enregistrement';

  @override
  String get recordingNow => 'Enregistrement en cours';

  @override
  String get recordMyVoice => 'Ma voix';

  @override
  String get recordMyVoiceSemantics => 'Écouter votre enregistrement';

  @override
  String get recordStopPlayingSemantics => 'Arrêter la lecture de votre enregistrement';

  @override
  String get recordAgain => 'Recommencer';

  @override
  String get recordAgainSemantics => 'Enregistrer à nouveau';

  @override
  String get recordTryAgain => 'Réessayer';

  @override
  String get recordStaysOnDevice => 'Votre enregistrement reste sur cet appareil.';

  @override
  String recordCompare(String listen, String mine) {
    return 'Comparez : $listen, puis $mine.';
  }

  @override
  String get recordSilent => 'Je n’ai rien entendu. Vérifiez votre micro et réessayez.';

  @override
  String get recordBlocked => 'Le micro est bloqué. Autorisez-le pour ce site, puis réessayez.';

  @override
  String get recordNoMicrophone => 'Aucun micro trouvé.';

  @override
  String get recordFailed => 'L’enregistrement n’a pas fonctionné.';

  @override
  String get display => 'Affichage';

  @override
  String get themeDark => 'Sombre';

  @override
  String get themeLight => 'Clair';

  @override
  String get themeDevice => 'Appareil';

  @override
  String get textSize => 'Taille du texte';

  @override
  String get textSizeBody => 'En plus de la taille du texte de votre appareil.';

  @override
  String get reduceMotion => 'Réduire les animations';

  @override
  String get reduceMotionBody => 'Les scènes, Melo et les changements de page restent immobiles.';

  @override
  String get reduceMotionDevice => 'Activé dans les réglages de votre appareil.';

  @override
  String get showMascot => 'Afficher Melo, la mascotte';

  @override
  String get showMascotBody => 'Melo vous encourage ; le masquer ne masque rien d’autre.';

  @override
  String get textSmaller => 'Texte plus petit';

  @override
  String get textLarger => 'Texte plus grand';

  @override
  String textSizeValue(String percent) {
    return 'Taille du texte $percent';
  }

  @override
  String get forgotPassword => 'Mot de passe oublié ?';

  @override
  String get enterEmailFirst => 'Saisissez d’abord votre adresse e-mail.';

  @override
  String get passwordResetSent => 'Si un compte utilise cette adresse, un e-mail avec un lien pour choisir un nouveau mot de passe arrive.';

  @override
  String get emailConfirmed => 'Adresse e-mail confirmée. Vous êtes connecté à votre compte.';

  @override
  String get emailLinkFailed =>
      'Ce lien ne peut pas être utilisé : il a peut-être expiré, déjà servi, ou été ouvert dans un autre navigateur que celui qui l’a demandé. Demandez-en un nouveau dans les Réglages.';

  @override
  String get newPasswordTitle => 'Choisissez un nouveau mot de passe';

  @override
  String newPasswordBody(String email) {
    return 'Vous avez ouvert un lien de réinitialisation pour $email.';
  }

  @override
  String get newPasswordLabel => 'Nouveau mot de passe';

  @override
  String get newPasswordSave => 'Enregistrer';

  @override
  String get newPasswordFailed => 'Le mot de passe n’a pas pu être enregistré. Réessayez.';

  @override
  String get later => 'Plus tard';

  @override
  String get passwordChanged => 'Votre mot de passe a été modifié.';

  @override
  String get practiseSayingEntry => 'S’entraîner à dire les phrases';

  @override
  String practiseSayingTitle(String mission) {
    return 'S’entraîner à dire · $mission';
  }

  @override
  String get practiseSayingNote => 'Écoutez, enregistrez-vous, puis comparez. Pas de note : il faudrait un évaluateur de prononciation que ce cours n’a pas.';

  @override
  String get practiseSayingDone => 'Terminé';

  @override
  String get previousPhrase => 'Phrase précédente';

  @override
  String get warmupTitle => 'Essayez votre première phrase';

  @override
  String get warmupBody => 'Écoutez, puis dites-la à voix haute. Rien n’est noté ici.';

  @override
  String get warmupContinue => 'Commencer à apprendre';

  @override
  String get warmupBodyNoVoice => 'Dites-la à voix haute. Rien n’est noté ici.';

  @override
  String get recordChecked => 'LangQuest vérifie ce que vous avez dit ; l’enregistrement n’est pas conservé.';

  @override
  String get recordCheckedKept => 'LangQuest vérifie ce que vous avez dit ; les enregistrements sont conservés selon vos réglages de confidentialité.';

  @override
  String get recordChecking => 'Vérification de ce que vous avez dit…';

  @override
  String get recordCheckFailed => 'Impossible de vérifier cette prise.';

  @override
  String get verdictUnderstood => 'Compris !';

  @override
  String get verdictNotQuite => 'Pas tout à fait';

  @override
  String get verdictNotQuiteHint => 'Écoutez le modèle, puis réessayez.';

  @override
  String get verdictUnsure => 'Je n’ai pas bien compris';

  @override
  String get verdictUnsureHint => 'Réessayez, un peu plus près du micro.';

  @override
  String verdictHeard(String heard) {
    return 'J’ai entendu : « $heard »';
  }

  @override
  String missionSpokenSummary(int understood, int checked) {
    return 'Compris à l’oral : $understood sur $checked';
  }

  @override
  String get practiseSayingNoteChecked =>
      'Écoutez, enregistrez-vous : LangQuest vous dit si ce que vous avez dit a été compris, et Prononciation (IA) estime comment cela sonnait, mot par mot.';

  @override
  String get callIntroTitle => 'Entraînez-vous dans une vraie conversation';

  @override
  String get callIntroBody =>
      'Quelqu’un de cette mission décroche et vous parle dans la langue que vous apprenez. Répondez à voix haute, ou écrivez. Quand vous raccrochez, LangQuest vous dit comment ça s’est passé.';

  @override
  String get callIntroBodyText =>
      'Quelqu’un de cette mission discute avec vous dans la langue que vous apprenez. Quand vous terminez, LangQuest vous dit comment ça s’est passé.';

  @override
  String get callIntroNote => 'Utilise l’IA de LangQuest. Vos enregistrements ne sont pas conservés.';

  @override
  String get callIntroNoteKept => 'Utilise l’IA de LangQuest. Les enregistrements sont conservés selon vos réglages de confidentialité.';

  @override
  String get callStart => 'Appeler';

  @override
  String get callStartText => 'Commencer la discussion';

  @override
  String get callCalling => 'Appel en cours…';

  @override
  String get callFailedUnavailable => 'Les appels en direct ne sont pas encore disponibles pour ce cours.';

  @override
  String get callFailedNetwork => 'L’appel n’a pas abouti. Vérifiez votre connexion et réessayez.';

  @override
  String get callFailedEnded => 'Cet appel est terminé.';

  @override
  String get callTryAgain => 'Réessayer';

  @override
  String callSpeaking(String name) {
    return '$name parle';
  }

  @override
  String callThinking(String name) {
    return '$name réfléchit…';
  }

  @override
  String get callListening => 'Je vous écoute…';

  @override
  String get callYourTurnVoice => 'À vous : touchez le micro et répondez';

  @override
  String get callYourTurnText => 'À vous : écrivez votre réponse';

  @override
  String get callTalk => 'Parler';

  @override
  String get callSend => 'Envoyer';

  @override
  String get callCancelTake => 'Annuler';

  @override
  String get callType => 'Écrire plutôt';

  @override
  String get callTypeHint => 'Écrivez votre réponse…';

  @override
  String get callHangUp => 'Raccrocher';

  @override
  String get callEndChat => 'Terminer la discussion';

  @override
  String get callHint => 'Indice';

  @override
  String get callRepeat => 'Répéter';

  @override
  String get callSlower => 'Plus lentement';

  @override
  String get callTranslate => 'Traduire';

  @override
  String get callGoals => 'Objectifs';

  @override
  String callGoalDone(String goal) {
    return '$goal : fait';
  }

  @override
  String callGoalProbably(String goal) {
    return '$goal : sans doute fait';
  }

  @override
  String callGoalNotYet(String goal) {
    return '$goal : pas encore';
  }

  @override
  String get callNoSpeech => 'Je n’ai rien entendu. Réessayez, un peu plus près du micro.';

  @override
  String get callTurnFailed => 'Ça n’est pas passé. Réessayez.';

  @override
  String callSaidGoodbye(String name) {
    return '$name vous a dit au revoir. Raccrochez pour voir comment ça s’est passé.';
  }

  @override
  String get callEnding => 'On raccroche… LangQuest regarde comment ça s’est passé.';

  @override
  String get callEndedTitle => 'Appel terminé';

  @override
  String get callChatEndedTitle => 'Discussion terminée';

  @override
  String callGoalsMet(int met, int total) {
    return 'Objectifs atteints : $met sur $total';
  }

  @override
  String get callNextTime => 'La prochaine fois, essayez';

  @override
  String callYouSaid(String text) {
    return 'Vous avez dit : « $text »';
  }

  @override
  String get callNotEvaluated => 'LangQuest n’a pas pu évaluer cet appel : rien n’a été compté.';

  @override
  String get callAgain => 'Rappeler';

  @override
  String get callYou => 'Vous';

  @override
  String get callReplayLine => 'Réécouter cette réplique';

  @override
  String get callHeardYou => 'Écoute de votre réponse…';

  @override
  String get pathTalkSubtitle => 'Un appel en direct : utilisez ce que vous avez appris, à voix haute';

  @override
  String get pathTalkSubtitleText => 'Une discussion en direct : utilisez ce que vous avez appris';

  @override
  String get missionTryLiveCall => 'Essayez-le dans un appel en direct';

  @override
  String courseIncludesLiveCalls(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count personnages IA', one: 'le personnage IA du cours');
    return 'Des appels en direct avec $_temp0, à l’oral ou par écrit (avec un compte gratuit)';
  }

  @override
  String get courseIncludesSpokenCheck =>
      'Vos réponses orales vérifiées : LangQuest vous dit si vous avez été compris, et une IA estime votre prononciation mot par mot (avec un compte gratuit)';

  @override
  String get courseMissingPronunciationScore => 'Une note de prononciation mesurée : l’avis de l’IA est une estimation, pas une mesure acoustique';

  @override
  String get courseLimitedForDialect =>
      'La reconnaissance vocale et les voix IA restent limitées pour ce dialecte (pas encore relues par des locuteurs natifs)';

  @override
  String get listenAiVoiceSemantics => 'Écouter (voix IA)';

  @override
  String get listenSlowlyAiVoiceSemantics => 'Écouter lentement (voix IA)';

  @override
  String get tabAudio => 'Audio';

  @override
  String get audioLibraryTitle => 'Leçons audio';

  @override
  String get audioLibraryBody => 'Une par mission : la conversation, puis phrase par phrase avec le temps de dire chacune, puis la conversation à nouveau.';

  @override
  String get audioReadByAi => 'Lue par une voix IA';

  @override
  String get audioReadByDevice => 'Lue par la voix de votre appareil';

  @override
  String audioLessonMeta(int phrases, int minutes) {
    String _temp0 = intl.Intl.pluralLogic(phrases, locale: localeName, other: '$phrases phrases', one: '1 phrase');
    return '$_temp0 · environ $minutes min';
  }

  @override
  String get audioListened => 'Écoutée';

  @override
  String get audioLessonLabel => 'Leçon audio';

  @override
  String audioIntro(String mission) {
    return '$mission. Écoutez la conversation.';
  }

  @override
  String get audioPhrasesIntro => 'Maintenant, phrase par phrase. Écoutez, puis dites-la à voix haute.';

  @override
  String get audioAgainIntro => 'Encore une fois, toute la conversation.';

  @override
  String get audioOutro => 'C’est la fin de la leçon. Bravo !';

  @override
  String get audioSectionConversation => 'La conversation';

  @override
  String get audioSectionPhrases => 'Phrase par phrase';

  @override
  String get audioSectionAgain => 'Encore une fois';

  @override
  String get audioYourTurn => 'À vous : dites-la';

  @override
  String get audioPlay => 'Lecture';

  @override
  String get audioPause => 'Pause';

  @override
  String get audioNextLine => 'Réplique suivante';

  @override
  String get audioPreviousLine => 'Réplique précédente';

  @override
  String get audioSlowly => 'Lentement';

  @override
  String get audioTurns => 'Temps pour répéter';

  @override
  String get audioFinished => 'Leçon terminée';

  @override
  String get audioPlayAgain => 'Réécouter';

  @override
  String get audioYou => 'Vous';

  @override
  String courseIncludesAudioLessons(String voice) {
    return 'Des leçons audio tirées de chaque mission, lues par $voice';
  }

  @override
  String get courseVoiceAi => 'une voix IA (avec un compte gratuit)';

  @override
  String get courseVoiceDevice => 'la voix de votre appareil';

  @override
  String get courseMissingAudioRecorded => 'De l’audio enregistré par des locuteurs natifs';

  @override
  String get courseIncludesAiVoiceDialect => 'Une voix IA pour ce dialecte (avec un compte gratuit)';

  @override
  String get tabSpeak => 'Converser';

  @override
  String get speakTitle => 'Parlez avec les gens d’ici';

  @override
  String get speakBody =>
      'Des conversations libres avec les personnages du cours, à l’oral ou par écrit. Utilisez ce que vous avez appris ; demandez un indice quand vous en avez besoin.';

  @override
  String get speakNoCharacters => 'Aucun personnage n’est encore publié pour ce cours.';

  @override
  String speakCall(String name) {
    return 'Appeler $name';
  }

  @override
  String callFreeTitle(String name) {
    return 'Appeler $name';
  }

  @override
  String get callFreeBody =>
      'Une conversation libre, dans la langue que vous apprenez, sur la vie de tous les jours. Répondez à voix haute, ou écrivez. Quand vous raccrochez, LangQuest vous dit comment ça s’est passé.';

  @override
  String get callFreeBodyText =>
      'Une discussion libre, dans la langue que vous apprenez, sur la vie de tous les jours. Quand vous terminez, LangQuest vous dit comment ça s’est passé.';

  @override
  String get missionAnswerOutLoud => 'Répondez à voix haute';

  @override
  String get missionAnswerOutLoudHint => 'Dites votre réponse : LangQuest la vérifie. Ou choisissez-la ci-dessous.';

  @override
  String get missionAnsweredOutLoud => 'Répondu à voix haute';

  @override
  String get reviewSayItChecked => 'Dites-la à voix haute : LangQuest la vérifie, puis montre la réponse. Ou affichez-la vous-même.';

  @override
  String get reviewSuggested => 'suggéré';

  @override
  String get progressSpeakingTitle => 'À l’oral';

  @override
  String get progressUnderstood => 'Prises comprises (vérifiées par LangQuest)';

  @override
  String get progressCalls => 'Appels en direct';

  @override
  String progressCallsValue(int calls, int minutes) {
    return '$calls · $minutes min';
  }

  @override
  String get progressLessons => 'Leçons audio écoutées jusqu’au bout';

  @override
  String get progressCanDoTitle => 'Ce que vous savez faire';

  @override
  String get progressCanDoNote => 'Mesuré par LangQuest à partir de vos réponses à voix haute, de vos missions et de vos appels.';

  @override
  String get progressCanDoEmpty =>
      'Rien de mesuré pour l’instant. Répondez à voix haute dans une mission ou appelez un personnage : ce que vous savez faire apparaîtra ici.';

  @override
  String get progressCanDoFailed => 'Impossible de charger ce que vous savez faire.';

  @override
  String get masteryEmerging => 'En émergence';

  @override
  String get masteryPracticed => 'Pratiqué';

  @override
  String get masteryIndependent => 'Autonome';

  @override
  String get masteryDurable => 'Acquis durablement';

  @override
  String get masteryHintEmerging => 'Vous l’avez essayé avec de l’aide.';

  @override
  String get masteryHintPracticed => 'Vous y arrivez avec quelques indices.';

  @override
  String get masteryHintIndependent => 'Vous l’avez fait sans aide en conversation.';

  @override
  String get masteryHintDurable => 'Vous l’avez fait sans aide plusieurs fois, sur plusieurs semaines.';

  @override
  String progressEvidenceCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count observations', one: '1 observation');
    return '$_temp0';
  }

  @override
  String progressSkillLabel(String skill, String level, int step, String evidence) {
    return '$skill : $level, étape $step sur 4, $evidence';
  }

  @override
  String get progressHowMeasured => 'Comment c’est mesuré';

  @override
  String get progressHowMeasuredNote =>
      'Chaque niveau repose sur ce que LangQuest a observé, et sur la fréquence et la date des observations. Moins d’observations, moins de certitude. Les niveaux du CECR (A1, A2…) décrivent la compétence, pas votre niveau : ce n’est pas un certificat.';

  @override
  String get callNothingSaid => 'Vous avez raccroché avant de répondre : il n’y avait rien à évaluer. Rappelez quand vous voulez.';

  @override
  String get callPhrasesTitle => 'Des phrases qui peuvent servir';

  @override
  String get callPhrases => 'Phrases';

  @override
  String get speakRecentCalls => 'Appels récents';

  @override
  String speakRecordLabel(String name, String date, String duration) {
    return 'Appel avec $name, $date, $duration';
  }

  @override
  String speakRecordCorrections(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count corrections', one: '1 correction');
    return '$_temp0';
  }

  @override
  String get callRecordConversation => 'La conversation';

  @override
  String get callRecordYou => 'Vous';

  @override
  String get callRecordKept => 'Gardé sur cet appareil seulement. « Tout réinitialiser » le supprime.';

  @override
  String get callRecordDelete => 'Supprimer cet appel';

  @override
  String get callRecordDeleteTitle => 'Supprimer cet appel ?';

  @override
  String get callRecordDeleteBody => 'Sa transcription et ses corrections sont supprimées de cet appareil.';

  @override
  String get callRecordDeleteConfirm => 'Supprimer';

  @override
  String get callRecordMissing => 'Cet appel n’est plus sur cet appareil.';

  @override
  String pathTalkLocked(String name) {
    return 'Un appel en direct avec $name : avec un compte gratuit';
  }

  @override
  String get pathTalkLockedNoName => 'Un appel en direct : avec un compte gratuit';

  @override
  String get missionLiveCallAccount => 'Pratiquer en appel direct (compte gratuit)';

  @override
  String get callExplain => 'Expliquer';

  @override
  String get callExample => 'Exemple';

  @override
  String get callExplanation => 'Explication';

  @override
  String get micHelpTitle => 'Comment autoriser le micro';

  @override
  String get micHelpIos =>
      'Sur iPhone ou iPad (Safari) : touchez « aA » à gauche de l’adresse, puis Réglages du site web › Microphone › Autoriser. Si Safari ne demande jamais : Réglages de l’iPhone › Safari › Microphone › Demander. Puis touchez de nouveau Enregistrer.';

  @override
  String get micHelpAndroid =>
      'Sur Android (Chrome) : touchez l’icône à gauche de l’adresse (cadenas ou réglages), puis Autorisations › Micro › Autoriser. Puis touchez de nouveau Enregistrer.';

  @override
  String get micHelpDesktop =>
      'Sur un ordinateur : cliquez sur l’icône à gauche de l’adresse (cadenas ou réglages), mettez Micro sur Autoriser, puis réessayez.';

  @override
  String get callMicBlocked => 'Le micro est bloqué : vous pouvez écrire vos réponses. Autorisez-le pour parler.';

  @override
  String get pronunciationButton => 'Prononciation (IA)';

  @override
  String get pronunciationButtonSemantics => 'Obtenir l’avis de l’IA sur votre prononciation';

  @override
  String get pronunciationListening => 'L’IA de LangQuest écoute votre enregistrement…';

  @override
  String pronunciationScore(int score) {
    return '$score/100';
  }

  @override
  String get pronunciationNativeLike => 'Comme un natif';

  @override
  String get pronunciationClearAccent => 'Clair, avec un accent';

  @override
  String get pronunciationHard => 'Difficile à comprendre';

  @override
  String get pronunciationOffTarget => 'Ce n’était pas la phrase';

  @override
  String get pronunciationNoSpeech => 'Je n’ai rien entendu. Vérifiez votre micro et réessayez.';

  @override
  String get pronunciationWordGood => 'bien';

  @override
  String get pronunciationWordUnclear => 'pas clair';

  @override
  String get pronunciationWordToWork => 'à travailler';

  @override
  String get pronunciationWordMissing => 'manquant';

  @override
  String pronunciationWordLabel(String word, String status) {
    return '$word : $status';
  }

  @override
  String pronunciationSounds(String heard, String expected) {
    return 'Entendu /$heard/ · attendu /$expected/';
  }

  @override
  String get pronunciationNote => 'Une estimation de l’IA qui a écouté votre enregistrement, pas une mesure. Elle ne compte pas dans votre progression.';

  @override
  String get pronunciationFailed => 'Impossible d’obtenir l’avis sur la prononciation cette fois-ci.';

  @override
  String get readAloud => 'Lire à voix haute';

  @override
  String get readAloudSetting => 'Lire les exercices à voix haute';

  @override
  String get readAloudSettingBody =>
      'À chaque exercice : son contexte et sa question dans votre langue, puis la phrase avec la voix du cours. Connecté, une voix IA les lit.';
}
