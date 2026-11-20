/// Exact target phrases whose agreement depends on the learner. A reading pair follows the course's own transliteration.
class SpeakerPhrase {
  const SpeakerPhrase(this.masculine, this.feminine, {this.reading, this.sameSound = false});
  final String masculine;
  final String feminine;
  final (String, String)? reading;
  final bool sameSound;
}

const speakerPhrases = <String, List<SpeakerPhrase>>{
  "arabic-eastern": [
    SpeakerPhrase("منيح، الحمد لله. وإنت؟", "منيحة، الحمد لله. وإنت؟", reading: ("mni7, el-7amdulillah. w inte?", "mni7a, el-7amdulillah. w inte?")),
    SpeakerPhrase("أنا جاركم الجديد.", "أنا جارتكم الجديدة.", reading: ("ana jarkon el-jdid.", "ana jaretkon el-jdide.")),
    SpeakerPhrase("أنا ساكن هون من جديد.", "أنا ساكنة هون من جديد.", reading: ("ana sakin hon men jdid.", "ana sakne hon men jdid.")),
    SpeakerPhrase("للأسف مشغول يوم الجمعة.", "للأسف مشغولة يوم الجمعة.", reading: ("lal-asaf mashghul yom el-jem3a.", "lal-asaf mashghule yom el-jem3a.")),
    SpeakerPhrase(
      "إي، تعبان شوي، نمت بس خمس ساعات",
      "إي، تعبانة شوي، نمت بس خمس ساعات",
      reading: ("eh, ta3ban shway, nemt bas khams sa3at", "eh, ta3bane shway, nemt bas khams sa3at"),
    ),
    SpeakerPhrase(
      "أنا مبرمج، وطول النهار قاعد قدام الكمبيوتر",
      "أنا مبرمجة، وطول النهار قاعدة قدام الكمبيوتر",
      reading: ("ana mubarmej, w tul en-nhar 2a3ed 2eddam el-kombyuter", "ana mubarmje, w tul en-nhar 2a3de 2eddam el-kombyuter"),
    ),
    SpeakerPhrase("ميت من التعب", "ميتة من التعب", reading: ("mayyet min et-ta3ab", "mayte min et-ta3ab")),
    SpeakerPhrase(
      "أنا مبرمج، واشتغلت سنتين ببيروت",
      "أنا مبرمجة، واشتغلت سنتين ببيروت",
      reading: ("ana mubarmej, w eshtaghalt santein b-beirut", "ana mubarmje, w eshtaghalt santein b-beirut"),
    ),
    SpeakerPhrase(
      "أنا جديد بالشام، وين بتنصحني روح؟",
      "أنا جديدة بالشام، وين بتنصحني روح؟",
      reading: ("ana jdid bish-sham, wein btinsa7ni rou7?", "ana jdide bish-sham, wein btinsa7ni rou7?"),
    ),
    SpeakerPhrase("العادي منيح، مو مستعجل", "العادي منيح، مو مستعجلة", reading: ("el-3adi mni7, mu mista3jel", "el-3adi mni7, mu mista3jle")),
  ],
  "arabic-egyptian": [
    SpeakerPhrase("كويس، شكراً", "كويسة، شكراً", reading: ("kwayyes, shokran", "kwayyesa, shokran")),
    SpeakerPhrase("متشكر أوي", "متشكرة أوي", reading: ("mutashakker awi", "mutashakkera awi")),
    SpeakerPhrase("أنا عايز قهوة تركي من فضلك", "أنا عايزة قهوة تركي من فضلك", reading: ("ana 3ayez ahwa turki min fadlak", "ana 3ayza ahwa turki min fadlak")),
    SpeakerPhrase("أنا جارك الجديد.", "أنا جارتك الجديدة.", reading: ("ana gartak el-gedeed.", "ana gartak el-gedeeda.")),
    SpeakerPhrase("أنا تعبان ودايخ.", "أنا تعبانة ودايخة.", reading: ("ana ta3ban we dayekh.", "ana ta3bana we daykha.")),
    SpeakerPhrase("معلش، الخميس مش فاضي.", "معلش، الخميس مش فاضية.", reading: ("ma3lesh, el-khamees mish fadi.", "ma3lesh, el-khamees mish fadya.")),
    SpeakerPhrase("أنا مصمم جرافيك.", "أنا مصممة جرافيك.", reading: ("ana mosammem grafik.", "ana mosammema grafik.")),
    SpeakerPhrase(
      "باحب الكورة من وأنا صغير.",
      "باحب الكورة من وأنا صغيرة.",
      reading: ("ba7ebb el-kora min we ana soghayyar.", "ba7ebb el-kora min we ana soghayyara."),
    ),
  ],
  "arabic-moroccan": [
    SpeakerPhrase("أنا الجار الجديد", "أنا الجارة الجديدة", reading: ("ana ljar jdid", "ana ljara jdida")),
    SpeakerPhrase(
      "إيه، عيان شوية، نعست غير خمس سوايع",
      "إيه، عيانة شوية، نعست غير خمس سوايع",
      reading: ("iyeh, 3iyyan chwiya, n3est ghir khams swaye3", "iyeh, 3iyyana chwiya, n3est ghir khams swaye3"),
    ),
    SpeakerPhrase(
      "أنا مهندس، والريونيونات ما كيساليوش",
      "أنا مهندسة، والريونيونات ما كيساليوش",
      reading: ("ana mohandis, w rréunionat ma kaysaliwch", "ana mohandisa, w rréunionat ma kaysaliwch"),
    ),
    SpeakerPhrase("أنا مهلوك اليوم", "أنا مهلوكة اليوم", reading: ("ana mhlouk lyoum", "ana mhlouka lyoum")),
    SpeakerPhrase(
      "أنا مهندس، وخدمت جوج سنين فالرباط",
      "أنا مهندسة، وخدمت جوج سنين فالرباط",
      reading: ("ana mohandis, w khdemt jouj snin f rbat", "ana mohandisa, w khdemt jouj snin f rbat"),
    ),
    SpeakerPhrase(
      "أنا جديد فكازا. فين تنصحني نمشي؟",
      "أنا جديدة فكازا. فين تنصحني نمشي؟",
      reading: ("ana jdid f kaza. fin tnse7ni nemchi?", "ana jdida f kaza. fin tnse7ni nemchi?"),
    ),
    SpeakerPhrase("العادي مزيان، ما زربانش", "العادي مزيان، ما زرباناش", reading: ("l3adi mezyan, ma zerbanch", "l3adi mezyan, ma zerbanach")),
  ],
  "arabic-msa": [
    SpeakerPhrase("أنا جارك الجديد.", "أنا جارتك الجديدة.", reading: ("ana jaruka al-jadid.", "ana jaratuka al-jadida.")),
    SpeakerPhrase("أنا مصمم مواقع.", "أنا مصممة مواقع.", reading: ("ana musammim mawaqi3.", "ana musammimat mawaqi3.")),
  ],
  "french": [
    SpeakerPhrase("Enchanté !", "Enchantée !", sameSound: true),
    SpeakerPhrase("Je suis votre nouveau voisin.", "Je suis votre nouvelle voisine."),
    SpeakerPhrase("Désolé, une seule boule !", "Désolée, une seule boule !", sameSound: true),
    SpeakerPhrase("Désolé, samedi je ne peux pas.", "Désolée, samedi je ne peux pas.", sameSound: true),
    SpeakerPhrase("Ça va, mais je suis un peu fatigué.", "Ça va, mais je suis un peu fatiguée.", sameSound: true),
    SpeakerPhrase("Je suis crevé, mais ça va !", "Je suis crevée, mais ça va !", sameSound: true),
    SpeakerPhrase("Ravi de faire votre connaissance.", "Ravie de faire votre connaissance.", sameSound: true),
    SpeakerPhrase("Bonjour, je suis Sam, le nouveau graphiste.", "Bonjour, je suis Sam, la nouvelle graphiste."),
    SpeakerPhrase("Tu sais quoi ? Hier soir, je me suis perdu !", "Tu sais quoi ? Hier soir, je me suis perdue !", sameSound: true),
    SpeakerPhrase("Je suis arrivé de Londres il y a une heure.", "Je suis arrivée de Londres il y a une heure.", sameSound: true),
  ],
  "german": [SpeakerPhrase("Guten Tag! Ich bin Ihr neuer Nachbar.", "Guten Tag! Ich bin Ihre neue Nachbarin.")],
  "greek": [SpeakerPhrase("Είμαι ο νέος σας γείτονας.", "Είμαι η νέα σας γειτόνισσα.", reading: ("íme o néos sas gítonas.", "íme i néa sas gitónissa."))],
  "hebrew": [
    SpeakerPhrase("סגור, אני לוקח.", "סגור, אני לוקחת.", reading: ("sagur, ani lokeakh.", "sagur, ani lokakhat.")),
    SpeakerPhrase("שלום, אני השכן החדש.", "שלום, אני השכנה החדשה.", reading: ("shalom, ani ha-shakhen ha-khadash.", "shalom, ani ha-shkhena ha-khadasha.")),
    SpeakerPhrase("אני מדבר קצת עברית.", "אני מדברת קצת עברית.", reading: ("ani medaber ktsat ivrit.", "ani medaberet ktsat ivrit.")),
    SpeakerPhrase("גם אני אוהב שוקולד.", "גם אני אוהבת שוקולד.", reading: ("gam ani ohev shokolad.", "gam ani ohevet shokolad.")),
    SpeakerPhrase("אני רק מסתכל, תודה.", "אני רק מסתכלת, תודה.", reading: ("ani rak mistakel, toda.", "ani rak mistakelet, toda.")),
    SpeakerPhrase("אני ממש עייף היום.", "אני ממש עייפה היום.", reading: ("ani mamash ayef ha-yom.", "ani mamash ayefa ha-yom.")),
    SpeakerPhrase("לא נורא, אני לוקח אותה!", "לא נורא, אני לוקחת אותה!", reading: ("lo nora, ani lokeakh ota!", "lo nora, ani lokakhat ota!")),
  ],
  "hindi": [
    SpeakerPhrase("मैं आपका नया पड़ोसी हूँ।", "मैं आपकी नई पड़ोसन हूँ।", reading: ("main aapka naya padosi hoon.", "main aapki nayi padosan hoon.")),
    SpeakerPhrase(
      "मैं अभी यहाँ शिफ़्ट हुआ हूँ।",
      "मैं अभी यहाँ शिफ़्ट हुई हूँ।",
      reading: ("main abhi yahaan shift hua hoon.", "main abhi yahaan shift hui hoon."),
    ),
    SpeakerPhrase("बस देख रहा हूँ, शुक्रिया।", "बस देख रही हूँ, शुक्रिया।", reading: ("bas dekh raha hoon, shukriya.", "bas dekh rahi hoon, shukriya.")),
    SpeakerPhrase(
      "पहले योग करता हूँ, फिर मेट्रो से ऑफ़िस आता हूँ।",
      "पहले योग करती हूँ, फिर मेट्रो से ऑफ़िस आती हूँ।",
      reading: ("pahle yog karta hoon, phir metro se office aata hoon.", "pahle yog karti hoon, phir metro se office aati hoon."),
    ),
    SpeakerPhrase(
      "मैं एक बैंक में एनालिस्ट था।",
      "मैं एक बैंक में एनालिस्ट थी।",
      reading: ("main ek bank mein analyst tha.", "main ek bank mein analyst thi."),
    ),
    SpeakerPhrase(
      "शनिवार को अक्सर बैडमिंटन खेलता हूँ।",
      "शनिवार को अक्सर बैडमिंटन खेलती हूँ।",
      reading: ("shanivaar ko aksar badminton khelta hoon.", "shanivaar ko aksar badminton khelti hoon."),
    ),
    SpeakerPhrase(
      "कल दोपहर मैं सरोजिनी नगर गया था।",
      "कल दोपहर मैं सरोजिनी नगर गई थी।",
      reading: ("kal dopahar main sarojini nagar gaya tha.", "kal dopahar main sarojini nagar gayi thi."),
    ),
    SpeakerPhrase(
      "ठीक है, मैं यह फ़्लैट ले लूँगा।",
      "ठीक है, मैं यह फ़्लैट ले लूँगी।",
      reading: ("theek hai, main yah flat le loonga.", "theek hai, main yah flat le loongi."),
    ),
  ],
  "italian": [
    SpeakerPhrase("Buongiorno, sono il nuovo vicino.", "Buongiorno, sono la nuova vicina."),
    SpeakerPhrase("Mi sono appena trasferito qui.", "Mi sono appena trasferita qui."),
  ],
  "portuguese-brazilian": [
    SpeakerPhrase("Estou bem, obrigado!", "Estou bem, obrigada!"),
    SpeakerPhrase("Obrigado!", "Obrigada!"),
    SpeakerPhrase("Não, obrigado. Fica para a próxima.", "Não, obrigada. Fica para a próxima."),
    SpeakerPhrase("Muito obrigado!", "Muito obrigada!"),
    SpeakerPhrase("Oi, eu sou o novo vizinho.", "Oi, eu sou a nova vizinha."),
    SpeakerPhrase("Muito obrigado pelo convite!", "Muito obrigada pelo convite!"),
    SpeakerPhrase("Obrigado! Tenha um bom dia!", "Obrigada! Tenha um bom dia!"),
    SpeakerPhrase("Aqui está ótimo, obrigado.", "Aqui está ótimo, obrigada."),
    SpeakerPhrase("Só estou dando uma olhada, obrigado.", "Só estou dando uma olhada, obrigada."),
    SpeakerPhrase("Entendi. Muito obrigado pela ajuda!", "Entendi. Muito obrigada pela ajuda!"),
    SpeakerPhrase("Obrigado, Dona Lourdes! Ainda estou aprendendo.", "Obrigada, Dona Lourdes! Ainda estou aprendendo."),
    SpeakerPhrase("Tô cansado, acordei muito cedo hoje.", "Tô cansada, acordei muito cedo hoje."),
    SpeakerPhrase("Muito obrigado pela dica!", "Muito obrigada pela dica!"),
    SpeakerPhrase("Muito obrigado, você foi muito atenciosa.", "Muito obrigada, você foi muito atenciosa."),
    SpeakerPhrase("Obrigado, doutora. Até logo!", "Obrigada, doutora. Até logo!"),
    SpeakerPhrase("Muito obrigado, você me salvou!", "Muito obrigada, você me salvou!"),
  ],
  "portuguese-european": [
    SpeakerPhrase("Estou bem, obrigado.", "Estou bem, obrigada."),
    SpeakerPhrase("Estou bem, obrigado. E o senhor?", "Estou bem, obrigada. E o senhor?"),
    SpeakerPhrase("Obrigado, até logo!", "Obrigada, até logo!"),
    SpeakerPhrase("Sem açúcar, obrigado.", "Sem açúcar, obrigada."),
    SpeakerPhrase("Hoje não, obrigado.", "Hoje não, obrigada."),
    SpeakerPhrase("Muito obrigado!", "Muito obrigada!"),
    SpeakerPhrase("Sou o novo vizinho do terceiro andar.", "Sou a nova vizinha do terceiro andar."),
    SpeakerPhrase("Muito obrigado pela simpatia!", "Muito obrigada pela simpatia!"),
    SpeakerPhrase("Obrigado, boa tarde!", "Obrigada, boa tarde!"),
    SpeakerPhrase("Aqui está bem, obrigado.", "Aqui está bem, obrigada."),
    SpeakerPhrase("Estou só a ver, obrigado.", "Estou só a ver, obrigada."),
    SpeakerPhrase("Ao fundo da rua. Percebi, obrigado!", "Ao fundo da rua. Percebi, obrigada!"),
    SpeakerPhrase("Obrigado, o senhor é muito simpático.", "Obrigada, o senhor é muito simpático."),
    SpeakerPhrase("Sou engenheiro informático e trabalhava em Londres.", "Sou engenheira informático e trabalhava em Londres."),
    SpeakerPhrase("Muito obrigado pela sugestão!", "Muito obrigada pela sugestão!"),
    SpeakerPhrase("Obrigado, foi muito amável.", "Obrigada, foi muito amável."),
    SpeakerPhrase("Muito obrigado, senhor doutor.", "Muito obrigada, senhor doutor."),
    SpeakerPhrase("Muito obrigado, foi uma grande ajuda.", "Muito obrigada, foi uma grande ajuda."),
  ],
  "romanian": [
    SpeakerPhrase("Încântat de cunoștință!", "Încântată de cunoștință!"),
    SpeakerPhrase("Sunt noul dumneavoastră vecin.", "Sunt noua dumneavoastră vecină."),
  ],
  "russian": [
    SpeakerPhrase(
      "Я хотел бы капучино, пожалуйста.",
      "Я хотела бы капучино, пожалуйста.",
      reading: ("Ya khotel by kapuchino, pozhaluysta.", "Ya khotela by kapuchino, pozhaluysta."),
    ),
    SpeakerPhrase("Я ваш новый сосед.", "Я ваша новая соседка.", reading: ("Ya vash novyy sosed.", "Ya vasha novaya sosedka.")),
    SpeakerPhrase("Я недавно переехал сюда.", "Я недавно переехала сюда.", reading: ("Ya nedavno pereekhal syuda.", "Ya nedavno pereekhala syuda.")),
    SpeakerPhrase(
      "Да! Я заблудился в переулках у Китай-города.",
      "Да! Я заблудилась в переулках у Китай-города.",
      reading: ("Da! Ya zabludilsya v pereulkakh u Kitay-goroda.", "Da! Ya zabludilas v pereulkakh u Kitay-goroda."),
    ),
    SpeakerPhrase(
      "Я заблудился в переулках у Китай-города.",
      "Я заблудилась в переулках у Китай-города.",
      reading: ("Ya zabludilsya v pereulkakh u Kitay-goroda.", "Ya zabludilas v pereulkakh u Kitay-goroda."),
    ),
  ],
  "spanish-latin-american": [SpeakerPhrase("Soy su nuevo vecino.", "Soy su nueva vecina.")],
  "spanish-spain": [SpeakerPhrase("Encantado.", "Encantada."), SpeakerPhrase("Soy el nuevo vecino.", "Soy la nueva vecina.")],
  "ukrainian": [
    SpeakerPhrase("Я хотів би каву, будь ласка.", "Я хотіла б каву, будь ласка.", reading: ("Ya khotiv by kavu, bud laska.", "Ya khotila b kavu, bud laska.")),
    SpeakerPhrase("Я ваш новий сусід.", "Я ваша нова сусідка.", reading: ("Ya vash novyi susid.", "Ya vasha nova susidka.")),
    SpeakerPhrase("Я нещодавно тут оселився.", "Я нещодавно тут оселилася.", reading: ("Ya neshchodavno tut oselyvsia.", "Ya neshchodavno tut oselylasia.")),
    SpeakerPhrase(
      "Так! Я заблукав у вуличках старого міста.",
      "Так! Я заблукала у вуличках старого міста.",
      reading: ("Tak! Ya zablukav u vulychkakh staroho mista.", "Tak! Ya zablukala u vulychkakh staroho mista."),
    ),
    SpeakerPhrase(
      "Я заблукав у вуличках старого міста.",
      "Я заблукала у вуличках старого міста.",
      reading: ("Ya zablukav u vulychkakh staroho mista.", "Ya zablukala u vulychkakh staroho mista."),
    ),
  ],
};

const addresseePhrases = <String, List<SpeakerPhrase>>{
  "arabic-eastern": [
    SpeakerPhrase(
      "أهلين وسهلين! نورت البناية.",
      "أهلين وسهلين! نورتي البناية.",
      reading: ("ahlein wa sahlein! nawwart el-binaye.", "ahlein wa sahlein! nawwarti el-binaye."),
    ),
    SpeakerPhrase("أهلين! وين رايح؟", "أهلين! وين رايحة؟", reading: ("ahlein! wein rayi7?", "ahlein! wein ray7a?")),
    SpeakerPhrase("وأيمتى ناوي تتجوز؟", "وأيمتى ناوية تتجوزي؟", reading: ("w eimta nawi tetjawwaz?", "w eimta nawye tetjawwazi?")),
    SpeakerPhrase(
      "أهلا فيك معنا! أنا زياد، مدير الفريق",
      "أهلا فيكي معنا! أنا زياد، مدير الفريق",
      reading: ("ahla fik ma3na! ana ziad, mudir el-fari2", "ahla fiki ma3na! ana ziad, mudir el-fari2"),
    ),
  ],
  "arabic-egyptian": [
    SpeakerPhrase("نورت العمارة يا جاري!", "نورتي العمارة يا جارتي!", reading: ("nawwart el-3emara ya gari!", "nawwartī el-3emara ya garti!")),
    SpeakerPhrase("وهتقعد في مصر قد إيه؟", "وهتقعدي في مصر قد إيه؟", reading: ("we hate23od fi masr 2add eih?", "we hate23odi fi masr 2add eih?")),
    SpeakerPhrase(
      "أهلاً بيك في الفريق! أنا هشام، مدير الفريق.",
      "أهلاً بيكي في الفريق! أنا هشام، مدير الفريق.",
      reading: ("ahlan beek fel-faree2! ana hesham, modeer el-faree2.", "ahlan beeki fel-faree2! ana hesham, modeer el-faree2."),
    ),
    SpeakerPhrase(
      "اتفضل يا فندم، بتدور على حاجة؟",
      "اتفضلي يا فندم، بتدوري على حاجة؟",
      reading: ("itfaddal ya fandem, betdawwar 3ala 7aga?", "itfaddali ya fandem, betdawwari 3ala 7aga?"),
    ),
    SpeakerPhrase(
      "كل يا حبيبي، إنت مكسوف ولا إيه؟",
      "كلي يا حبيبتي، إنتي مكسوفة ولا إيه؟",
      reading: ("kol ya 7abibi, enta maksoof wala eih?", "koli ya 7abibti, enti maksoofa wala eih?"),
    ),
    SpeakerPhrase(
      "صباح الفل! مالك، شكلك تعبان؟",
      "صباح الفل! مالِك، شكلك تعبانة؟",
      reading: ("sabah el-foll! malak, shaklak ta3ban?", "sabah el-foll! malek, shaklek ta3bana?"),
    ),
    SpeakerPhrase(
      "وإنت بتشتغل إيه بالظبط هنا؟",
      "وإنتي بتشتغلي إيه بالظبط هنا؟",
      reading: ("we enta beteshtaghal eih bez-zabt hena?", "we enti beteshtaghali eih bez-zabt hena?"),
    ),
  ],
  "arabic-moroccan": [
    SpeakerPhrase("فين غادي؟", "فين غادية؟", reading: ("fin ghadi?", "fin ghadya?")),
    SpeakerPhrase(
      "وفوقاش غادي تزوج إن شاء الله؟",
      "وفوقاش غادية تزوجي إن شاء الله؟",
      reading: ("w fou9ach ghadi tzewwej inchallah?", "w fou9ach ghadya tzewwji inchallah?"),
    ),
    SpeakerPhrase("سير نيشان", "سيري نيشان", reading: ("sir nichan", "siri nichan")),
    SpeakerPhrase("دور عل ليمن", "دوري عل ليمن", reading: ("dor 3la limen", "dori 3la limen")),
    SpeakerPhrase(
      "تفضل آ سيدي، آش حب الخاطر؟",
      "تفضلي آ لالة، آش حب الخاطر؟",
      reading: ("tfeddel a sidi, ach 7eb lkhater?", "tfeddli a lalla, ach 7eb lkhater?"),
    ),
    SpeakerPhrase("هاهي وحدة زوينة، قيسها", "هاهي وحدة زوينة، قيسيها", reading: ("hahiya wa7da zwina, 9iyyesha", "hahiya wa7da zwina, 9iyyisiha")),
    SpeakerPhrase("ما تخافش، دابا نعاونكم", "ما تخافيش، دابا نعاونكم", reading: ("ma tkhafch, daba n3awnkom", "ma tkhafich, daba n3awnkom")),
    SpeakerPhrase("دخل آ ولدي، الدار دارك", "دخلي آ بنتي، الدار دارك", reading: ("dkhel a weldi, ddar darek", "dkhli a benti, ddar darek")),
    SpeakerPhrase(
      "وكتهضر الدارجة مزيان، تبارك الله!",
      "وكتهضري الدارجة مزيان، تبارك الله!",
      reading: ("w kathder ddarija mezyan, tbarkellah!", "w kathderi ddarija mezyan, tbarkellah!"),
    ),
    SpeakerPhrase(
      "ربعة، الله يحفظهم. ونتا، عندك خوتك؟",
      "ربعة، الله يحفظهم. ونتي، عندك خوتك؟",
      reading: ("reb3a, llah y7efdhom. w nta, 3ndek khoutek?", "reb3a, llah y7efdhom. w nti, 3ndek khoutek?"),
    ),
    SpeakerPhrase("آش خبارك؟ باين عليك عيان", "آش خبارك؟ باينة عليك عيانة", reading: ("ach khbarek? bayn 3lik 3iyyan", "ach khbarek? bayna 3lik 3iyyana")),
    SpeakerPhrase("علاش؟ فوقاش كتفيق فالصباح؟", "علاش؟ فوقاش كتفيقي فالصباح؟", reading: ("3lach? fou9ach katfi9 f sba7?", "3lach? fou9ach katfi9i f sba7?")),
    SpeakerPhrase("بكري! وشنو كدير من بعد؟", "بكري! وشنو كديري من بعد؟", reading: ("bekri! w chno katdir men be3d?", "bekri! w chno katdiri men be3d?")),
    SpeakerPhrase(
      "مسكين! وفالويكاند كترتاح شوية؟",
      "مسكينة! وفالويكاند كترتاحي شوية؟",
      reading: ("meskin! w f lwikand katrta7 chwiya?", "meskina! w f lwikand katrta7i chwiya?"),
    ),
    SpeakerPhrase(
      "شنو كنتي كتخدم قبل ما تجي عندنا؟",
      "شنو كنتي كتخدمي قبل ما تجي عندنا؟",
      reading: ("chno kenti katkhdem 9bel ma tji 3ndna?", "chno kenti katkhdmi 9bel ma tji 3ndna?"),
    ),
    SpeakerPhrase(
      "مزيان. كل صباح خاصك دير البوانطاج قبل لاريونيون",
      "مزيان. كل صباح خاصك ديري البوانطاج قبل لاريونيون",
      reading: ("mezyan. kol sba7 khassek dir lpointage 9bel la réunion", "mezyan. kol sba7 khassek diri lpointage 9bel la réunion"),
    ),
    SpeakerPhrase(
      "يعني كتسجل فوقاش دخلتي بالبادج ديالك",
      "يعني كتسجلي فوقاش دخلتي بالبادج ديالك",
      reading: ("y3ni katsejjel fou9ach dkhelti b lbadge dyalek", "y3ni katsejjli fou9ach dkhelti b lbadge dyalek"),
    ),
    SpeakerPhrase("شنو كدير فالويكاند عادة؟", "شنو كديري فالويكاند عادة؟", reading: ("chno katdir f lwikand 3ada?", "chno katdiri f lwikand 3ada?")),
    SpeakerPhrase("ودادي ولا رجاوي؟", "ودادية ولا رجاوية؟", reading: ("wdadi wla rjawi?", "wdadiya wla rjawiya?")),
    SpeakerPhrase(
      "سير لدرب غلف، السياح ما كيعرفوهش",
      "سيري لدرب غلف، السياح ما كيعرفوهش",
      reading: ("sir l derb ghallef, ssiya7 ma kay3erfouhch", "siri l derb ghallef, ssiya7 ma kay3erfouhch"),
    ),
    SpeakerPhrase(
      "لا، ربع ساعة ديال المشي، ولا خود طاكسي صغير",
      "لا، ربع ساعة ديال المشي، ولا خودي طاكسي صغير",
      reading: ("la, rbe3 sa3a dyal lmchi, wla khod taxi sghir", "la, rbe3 sa3a dyal lmchi, wla khodi taxi sghir"),
    ),
    SpeakerPhrase(
      "من الصباح حتى لليل، ولكن سير بكري",
      "من الصباح حتى لليل، ولكن سيري بكري",
      reading: ("men sba7 7ta l lil, walakin sir bekri", "men sba7 7ta l lil, walakin siri bekri"),
    ),
    SpeakerPhrase(
      "حطو فوق الميزان. جوج كيلو بالضبط",
      "حطيه فوق الميزان. جوج كيلو بالضبط",
      reading: ("7etto fou9 lmizan. jouj kilo bdebt", "7ettih fou9 lmizan. jouj kilo bdebt"),
    ),
    SpeakerPhrase("سمح لينا على هاد المشكل", "سمحي لينا على هاد المشكل", reading: ("sme7 lina 3la had lmochkil", "sem7i lina 3la had lmochkil")),
    SpeakerPhrase("صباح النور، تفضل. آش بيك؟", "صباح النور، تفضلي. آش بيك؟", reading: ("sba7 nnour, tfeddel. ach bik?", "sba7 nnour, tfeddli. ach bik?")),
    SpeakerPhrase(
      "غادي تاخد هاد الدوا تلت مرات فالنهار، فهمتي؟",
      "غادي تاخدي هاد الدوا تلت مرات فالنهار، فهمتي؟",
      reading: ("ghadi takhod had ddwa tlt merrat f nhar, fhemti?", "ghadi takhdi had ddwa tlt merrat f nhar, fhemti?"),
    ),
    SpeakerPhrase(
      "من بعد الماكلة، وشرب الما بزاف",
      "من بعد الماكلة، وشربي الما بزاف",
      reading: ("men be3d lmakla, w chreb lma bzzaf", "men be3d lmakla, w cherbi lma bzzaf"),
    ),
    SpeakerPhrase("مرحبا! بغيتي تلعب معانا؟", "مرحبا! بغيتي تلعبي معانا؟", reading: ("mer7ba! bghiti tl3eb m3ana?", "mer7ba! bghiti tl3bi m3ana?")),
    SpeakerPhrase(
      "نعم آ سيدي، شنو نقدر نعاونك؟",
      "نعم آ لالة، شنو نقدر نعاونك؟",
      reading: ("na3am a sidi, chno n9der n3awnek?", "na3am a lalla, chno n9der n3awnek?"),
    ),
  ],
  "arabic-msa": [
    SpeakerPhrase(
      "مرحباً بك في بنايتنا، يا جاري!",
      "مرحباً بكِ في بنايتنا، يا جارتي!",
      reading: ("marhaban bika fi binayatina, ya jari!", "marhaban biki fi binayatina, ya jarati!"),
    ),
    SpeakerPhrase("إلى أين تريد الذهاب؟", "إلى أين تريدين الذهاب؟", reading: ("ila ayna turid adh-dhahab?", "ila ayna turidin adh-dhahab?")),
    SpeakerPhrase(
      "ومتى ستتزوج إن شاء الله؟",
      "ومتى ستتزوجين إن شاء الله؟",
      reading: ("wa mata sa-tatazawwaj in sha'a allah?", "wa mata sa-tatazawwajin in sha'a allah?"),
    ),
    SpeakerPhrase(
      "هل تريد أن نخرج يوم الجمعة؟",
      "هل تريدين أن نخرج يوم الجمعة؟",
      reading: ("hal turid an nakhruja yawm al-jum3a?", "hal turidin an nakhruja yawm al-jum3a?"),
    ),
    SpeakerPhrase(
      "أهلاً! هل تريد أن تنضم إلى فريق السلة؟",
      "أهلاً! هل تريدين أن تنضم إلى فريق السلة؟",
      reading: ("ahlan! hal turid an tandamma ila fariq as-salla?", "ahlan! hal turidin an tandamma ila fariq as-salla?"),
    ),
    SpeakerPhrase(
      "صباح الخير! تبدو متعباً، هل أنت بخير؟",
      "صباح الخير! تبدين متعبةً، هل أنتِ بخير؟",
      reading: ("sabah al-khayr! tabdu muta3aban, hal anta bi-khayr?", "sabah al-khayr! tabdina muta3abatan, hal anti bi-khayr?"),
    ),
  ],
  "hebrew": [
    SpeakerPhrase("ברוך הבא לבניין!", "ברוכה הבאה לבניין!", reading: ("barukh haba la-binyan!", "brukha haba'a la-binyan!")),
    SpeakerPhrase(
      "שבת שלום! שב, תאכל משהו!",
      "שבת שלום! שבי, תאכלי משהו!",
      reading: ("shabat shalom! shev, tokhal mashehu!", "shabat shalom! shvi, tokhli mashehu!"),
    ),
    SpeakerPhrase("ומתי אתה מתחתן?", "ומתי את מתחתנת?", reading: ("u-matai ata mitkhaten?", "u-matai at mitkhatenet?")),
    SpeakerPhrase(
      "שלום, שב. מה מביא אותך אליי?",
      "שלום, שבי. מה מביא אותך אליי?",
      reading: ("shalom, shev. ma mevi otkha elai?", "shalom, shvi. ma mevi otakh elai?"),
    ),
  ],
  "italian": [SpeakerPhrase("Benvenuto! Io abito qui da anni.", "Benvenuta! Io abito qui da anni."), SpeakerPhrase("Viaggia da solo?", "Viaggia da sola?")],
  "portuguese-brazilian": [SpeakerPhrase("Seja bem-vindo ao prédio! Fique à vontade.", "Seja bem-vinda ao prédio! Fique à vontade.")],
  "portuguese-european": [SpeakerPhrase("Seja bem-vindo ao prédio!", "Seja bem-vinda ao prédio!")],
  "spanish-spain": [SpeakerPhrase("¡Bienvenido!", "¡Bienvenida!")],
};
