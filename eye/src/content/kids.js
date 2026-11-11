// Plain-language layer for the kids / exhibition UI (ux-kids.md): four simple groups, an everyday name where the
// anatomical one is jargon, one sentence "what it does" and one "wow" fact per part.
// Every wow fact restates a verified fact from content/parts.js (fact index `f` → same source); nothing new is claimed.
// The full anatomical name, description, all facts and sources stay available under «Толығырақ / Подробнее / More».

export const KID_GROUPS = [
  { id: 'outer', color: '#e9e3da', parts: ['cornea', 'sclera', 'conjunctiva'] },
  { id: 'inner', color: '#f0b27a', parts: ['iris', 'sphincter-pupillae', 'dilator-pupillae', 'lens', 'zonules', 'ciliary-body', 'vitreous', 'retina', 'macula', 'optic-disc', 'choroid', 'optic-nerve'] },
  { id: 'muscle', color: '#d9776b', parts: ['superior-rectus', 'inferior-rectus', 'medial-rectus', 'lateral-rectus', 'superior-oblique', 'inferior-oblique'] },
  { id: 'vessel', color: '#ff4d5e', parts: ['conjunctival-vessels', 'iris-vessels', 'anterior-ciliary-arteries', 'posterior-ciliary-arteries', 'retinal-vessels', 'central-retinal-vessels', 'vortex-veins', 'ophthalmic-artery'] },
];
export const KID_GROUP_OF = Object.fromEntries(KID_GROUPS.flatMap(g => g.parts.map(p => [p, g.id])));

export const KID_GROUP_NAMES = {
  kk: { outer: 'Сыртқы қабық', inner: 'Ішкі бөліктер', muscle: 'Бұлшықеттер', vessel: 'Тамырлар' },
  ru: { outer: 'Оболочка', inner: 'Внутри глаза', muscle: 'Мышцы', vessel: 'Сосуды' },
  en: { outer: 'Outer coat', inner: 'Inside the eye', muscle: 'Muscles', vessel: 'Blood vessels' },
};

// name: only where the anatomical name is jargon for a 10–16-year-old; otherwise the regular name from parts.js is used.
// v: the big number of the wow fact (already in local notation).
export const KIDS = {
  cornea: {
    kk: { s: 'Көздің алдыңғы мөлдір «терезесі». Жарықты ішке өткізеді және фокустаудың басым бөлігін өзі атқарады.', w: 'Ортасында қалыңдығы небәрі жарты миллиметрдей.', v: '0,55 мм' },
    ru: { s: 'Прозрачное переднее «окно» глаза. Пропускает свет внутрь и делает бо́льшую часть фокусировки.', w: 'В центре она толщиной всего около половины миллиметра.', v: '0,55 мм' },
    en: { s: 'The clear front window of the eye. It lets light in and does most of the focusing.', w: 'In the middle it is only about half a millimetre thick.', v: '0.55 mm' },
    f: 1,
  },
  conjunctiva: {
    kk: { s: 'Көздің ағын жауып тұрған жұқа мөлдір қабықша. Көз бетінің ылғалды болуына көмектеседі.', w: 'Бүкіл қабатының қалыңдығы — миллиметрдің төрттен біріндей ғана.', v: '0,24 мм' },
    ru: { s: 'Тонкая прозрачная плёнка поверх белка глаза. Помогает держать поверхность глаза влажной.', w: 'Весь этот слой толщиной всего около четверти миллиметра.', v: '0,24 мм' },
    en: { s: 'A thin clear skin over the white of the eye. It helps keep the eye’s surface moist.', w: 'The whole layer is only about a quarter of a millimetre thick.', v: '0.24 mm' },
    f: 1,
  },
  'conjunctival-vessels': {
    kk: { s: 'Көздің ағындағы ұсақ қан тамырлары. Көз қызарғанда дәл осылар көрінеді.', w: 'Әрқайсысының жуандығы шамамен 0,016 мм — шаш талынан бірнеше есе жіңішке.', v: '0,016 мм' },
    ru: { s: 'Крошечные сосуды на белке глаза. Именно их видно, когда глаза краснеют.', w: 'Каждый толщиной около 0,016 мм — в несколько раз тоньше волоса.', v: '0,016 мм' },
    en: { s: 'Tiny blood vessels on the white of the eye — the ones you see when your eyes go red.', w: 'Each is about 0.016 mm wide — several times thinner than a hair.', v: '0.016 mm' },
    f: 2,
  },
  iris: {
    kk: { s: 'Көздің түсті сақинасы. Оның бұлшықеттері қарашықты үлкейтеді не кішірейтеді.', w: 'Түсті сақинаның ені шамамен 12 миллиметр.', v: '12 мм' },
    ru: { s: 'Цветное кольцо глаза. Его мышцы делают зрачок больше или меньше.', w: 'Цветное кольцо шириной около 12 миллиметров.', v: '12 мм' },
    en: { s: 'The coloured ring of the eye. Its muscles make the pupil bigger or smaller.', w: 'The coloured ring is about 12 millimetres across.', v: '12 mm' },
    f: 0,
  },
  'sphincter-pupillae': {
    kk: { name: 'Қарашықты тарылтатын бұлшықет', s: 'Қарашықты айнала орналасқан сақина бұлшықет. Жарық күшті болса, жиырылып, қарашықты кішірейтеді.', w: 'Қарашық шамамен 2-ден 8 мм-ге дейін өзгереді — көзге түсетін жарық шамамен 16 есе көбейеді не азаяды.', v: '2–8 мм' },
    ru: { name: 'Мышца, сужающая зрачок', s: 'Кольцевая мышца вокруг зрачка. На ярком свету она сжимается и делает зрачок маленьким.', w: 'Зрачок меняется примерно от 2 до 8 мм — света в глаз попадает в 16 раз больше или меньше.', v: '2–8 мм' },
    en: { name: 'Pupil-narrowing muscle', s: 'A ring muscle around the pupil. In bright light it squeezes and makes the pupil small.', w: 'The pupil changes from about 2 to 8 mm — about 16 times more or less light gets in.', v: '2–8 mm' },
    f: 3,
  },
  'dilator-pupillae': {
    kk: { name: 'Қарашықты кеңейтетін бұлшықет', s: 'Нұрлы қабықтағы жіңішке «шабақтар». Қараңғыда тартылып, қарашықты кеңейтеді.', w: 'Оның талшықтары доңғалақ шабақтарындай небәрі 3–5 жұқа қабат болып жатады.', v: '3–5' },
    ru: { name: 'Мышца, расширяющая зрачок', s: 'Тонкие «спицы» в радужке. В темноте они тянут и делают зрачок широким.', w: 'Её волокна лежат всего в 3–5 тонких слоях, как спицы колеса.', v: '3–5' },
    en: { name: 'Pupil-widening muscle', s: 'Thin “spokes” inside the iris. In the dark they pull and make the pupil wide.', w: 'Its fibres lie in only 3–5 thin layers, like the spokes of a wheel.', v: '3–5' },
    f: 2,
  },
  'iris-vessels': {
    kk: { s: 'Нұрлы қабықтың шетіндегі артериялар сақинасы. Оны қанмен қоректендіреді.', w: 'Бұл сақина көбіне тұйықталмайды: артериялары ирелеңдеп жатады да, арасында саңылаулар қалады.', v: '' },
    ru: { s: 'Кольцо артерий у края радужки. Оно питает радужку кровью.', w: 'Это кольцо часто не замкнуто: его артерии идут спиралью и оставляют разрывы.', v: '' },
    en: { s: 'A ring of arteries at the edge of the iris that feeds it with blood.', w: 'The ring is often not closed: its arteries spiral and leave gaps.', v: '' },
    f: 4,
  },
  lens: {
    kk: { s: 'Қарашықтың артындағы мөлдір, иілгіш линза. Пішінін өзгертіп, жақынға да, алысқа да фокустайды.', w: 'Ені шамамен 9 мм, ал қалыңдығы 4 мм-ге де жетпейді.', v: '9,3 мм' },
    ru: { s: 'Прозрачная гибкая линза за зрачком. Меняет форму, чтобы наводить резкость вблизи и вдали.', w: 'Шириной около 9 мм, а толщиной меньше 4 мм.', v: '9,3 мм' },
    en: { s: 'A clear, bendy lens behind the pupil. It changes shape to focus near and far.', w: 'About 9 mm wide and less than 4 mm thick.', v: '9.3 mm' },
    f: 0,
  },
  zonules: {
    kk: { s: 'Көз бұршағын орнында ұстап тұратын жіңішке жіпшелер. Фокустау кезінде оны тартады.', w: 'Бүкіл көз бұршағын бірнеше жүз талшық қана ұстап тұрады.', v: '' },
    ru: { s: 'Тонкие нити, которые держат хрусталик на месте и тянут его при фокусировке.', w: 'Весь хрусталик держат всего несколько сотен волокон.', v: '' },
    en: { s: 'Thin threads that hold the lens in place and pull on it to focus.', w: 'Only a few hundred fibres hold the whole lens.', v: '' },
    f: 0,
  },
  'ciliary-body': {
    kk: { s: 'Нұрлы қабықтың артындағы бұлшықетті сақина. Көз бұршағының фокустауына көмектеседі және көздің ішіндегі мөлдір сұйықтықты шығарады.', w: 'Оның алдыңғы жағында 70-ке жуық ұсақ қатпар бар.', v: '70' },
    ru: { s: 'Мышечное кольцо за радужкой. Помогает хрусталику фокусироваться и вырабатывает прозрачную жидкость внутри глаза.', w: 'На его передней части около 70 крошечных складок.', v: '70' },
    en: { s: 'A muscle ring behind the iris. It helps the lens focus and makes the clear liquid inside the eye.', w: 'Its front has about 70 tiny folds.', v: '70' },
    f: 2,
  },
  sclera: {
    kk: { s: 'Көздің ағы — көзді қорғап, пішінін сақтайтын берік қабырға.', w: 'Бүкіл көз алмасының ені шамамен 24 миллиметр ғана.', v: '24 мм' },
    ru: { s: 'Белок глаза — прочная стенка, которая защищает глаз и держит его форму.', w: 'Всё глазное яблоко шириной всего около 24 миллиметров.', v: '24 мм' },
    en: { s: 'The white of the eye — a strong wall that protects it and keeps its shape.', w: 'The whole eyeball is only about 24 millimetres across.', v: '24 mm' },
    f: 3,
  },
  'anterior-ciliary-arteries': {
    kk: { s: 'Көз бұлшықеттерінің ішімен өтіп, көздің алдыңғы бөлігіне қан жеткізетін ұсақ артериялар.', w: 'Олардың саны — 7, бәрі төрт бұлшықеттің ішінде жасырынып жатады.', v: '7' },
    ru: { s: 'Маленькие артерии, которые идут внутри мышц глаза и приносят кровь к передней части глаза.', w: 'Их 7, и они спрятаны внутри четырёх мышц.', v: '7' },
    en: { s: 'Small arteries that run inside the eye muscles and bring blood to the front of the eye.', w: 'There are 7 of them, hidden inside four muscles.', v: '7' },
    f: 0,
  },
  'posterior-ciliary-arteries': {
    kk: { s: 'Көздің артқы жағына көру нервінің айналасынан кіретін ұсақ артериялар. Торлы қабықтың астындағы қою түсті қабатты қоректендіреді.', w: 'Бір көзде олар 10-нан 20-ға дейін болуы мүмкін.', v: '10–20' },
    ru: { s: 'Маленькие артерии, которые входят в заднюю часть глаза вокруг нерва и питают тёмный слой под сетчаткой.', w: 'В одном глазу их может быть от 10 до 20.', v: '10–20' },
    en: { s: 'Small arteries that enter the back of the eye around the nerve and feed the dark layer under the retina.', w: 'One eye can have 10 to 20 of them.', v: '10–20' },
    f: 1,
  },
  vitreous: {
    kk: { s: 'Көздің ішін толтырып тұрған мөлдір желе. Көздің домалақ пішінін сақтайды.', w: 'Көз көлемінің 80%-ына дейінгі бөлігін алады — шамамен 4 мл.', v: '80%' },
    ru: { s: 'Прозрачное желе, которое заполняет глаз изнутри и держит его круглым.', w: 'Занимает до 80% объёма глаза — около 4 мл.', v: '80%' },
    en: { s: 'A clear jelly that fills the inside of the eye and keeps it round.', w: 'It takes up to 80% of the eye’s volume — about 4 ml.', v: '80%' },
    f: 1,
  },
  retina: {
    kk: { s: 'Көздің артқы жағындағы жарық сезетін жұқа қабат. Жарықты миға баратын сигналға айналдырады.', w: 'Мұнда шамамен 92 миллион таяқша бар — ымыртта көруге көмектесетін жасушалар.', v: '92 млн' },
    ru: { s: 'Тонкий светочувствительный слой в глубине глаза. Превращает свет в сигналы для мозга.', w: 'В ней около 92 миллионов палочек — клеток, которые помогают видеть в сумерках.', v: '92 млн' },
    en: { s: 'A thin light-sensing layer at the back of the eye. It turns light into signals for the brain.', w: 'It holds about 92 million rods — the cells that help you see in dim light.', v: '92 mln' },
    f: 2,
  },
  macula: {
    kk: { s: 'Торлы қабықтың ортасындағы ең анық көретін жер. Кітап оқығанда дәл осымен қарайсыз.', w: 'Дәл ортасында бір шаршы миллиметрге 199 000-ға жуық құтыша сыйады.', v: '199 000' },
    ru: { s: 'Место в центре сетчатки, которое видит резче всего. Когда вы читаете, вы смотрите именно им.', w: 'В самом центре на одном квадратном миллиметре — около 199 000 колбочек.', v: '199 000' },
    en: { s: 'The spot in the middle of the retina that sees most sharply. You use it when you read.', w: 'At its very centre, about 199,000 cones fit in one square millimetre.', v: '199,000' },
    f: 3,
  },
  'optic-disc': {
    kk: { s: 'Көру нервінің көзден шығатын жері. Мұнда жарық сезетін жасуша жоқ, сондықтан әр көзде соқыр нүкте болады.', w: 'Бұл соқыр нүктенің ені 2 мм-ге де жетпейді.', v: '1,9 мм' },
    ru: { s: 'Место, где нерв выходит из глаза. Здесь нет светочувствительных клеток, поэтому в каждом глазу есть слепое пятно.', w: 'Это слепое пятно шириной меньше 2 мм.', v: '1,9 мм' },
    en: { s: 'The place where the nerve leaves the eye. There are no light-sensing cells here, so each eye has a blind spot.', w: 'This blind spot is less than 2 mm wide.', v: '1.9 mm' },
    f: 0,
  },
  'retinal-vessels': {
    kk: { s: 'Торлы қабықтың бетімен ағаш бұтақтарындай тарайтын қан тамырлары.', w: 'Бәрі небәрі 4 негізгі тармақтан басталады.', v: '4' },
    ru: { s: 'Сосуды, которые расходятся по сетчатке, как ветки дерева.', w: 'Все они начинаются всего с 4 главных ветвей.', v: '4' },
    en: { s: 'Blood vessels that spread over the retina like the branches of a tree.', w: 'They all start from just 4 main branches.', v: '4' },
    f: 0,
  },
  choroid: {
    kk: { s: 'Торлы қабықтың астындағы қан тамырларына толы қою түсті қабат. Жарық сезетін жасушаларды қоректендіреді.', w: 'Торлы қабыққа келетін қанның 65–85%-ын осы қабат жеткізеді.', v: '65–85%' },
    ru: { s: 'Тёмный слой, полный сосудов, под сетчаткой. Он питает светочувствительные клетки.', w: 'Он приносит 65–85% всей крови, которую получает сетчатка.', v: '65–85%' },
    en: { s: 'A dark layer full of blood vessels under the retina. It feeds the light-sensing cells.', w: 'It brings 65–85% of all the blood the retina gets.', v: '65–85%' },
    f: 2,
  },
  'vortex-veins': {
    kk: { s: 'Қою түсті қабаттан қанды жинап, көзден алып шығатын иірімді веналар.', w: 'Адамдардың көбінде әр көзде 4 не 5 иірімді вена болады.', v: '4–5' },
    ru: { s: 'Вены-«водовороты», которые собирают кровь из тёмного слоя и выводят её из глаза.', w: 'У большинства людей в каждом глазу 4 или 5 таких вен.', v: '4–5' },
    en: { s: 'Swirling veins that collect blood from the dark layer and carry it out of the eye.', w: 'Most people have 4 or 5 of them in each eye.', v: '4–5' },
    f: 0,
  },
  'optic-nerve': {
    kk: { s: 'Көздің көргенінің бәрін миға жеткізетін «кабель».', w: 'Ұзындығы шамамен 4 см, ал жуандығы 3–4 мм ғана.', v: '40–45 мм' },
    ru: { s: '«Кабель», который передаёт в мозг всё, что видит глаз.', w: 'Длиной около 4 см, а толщиной всего 3–4 мм.', v: '40–45 мм' },
    en: { s: 'The “cable” that carries everything the eye sees to the brain.', w: 'About 4 cm long and only 3–4 mm thick.', v: '40–45 mm' },
    f: 1,
  },
  'central-retinal-vessels': {
    kk: { s: 'Көру нервінің дәл ортасымен өтіп, торлы қабықты ішінен қоректендіретін артерия мен вена.', w: 'Артерия нервке көз алмасынан шамамен 1 см артта кіреді.', v: '~10 мм' },
    ru: { s: 'Артерия и вена, которые идут прямо по центру зрительного нерва и питают сетчатку изнутри.', w: 'Артерия входит в нерв примерно в 1 см позади глазного яблока.', v: '~10 мм' },
    en: { s: 'An artery and a vein that run through the very middle of the optic nerve and feed the retina from inside.', w: 'The artery enters the nerve about 1 cm behind the eyeball.', v: '~10 mm' },
    f: 0,
  },
  'ophthalmic-artery': {
    kk: { s: 'Көздің басты артериясы: көз алмасына келетін бүкіл қан осы арқылы өтеді.', w: 'Оның жуандығы шамамен 1,5 мм ғана.', v: '1,5 мм' },
    ru: { s: 'Главная артерия глаза: вся кровь для глазного яблока идёт через неё.', w: 'Толщиной она всего около 1,5 мм.', v: '1,5 мм' },
    en: { s: 'The eye’s main artery: all the blood for the eyeball comes through it.', w: 'It is only about 1.5 mm wide.', v: '1.5 mm' },
    f: 1,
  },
  'superior-rectus': {
    kk: { s: 'Көздің үстіндегі бұлшықет. Көзді жоғары бұрады.', w: 'Мөлдір қабықтың шетінен шамамен 7,7 мм қашықтықта бекиді — тік бұлшықеттердің ішіндегі ең алысы.', v: '7,7 мм' },
    ru: { s: 'Мышца сверху глаза. Поворачивает глаз вверх.', w: 'Крепится примерно в 7,7 мм от края роговицы — дальше всех прямых мышц.', v: '7,7 мм' },
    en: { s: 'The muscle on top of the eye. It turns the eye up.', w: 'It attaches about 7.7 mm from the edge of the cornea — farther than any other straight muscle.', v: '7.7 mm' },
    f: 0,
  },
  'inferior-rectus': {
    kk: { s: 'Көздің астындағы бұлшықет. Көзді төмен бұрады.', w: 'Ол көзді көру сызығына 23° бұрышпен тартады.', v: '23°' },
    ru: { s: 'Мышца снизу глаза. Поворачивает глаз вниз.', w: 'Она тянет глаз под углом 23° к линии взгляда.', v: '23°' },
    en: { s: 'The muscle under the eye. It turns the eye down.', w: 'It pulls at an angle of 23° to the line of sight.', v: '23°' },
    f: 1,
  },
  'medial-rectus': {
    kk: { s: 'Мұрын жақтағы бұлшықет. Көзді мұрынға қарай бұрады.', w: 'Тік бұлшықеттердің ішінде сіңірі ең қысқа — шамамен 4,5 мм.', v: '4,5 мм' },
    ru: { s: 'Мышца со стороны носа. Поворачивает глаз к носу.', w: 'У неё самое короткое сухожилие из прямых мышц — около 4,5 мм.', v: '4,5 мм' },
    en: { s: 'The muscle on the nose side. It turns the eye towards the nose.', w: 'It has the shortest tendon of the straight muscles — about 4.5 mm.', v: '4.5 mm' },
    f: 1,
  },
  'lateral-rectus': {
    kk: { s: 'Құлақ жақтағы бұлшықет. Көзді сыртқа қарай бұрады.', w: 'Көзді шамамен 12 мм бойы орап жатады — басқа тік бұлшықеттердің бәрінен көп.', v: '12 мм' },
    ru: { s: 'Мышца со стороны уха. Поворачивает глаз наружу.', w: 'Она обхватывает глаз на протяжении около 12 мм — больше всех прямых мышц.', v: '12 мм' },
    en: { s: 'The muscle on the ear side. It turns the eye outwards.', w: 'It wraps around the eye for about 12 mm — more than any other straight muscle.', v: '12 mm' },
    f: 1,
  },
  'superior-oblique': {
    kk: { s: 'Көздің ең ұзын бұлшықеті. Сіңірі блоктағы арқандай кішкентай ілмектен өтеді де, көзді ішке қарай бұрап, төмен қаратады.', w: 'Сіңірінің ұзындығы шамамен 26 мм — көз бұлшықеттерінің ішінде ең ұзыны.', v: '26 мм' },
    ru: { s: 'Самая длинная мышца глаза. Её сухожилие проходит через крошечную петлю, как верёвка через блок, поворачивает глаз вниз и закручивает его внутрь.', w: 'Её сухожилие длиной около 26 мм — самое длинное из всех мышц глаза.', v: '26 мм' },
    en: { s: 'The longest eye muscle. Its tendon runs through a tiny loop, like a rope through a pulley, twists the eye inwards and turns it down.', w: 'Its tendon is about 26 mm long — the longest of all the eye muscles.', v: '26 mm' },
    f: 1,
  },
  'inferior-oblique': {
    kk: { s: 'Көз ұясының алдыңғы жағынан басталатын жалғыз көз бұлшықеті. Көзді жоғары және сыртқа бұруға көмектеседі.', w: 'Оның сіңірі жоқтың қасы: 0–1 мм ғана.', v: '0–1 мм' },
    ru: { s: 'Единственная мышца глаза, которая начинается у передней части глазницы. Помогает поворачивать глаз вверх и наружу.', w: 'Сухожилия у неё почти нет: всего 0–1 мм.', v: '0–1 мм' },
    en: { s: 'The only eye muscle that starts at the front of the eye socket. It helps turn the eye up and out.', w: 'It has almost no tendon: just 0–1 mm.', v: '0–1 mm' },
    f: 1,
  },
};
