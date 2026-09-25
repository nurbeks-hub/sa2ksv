// АДАМ БАСЫ / The Head — UI strings. Kazakh (kk) is the default; ru and en mirror the same keys.
// Structure names and facts live in content/structures.<lang>.json, not here.
//
// Kazakh terminology sources actually consulted (2026-09-24):
//   termincom.kz — state terminology base of the Language Policy Committee, search pattern
//     https://termincom.kz/search/?termin=<term>&cid=0&field=all&approved_first=1
//     queried: череп → бассүйек; черепно-мозговые нервы → бассүйек-ми жүйкелері (бекітілген, 2023);
//     артерия → артерия, күретамыр (2024); вена → вена, көктамыр; нерв → жүйке; сустав → буын;
//     железа → без; сухожилие → сіңір (мед., бекітілген); хрящ → шеміршек; мышца → бұлшықет;
//     кожа → тері; головной мозг → ми; мозговая оболочка → ми қабығы; ликвор → жұлын сұйығы;
//     спинномозговая жидкость → жұлын сұйықтығы; мимика → ым; сагиттальный → сагитталдық /
//     сагитталды; плоскость фронтальная → фронталды жазықтық (мед.); горизонтальный → көлденең (мед.);
//     лимфатические узлы → лимфа түйіндері; кора головного мозга → ми қыртысы; срез → кесік (биол.),
//     разрез → қима (геол.).
//   https://kk.wikipedia.org/wiki/Бас_сүйек   (бас сүйек, ми сауыты, бет сүйектері)
//   https://kk.wikipedia.org/wiki/Ми_жүйкелері (12 жұп ми жүйкесі; иіс, көру, үшкіл, бет жүйкесі)
//   https://kk.wikipedia.org/wiki/Ми           (ми сұйықтығы, ми қарыншалары, мишық, ми қыртысы)
//   https://kk.wikipedia.org/wiki/Бұлшық_ет    ("Бастың бұлшықеттері шайнау және ымдау деп 2-ге бөлінеді")
//   kk.wikipedia.org search snippets: Сіңір, Шеміршек, Артерия (күретамыр), Көктамыр, Қалқанша без,
//     Сілекей безі, Лимфа жүйесі, Лимфа безі.
//   sozdik.kz was tried but returned a human-check wall; not used.
// Terms that still need a native medical reviewer are listed in LOW_CONFIDENCE_TERMS below.

export const LANGS = ['kk', 'ru', 'en'];
export const LANG_LABEL = { kk: 'ҚАЗ', ru: 'РУС', en: 'ENG' };

export const UI = {
  kk: {
    title: 'Адам басы — бас пен мойынның 3D атласы',
    brand: 'АДАМ БАСЫ',
    sub: 'Орташа ересек қазақ · бас пен мойын',
    subM: 'Орташа ересек қазақ ер адамы',
    subF: 'Орташа ересек қазақ әйелі',
    loading: 'Жүктелуде',
    loadingSub: 'анатомиялық модель',
    layers: {
      skin: 'Тері', muscles: 'Бұлшықеттер', vessels: 'Тамырлар',
      nerves: 'Жүйкелер', bones: 'Сүйектер', brain: 'Ми',
    },
    depthLabel: 'Тереңдік',
    depthHint: 'Тереңірек үңіліңіз',
    toggleSystemHint: 'Жүйені жасыру немесе көрсету үшін ұзақ басыңыз не тінтуірдің оң жақ батырмасын басыңыз',
    systems: {
      skin: 'Тері', muscles: 'Бұлшықеттер', tendon: 'Сіңірлер',
      vessels: 'Қан тамырлары', artery: 'Артериялар', vein: 'Веналар',
      nerves: 'Жүйкелер', brain: 'Ми', eye: 'Көз',
      bones: 'Сүйектер', teeth: 'Тістер', cartilage: 'Шеміршектер', joints: 'Буындар',
      organs: 'Мүшелер', glands: 'Бездер', lymph: 'Лимфа жүйесі',
      meninges: 'Ми қабықтары', csf: 'Ми-жұлын сұйықтығы',
    },
    sex: { label: 'Жынысы', m: 'Ер', f: 'Әйел', mLong: 'Ер адам', fLong: 'Әйел адам' },
    section: {
      label: 'Қима', sagittal: 'Сагитталды', axial: 'Көлденең', coronal: 'Фронталды',
      off: 'Қимасыз', drag: 'Жазықтықты сүйреп жылжытыңыз',
    },
    search: {
      placeholder: 'Құрылымды іздеу…',
      empty: 'Ештеңе табылмады',
      hint: 'қазақша, орысша, ағылшынша не латынша',
    },
    tour: { start: '▶ Саяхат', stop: '■ Тоқтату', label: 'Саяхат' },
    tourStops: [
      { t: 'Бет', s: 'Тері — дененің ең үлкен мүшесі' },
      { t: 'Ымдау бұлшықеттері', s: 'Бір ұшы сүйекке, екінші ұшы теріге бекиді' },
      { t: 'Шайнау бұлшықеттері', s: 'Төменгі жақты төрт жұп бұлшықет қозғайды' },
      { t: 'Қан тамырлары', s: 'Артериялар қанды жүректен әкеледі, веналар кері қайтарады' },
      { t: 'Он екі жұп жүйке', s: 'Бассүйек-ми жүйкелері мидан тікелей шығады' },
      { t: 'Бассүйек', s: 'Ми сауыты мен бет сүйектері. Қозғалатыны — тек төменгі жақ' },
      { t: 'Ми', s: 'Дене салмағының шамамен 2%-ы, ал тыныштық күйдегі энергия шығынының 20%-ы' },
      { t: 'Көз', s: 'Көздің торлы қабығы мидан дамиды' },
    ],
    intro: { l1: 'Адам басы.', l2: 'Қабат-қабатымен.' },
    hint: 'Сүйреп айналдырыңыз · шкаламен тереңдеңіз · басып танысыңыз',
    hintTouch: 'Саусақпен айналдырыңыз · шкаламен тереңдеңіз · түртіп танысыңыз',
    keys: '↑↓ тереңдік · / іздеу · S қима · T саяхат · Esc',
    panel: {
      close: 'Жабу', latin: 'Латынша', facts: 'Деректер', source: 'Дереккөз', sources: 'Дереккөздер',
      noFacts: 'Бұл құрылым туралы тексерілген дерек әзірге жоқ', prev: 'Алдыңғы', next: 'Келесі',
    },
    hover: { click: 'басыңыз' },
    sound: 'Дыбыс',
    aboutAria: 'Жоба, әдіс және лицензиялар',
    searchAria: 'Іздеу',
    langAria: 'Тіл',
    sexAria: 'Жынысы',
    about: {
      aria: 'Жоба, әдіс және лицензиялар',
      title: 'Атлас туралы',
      body: [
        'Бұл — ересек қазақ ер адамы мен әйелінің орташаланған басы мен мойнының интерактивті 3D атласы. Ол білім алуға арналған; медициналық немесе диагностикалық құрал емес.',
        'Геометрия ашық анатомиялық Z-Anatomy модельдерінен алынған (CC BY-SA 4.0), олардың негізі — BodyParts3D (DBCLS, CC BY-SA 2.1 JP). Пішін анатомиялық бағдарлар бойынша тегіс деформациямен (RBF) қазақ ересектерінің басы мен беті өлшемдерінің жарияланған орташа мәндеріне келтірілген; қазақ деректері жоқ жерде ең жақын Орталық Азия іріктемелері алынған. Әйел басы — сол модель: оған жыныстық диморфизм туралы жарияланған деректер (бассүйек, жұмсақ тіндер, көмей) бойынша деформация өрісі қолданылған.',
        'Панельдердегі әр деректің дереккөзі бар, оны тәуелсіз тексеруші растаған.',
      ],
      simplTitle: 'Жеңілдетулер',
      simpl: [
        'Модель нақты адамды емес, орташа пішінді көрсетеді.',
        'BodyParts3D бір ересек жапон ер адамының денесі негізінде жасалған; орташа пішінге қазақтарды сканерлеу арқылы емес, деформация арқылы қол жеткізілді.',
        'Ұсақ қан тамырлары мен жүйкелер жеңілдетілген.',
        'Түстер шартты, тіндердің шынайы түсі емес.',
        'Бас пішіні көрінуі үшін шаш жасырылған.',
        'Әйел нұсқасы — статистикалық деформация; ішкі мүшелер де сол деформацияға бағынады.',
        'Қима беттерінің түстері сызбалық.',
      ],
      licTitle: 'Лицензиялар',
      lic: [
        'Z-Anatomy — CC BY-SA 4.0',
        'BodyParts3D © DBCLS — CC BY-SA 2.1 JP',
        'three.js — MIT',
        'Manrope, IBM Plex Mono — SIL OFL 1.1',
        '3D модельдің туынды нұсқасы CC BY-SA 4.0 лицензиясымен таратылады.',
      ],
      credit: 'Жасаған: Claude (Opus 5.5)',
    },
    kid: { inside: 'Не ішінде?', organs: 'Мүшелер', cut: 'Кесу', uncut: 'Жабу', side: 'Бүйірден', top: 'Жоғарыдан', front: 'Алдынан', tour: 'Саяхат', stop: 'Тоқтату', turn: 'Айналдыр', tap: 'Түрт', look: 'Ішін көру', more: 'Толығырақ', less: 'Жасыру', back: 'Артқа', done: 'Дайын', next: 'Келесі', apart: 'Ажырату', together: 'Құрастыру', wow: 'Қызық дерек', male: 'Ер', female: 'Әйел', search: 'Іздеу' },
    regions: { auricle: 'Құлақ қалқаны', nose: 'Мұрын', eye: 'Көз аймағы', mouth: 'Ауыз бен ерін', forehead: 'Маңдай', scalp: 'Бас терісі', cheek: 'Бет', chin: 'Иек', neck: 'Мойын' },
    organs: { button: 'Мүшелер', title: 'Мүшелерді зерттеу', chapters: 'тарау', parts: 'бөлік', also: 'Сондай-ақ' },
    dive: { explore: 'Толығырақ', back: 'Бас моделіне оралу', explode: 'Ажырату', parts: 'бөлік', open: 'Ашылуда…', more: 'Толығырақ оқу', less: 'Жасыру' },
    cap: {
      sectionOn: 'Жазықтықты сүйреңіз',
      tourStep: 'аялдама',
      of: '/',
    },
  },

  ru: {
    title: 'Голова человека — 3D-атлас головы и шеи',
    brand: 'ГОЛОВА ЧЕЛОВЕКА',
    sub: 'Средние взрослые казах и казашка · голова и шея',
    subM: 'Средний взрослый казах',
    subF: 'Средняя взрослая казашка',
    loading: 'Загрузка',
    loadingSub: 'анатомическая модель',
    layers: {
      skin: 'Кожа', muscles: 'Мышцы', vessels: 'Сосуды',
      nerves: 'Нервы', bones: 'Кости', brain: 'Мозг',
    },
    depthLabel: 'Глубина',
    depthHint: 'Листайте глубже',
    toggleSystemHint: 'Долгое нажатие или правый клик — скрыть или показать систему',
    systems: {
      skin: 'Кожа', muscles: 'Мышцы', tendon: 'Сухожилия',
      vessels: 'Кровеносные сосуды', artery: 'Артерии', vein: 'Вены',
      nerves: 'Нервы', brain: 'Головной мозг', eye: 'Глаз',
      bones: 'Кости', teeth: 'Зубы', cartilage: 'Хрящи', joints: 'Суставы',
      organs: 'Органы', glands: 'Железы', lymph: 'Лимфатическая система',
      meninges: 'Мозговые оболочки', csf: 'Спинномозговая жидкость',
    },
    sex: { label: 'Пол', m: 'Муж', f: 'Жен', mLong: 'Мужчина', fLong: 'Женщина' },
    section: {
      label: 'Срез', sagittal: 'Сагиттальный', axial: 'Горизонтальный', coronal: 'Фронтальный',
      off: 'Без среза', drag: 'Перетащите плоскость',
    },
    search: {
      placeholder: 'Найти структуру…',
      empty: 'Ничего не найдено',
      hint: 'по-казахски, по-русски, по-английски или на латыни',
    },
    tour: { start: '▶ Экскурсия', stop: '■ Стоп', label: 'Экскурсия' },
    tourStops: [
      { t: 'Лицо', s: 'Кожа — самый большой орган тела' },
      { t: 'Мимические мышцы', s: 'Одним концом крепятся к кости, другим — к коже' },
      { t: 'Жевательные мышцы', s: 'Нижнюю челюсть движут четыре пары мышц' },
      { t: 'Кровеносные сосуды', s: 'Артерии несут кровь от сердца, вены — обратно' },
      { t: 'Двенадцать пар нервов', s: 'Черепные нервы выходят прямо из мозга' },
      { t: 'Череп', s: 'Мозговой и лицевой отделы. Подвижна только нижняя челюсть' },
      { t: 'Мозг', s: 'Около 2% массы тела и 20% энергии в покое' },
      { t: 'Глаз', s: 'Сетчатка развивается из мозга' },
    ],
    intro: { l1: 'Голова человека.', l2: 'Слой за слоем.' },
    hint: 'Тяните, чтобы вращать · шкала — глубже · нажмите, чтобы узнать',
    hintTouch: 'Ведите пальцем, чтобы вращать · шкала — глубже · коснитесь, чтобы узнать',
    keys: '↑↓ глубина · / поиск · S срез · T экскурсия · Esc',
    panel: {
      close: 'Закрыть', latin: 'Латынь', facts: 'Факты', source: 'Источник', sources: 'Источники',
      noFacts: 'Проверенных фактов об этой структуре пока нет', prev: 'Назад', next: 'Дальше',
    },
    hover: { click: 'нажмите' },
    sound: 'Звук',
    aboutAria: 'О проекте, метод и лицензии',
    searchAria: 'Поиск',
    langAria: 'Язык',
    sexAria: 'Пол',
    about: {
      aria: 'О проекте, метод и лицензии',
      title: 'Об атласе',
      body: [
        'Интерактивный 3D-атлас головы и шеи усреднённых взрослых казаха и казашки. Он создан для обучения и не является медицинским или диагностическим инструментом.',
        'Геометрия взята из открытых анатомических моделей Z-Anatomy (CC BY-SA 4.0), основанных на BodyParts3D (DBCLS, CC BY-SA 2.1 JP). Форма подогнана плавной деформацией по анатомическим ориентирам (RBF) к опубликованным средним размерам головы и лица взрослых казахов; где казахских данных нет, использованы ближайшие центральноазиатские выборки. Женская голова — та же модель с полем деформации по опубликованным данным о половом диморфизме (череп, мягкие ткани, гортань).',
        'У каждого факта в панелях есть источник, проверенный независимым верификатором.',
      ],
      simplTitle: 'Упрощения',
      simpl: [
        'Модель показывает среднюю форму, а не конкретного человека.',
        'BodyParts3D построен по телу одного взрослого японца; средняя форма получена деформацией, а не сканированием казахов.',
        'Мелкие сосуды и нервы упрощены.',
        'Цвета условные, а не настоящие цвета тканей.',
        'Волосы скрыты, чтобы была видна форма головы.',
        'Женский вариант — статистическая деформация; внутренние органы следуют той же деформации.',
        'Цвета на плоскости среза схематичны.',
      ],
      licTitle: 'Лицензии',
      lic: [
        'Z-Anatomy — CC BY-SA 4.0',
        'BodyParts3D © DBCLS — CC BY-SA 2.1 JP',
        'three.js — MIT',
        'Manrope, IBM Plex Mono — SIL OFL 1.1',
        'Производная 3D-модель распространяется по лицензии CC BY-SA 4.0.',
      ],
      credit: 'Сделано Claude (Opus 5.5)',
    },
    kid: { inside: 'Что внутри?', organs: 'Органы', cut: 'Разрезать', uncut: 'Закрыть', side: 'Сбоку', top: 'Сверху', front: 'Спереди', tour: 'Экскурсия', stop: 'Стоп', turn: 'Поверни', tap: 'Нажми', look: 'Заглянуть внутрь', more: 'Подробнее', less: 'Свернуть', back: 'Назад', done: 'Готово', next: 'Дальше', apart: 'Разобрать', together: 'Собрать', wow: 'Интересно', male: 'Муж', female: 'Жен', search: 'Поиск' },
    regions: { auricle: 'Ушная раковина', nose: 'Нос', eye: 'Область глаза', mouth: 'Рот и губы', forehead: 'Лоб', scalp: 'Волосистая часть головы', cheek: 'Щека', chin: 'Подбородок', neck: 'Шея' },
    organs: { button: 'Органы', title: 'Органы крупным планом', chapters: 'глав', parts: 'частей', also: 'Также' },
    dive: { explore: 'Подробнее', back: 'К голове', explode: 'Разобрать', parts: 'частей', open: 'Открываем…', more: 'Читать дальше', less: 'Свернуть' },
    cap: {
      sectionOn: 'Перетащите плоскость',
      tourStep: 'остановка',
      of: '/',
    },
  },

  en: {
    title: 'The Head — a 3D atlas of the head and neck',
    brand: 'THE HEAD',
    sub: 'Average adult Kazakh · head and neck',
    subM: 'Average adult Kazakh man',
    subF: 'Average adult Kazakh woman',
    loading: 'Loading',
    loadingSub: 'anatomical model',
    layers: {
      skin: 'Skin', muscles: 'Muscles', vessels: 'Vessels',
      nerves: 'Nerves', bones: 'Bones', brain: 'Brain',
    },
    depthLabel: 'Depth',
    depthHint: 'Scroll deeper',
    toggleSystemHint: 'Long-press or right-click to hide or show this system',
    systems: {
      skin: 'Skin', muscles: 'Muscles', tendon: 'Tendons',
      vessels: 'Blood vessels', artery: 'Arteries', vein: 'Veins',
      nerves: 'Nerves', brain: 'Brain', eye: 'Eye',
      bones: 'Bones', teeth: 'Teeth', cartilage: 'Cartilage', joints: 'Joints',
      organs: 'Organs', glands: 'Glands', lymph: 'Lymphatic system',
      meninges: 'Meninges', csf: 'Cerebrospinal fluid',
    },
    sex: { label: 'Sex', m: 'Male', f: 'Female', mLong: 'Man', fLong: 'Woman' },
    section: {
      label: 'Section', sagittal: 'Sagittal', axial: 'Axial', coronal: 'Coronal',
      off: 'No section', drag: 'Drag to move the plane',
    },
    search: {
      placeholder: 'Find a structure…',
      empty: 'Nothing found',
      hint: 'Kazakh, Russian, English or Latin',
    },
    tour: { start: '▶ Tour', stop: '■ Stop', label: 'Tour' },
    tourStops: [
      { t: 'The face', s: 'Skin is the largest organ of the body' },
      { t: 'Muscles of expression', s: 'Anchored in bone at one end, skin at the other' },
      { t: 'Muscles of chewing', s: 'Four pairs of muscles move the lower jaw' },
      { t: 'Blood vessels', s: 'Arteries carry blood from the heart, veins return it' },
      { t: 'Twelve pairs of nerves', s: 'The cranial nerves leave the brain directly' },
      { t: 'The skull', s: 'Braincase and facial bones. Only the lower jaw moves' },
      { t: 'The brain', s: 'About 2% of body mass, 20% of resting energy' },
      { t: 'The eye', s: 'The retina grows out of the brain' },
    ],
    intro: { l1: 'The human head.', l2: 'Layer by layer.' },
    hint: 'Drag to turn · use the scale to go deeper · click to explore',
    hintTouch: 'Swipe to turn · use the scale to go deeper · tap to explore',
    keys: '↑↓ depth · / search · S section · T tour · Esc',
    panel: {
      close: 'Close', latin: 'Latin', facts: 'Facts', source: 'Source', sources: 'Sources',
      noFacts: 'No verified facts for this structure yet', prev: 'Previous', next: 'Next',
    },
    hover: { click: 'click' },
    sound: 'Sound',
    aboutAria: 'About, method and licences',
    searchAria: 'Search',
    langAria: 'Language',
    sexAria: 'Sex',
    about: {
      aria: 'About, method and licences',
      title: 'About this atlas',
      body: [
        'An interactive 3D atlas of the head and neck of an average adult Kazakh man and woman. It is made for learning, not as a medical or diagnostic tool.',
        'The geometry comes from the open anatomical models of Z-Anatomy (CC BY-SA 4.0), based on BodyParts3D (DBCLS, CC BY-SA 2.1 JP). Its shape is fitted by a smooth landmark-based warp (RBF) to published mean head and face measurements of Kazakh adults, with the nearest Central Asian samples where Kazakh data are missing. The female head is the same model with a deformation field from published data on sexual dimorphism (skull, soft tissue, larynx).',
        'Every fact in the panels has a source checked by an independent verifier.',
      ],
      simplTitle: 'Simplifications',
      simpl: [
        'The model shows an average, not a specific person.',
        'BodyParts3D is derived from the body of one adult Japanese man; the average shape is reached by warping, not by scanning Kazakh people.',
        'Small vessels and nerves are simplified.',
        'Colours are illustrative, not true tissue colours.',
        'Scalp hair is hidden to show the shape of the head.',
        'The female variant is a statistical deformation; internal organs follow the same warp.',
        'Section caps use schematic colours.',
      ],
      licTitle: 'Licences',
      lic: [
        'Z-Anatomy — CC BY-SA 4.0',
        'BodyParts3D © DBCLS — CC BY-SA 2.1 JP',
        'three.js — MIT',
        'Manrope, IBM Plex Mono — SIL OFL 1.1',
        'The derived 3D model is shared under CC BY-SA 4.0.',
      ],
      credit: 'Built by Claude (Opus 5.5)',
    },
    kid: { inside: "What's inside?", organs: 'Organs', cut: 'Cut', uncut: 'Close', side: 'Side', top: 'Top', front: 'Front', tour: 'Tour', stop: 'Stop', turn: 'Turn', tap: 'Tap', look: 'Look inside', more: 'More', less: 'Less', back: 'Back', done: 'Done', next: 'Next', apart: 'Take apart', together: 'Put together', wow: 'Fun fact', male: 'Male', female: 'Female', search: 'Search' },
    regions: { auricle: 'Auricle', nose: 'Nose', eye: 'Eye region', mouth: 'Mouth and lips', forehead: 'Forehead', scalp: 'Scalp', cheek: 'Cheek', chin: 'Chin', neck: 'Neck' },
    organs: { button: 'Organs', title: 'Organs up close', chapters: 'chapters', parts: 'parts', also: 'Also' },
    dive: { explore: 'Explore', back: 'Back to the head', explode: 'Take apart', parts: 'parts', open: 'Opening…', more: 'Read more', less: 'Show less' },
    cap: {
      sectionOn: 'Drag the plane',
      tourStep: 'stop',
      of: '/',
    },
  },
};

// Kazakh terms a native medical reviewer should confirm before the public showing.
export const LOW_CONFIDENCE_TERMS = [
  {
    kk: 'Сагитталды', ru: 'Сагиттальный', en: 'Sagittal',
    note: 'Button label. termincom gives "сагитталдық" and "сагитталды жиек"; the design draft had "Сагитталь". Alternatives: "Сагитталь жазықтық", "Сагитталдық".',
    source: 'https://termincom.kz/search/?termin=сагиттальный',
  },
  {
    kk: 'Фронталды', ru: 'Фронтальный', en: 'Coronal',
    note: 'termincom (медицина): "Фронталды жазықтық". The biology entry "маңдайтұс" also exists but is rare.',
    source: 'https://termincom.kz/search/?termin=фронтальный',
  },
  {
    kk: 'Көлденең', ru: 'Горизонтальный (аксиальный)', en: 'Axial',
    note: 'termincom (медицина): горизонтальный → "көлденең". "Көлденең" can also mean transverse in general; "горизонталь жазықтық" is an alternative.',
    source: 'https://termincom.kz/search/?termin=горизонтальный',
  },
  {
    kk: 'Қима', ru: 'Срез', en: 'Section',
    note: 'termincom gives "қима" for разрез (geology/engineering) and "кесік" for срез (biology). "Қима" chosen as the more natural UI word; "Кесік" is the alternative.',
    source: 'https://termincom.kz/search/?termin=срез',
  },
  {
    kk: 'Ымдау бұлшықеттері', ru: 'Мимические мышцы', en: 'Muscles of facial expression',
    note: 'Used in kk.wikipedia (Бұлшық ет); termincom: мимика → "ым". "Мимикалық бұлшықеттер" and "бет-әлпет бұлшықеттері" also occur in textbooks.',
    source: 'https://kk.wikipedia.org/wiki/Бұлшық_ет',
  },
  {
    kk: 'Ми-жұлын сұйықтығы', ru: 'Спинномозговая жидкость (ликвор)', en: 'Cerebrospinal fluid',
    note: 'termincom: ликвор → "жұлын сұйығы", спинномозговая жидкость → "жұлын сұйықтығы"; kk.wikipedia uses "ми сұйықтығы" and "ми жұлын сұйықтығы". Compound chosen for clarity.',
    source: 'https://termincom.kz/search/?termin=ликвор',
  },
  {
    kk: 'Бассүйек-ми жүйкелері', ru: 'Черепные (черепно-мозговые) нервы', en: 'Cranial nerves',
    note: 'Approved term (termincom, 2023). kk.wikipedia uses "ми жүйкелері". Kept the approved form.',
    source: 'https://termincom.kz/search/?termin=черепн',
  },
  {
    kk: 'Бассүйек', ru: 'Череп', en: 'Skull',
    note: 'termincom (2023) writes it as one word; kk.wikipedia writes "бас сүйек". One-word form used for consistency with "бассүйек-ми жүйкелері".',
    source: 'https://kk.wikipedia.org/wiki/Бас_сүйек',
  },
  {
    kk: 'Тамырлар', ru: 'Сосуды', en: 'Vessels',
    note: 'Short depth-rail label from the design brief. On its own "тамыр" can also mean root or pulse; the systems line uses the full "Қан тамырлары".',
    source: 'https://termincom.kz/search/?termin=сосуд',
  },
  {
    kk: 'Көздің торлы қабығы', ru: 'Сетчатка', en: 'Retina',
    note: 'Descriptive form; "торқабық" also occurs. Used in tour stop 8.',
    source: 'https://kk.wikipedia.org/wiki/Ми',
  },
  {
    kk: 'Саяхат', ru: 'Экскурсия', en: 'Tour',
    note: 'Name given in the design brief. Literally "journey"; "Шолу" (overview) would be a more neutral alternative.',
    source: 'specs/design.md',
  },
];

export function initialLang() {
  const ok = l => LANGS.includes(l);
  try {
    if (typeof location !== 'undefined' && location.search) {
      const q = new URLSearchParams(location.search).get('lang');
      if (ok(q)) return q;
    }
  } catch {}
  try {
    if (typeof localStorage !== 'undefined') {
      const s = localStorage.getItem('head.lang');
      if (ok(s)) return s;
    }
  } catch {}
  return 'kk';
}

export function storeLang(l) {
  try { if (typeof localStorage !== 'undefined' && LANGS.includes(l)) localStorage.setItem('head.lang', l); } catch {}
}
