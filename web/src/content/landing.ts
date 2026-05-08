// Locked Czech copy for the landing page. Mirror of
// prototypes/landing-page-prototype/COPY.md. Edit copy here, not in
// components. Strings that contain `<em>` / `<strong>` / `<code>` / `<span>`
// are rendered via `set:html`; treat them as trusted authored markup.

export const siteMeta = {
  title: 'Tricho.app — Karta klientky, která si pamatuje za tebe',
  description:
    'Aplikace pro samostatné tricholožky a kadeřnice. Anamnéza, alergeny, fotky pokožky, historie návštěv — všechno na jednom místě, v telefonu. Šifrované, offline, zdarma.',
  lang: 'cs',
};

// Tricho.app is currently invite-only. Every CTA on the landing now points
// to #pozvanka — the anchor of the FinalCta section, which renders the
// invite-request form (InviteForm.astro). Hero renders the form inline too.
export const header = {
  brandName: 'Tricho',
  brandKicker: '.app',
  brandVersion: 'v přípravě',
  navLinks: [
    { label: 'Blog', href: '/blog' },
    { label: 'Nápověda', href: '/help' },
    { label: 'Plány', href: '#plany' },
  ],
  themeToggleLabel: 'Přepnout motiv',
  ctaLabel: 'Požádat o pozvánku',
  ctaLabelShort: 'To chci',
  ctaHref: '#pozvanka',
};

export const inviteForm = {
  // `label` is rendered visually-hidden for screen readers — the placeholder
  // and the surrounding section copy carry the visual context.
  label: 'Tvůj e-mail',
  placeholder: 'tvůj@email.cz',
  submitLabel: 'Požádat o pozvánku',
  helper: 'Pozvánku obdržíš, jakmile na tebe přijde řada. Brzy.',
  successMessage: 'Díky! Ozveme se ti.',
  errorMessage: 'Něco se pokazilo. Napiš nám na ahoj@tricho.app.',
  choice: {
    legend: 'Chci se zapojit do testování',
    testing: 'Chci pomoct testovat, dej mi přístup co nejdřív',
    wait: 'Dej mi vědět, až bude hotová verze',
  },
};

export type PhoneSlot =
  | {
      kind: 'booking';
      time: string;
      name: string;
      subtitle: string;
      status?: 'done' | 'active' | 'default';
    }
  | {
      kind: 'free';
      time: string;
      freeText: string;
    };

export const phoneDiar = {
  status: { time: '9:41' },
  dayHeader: {
    weatherIcon: true,
    kicker: 'Dnes',
    temperature: '15°',
    main: '22. dubna',
  },
  slots: [
    { kind: 'booking', time: '09:10', name: 'Jana Nováková', subtitle: 'Konzultace, Diagnostika', status: 'done' },
    { kind: 'booking', time: '10:30', name: 'Klára Dvořáková', subtitle: 'Diagnostika · zbývá 45 min', status: 'active' },
    { kind: 'free', time: '11:30', freeText: 'volno 1 h 30 min' },
    { kind: 'booking', time: '14:00', name: 'Tereza Malá', subtitle: 'Střih' },
    { kind: 'booking', time: '15:30', name: 'Adam Kříž', subtitle: 'Trichologický zákrok' },
  ] as PhoneSlot[],
  divider: { label: 'Zítra', main: '23. dubna' },
  tomorrow: [
    { kind: 'booking', time: '10:00', name: 'Markéta Holá', subtitle: 'Diagnostika' },
  ] as PhoneSlot[],
};

export const phoneDiarMini = {
  ...phoneDiar,
  // Mini variant trims one of the bookings on Diagnostika to fit short height.
  dayHeader: { weatherIcon: false, kicker: 'Dnes', temperature: '', main: '22. dubna' },
  slots: [
    { kind: 'booking', time: '09:10', name: 'Jana Nováková', subtitle: 'Diagnostika', status: 'done' },
    { kind: 'booking', time: '10:30', name: 'Klára Dvořáková', subtitle: 'Diagnostika · zbývá 45 min', status: 'active' },
    { kind: 'free', time: '11:30', freeText: 'volno 1 h 30 min' },
    { kind: 'booking', time: '14:00', name: 'Tereza Malá', subtitle: 'Střih' },
    { kind: 'booking', time: '15:30', name: 'Adam Kříž', subtitle: 'Trichologický zákrok' },
  ] as PhoneSlot[],
};

// Production-fidelity client data used by the real-look ContentClientReal
// component. Mirrors the shape rendered by app/src/components/islands/
// ClientDetail.tsx (active-appointment summary, services + products chips,
// Patrick-Hand note, next-term row, three thumbnail angles).
export const realClient = {
  time: '10:32',
  clientName: 'Klára Dvořáková',
  serviceLabel: 'Diagnostika',
  allergen: 'Amoniak',
  remainingLabel: 'zbývá 45 min',
  thumbs: [
    { label: 'Před', angle: 'before' as const },
    { label: 'Detail', angle: 'detail' as const },
    { label: 'Po', angle: 'after' as const },
  ],
  services: ['Diagnostika', 'Konzultace', 'Trichologický zákrok'],
  products: ['Minoxidil 5 %', 'Šampon Trico'],
  note: 'Přechází z barvení s amoniakem. Prosí přírodnější přípravky a víc fotek pokožky před zákrokem.',
  nextTermLabel: '14. 5. — Konzultace',
  labels: {
    services: 'Služby',
    products: 'Produkty',
    note: 'Poznámka',
    nextTerm: 'Příští termín',
  },
};

export const phoneKartaKlientky = {
  status: { time: '10:32' },
  client: {
    name: 'Klára Dvořáková',
    meta: '42 let · klientka od 2023',
  },
  tags: ['Amoniak', 'PPD', 'Citlivá pokožka'],
  diagnostika: 'Difuzní řídnutí ve frontální oblasti. Začáteční fáze AGA. Doporučeno minoxidil 5 %.',
  history: [
    { date: '22. 4.', what: 'Diagnostika' },
    { date: '14. 4.', what: 'Konzultace' },
    { date: '28. 3.', what: 'Trichologický zákrok' },
    { date: '11. 3.', what: 'Konzultace' },
  ],
  photos: [
    { label: '28.3.' },
    { label: '22.4.' },
  ],
};

export const hero = {
  eyebrow: 'Chytrý zápisník tricholožky',
  // Title is rendered as raw HTML (set:html) so <em> can flip to italic teal.
  titleHtml: 'Karta klientky.<br><em>Pamatuje si</em><br> za tebe.',
  ledeHtml: 'Fotky pokožky, anamnéza, alergeny, co jste řešili minule, kdy přijde příště. Všechno o jedné klientce na jednom místě, offline v telefonu.',
  // Hero renders <InviteForm /> instead of a single CTA button while the
  // app is invite-only.
  meta: ['iPhone i Android', 'Bez platební karty'],
};

export const twoScreens = {
  num: '01',
  titleHtml: 'Aplikace má <em>dvě obrazovky</em>.',
  sub: 'Diář a kartu',
  introHtml:
    'V diáři vidíš, koho čekáš a v kolik. Kliknitím na jméno otevřeš <em>kartu</em> — fotky před a po, anamnéza, alergeny, co jste řešili minule.',
  diar: {
    label: 'Obrazovka 1 — Diář',
    title: 'Co máš dnes, co bylo a co bude',
    text: 'Nahoře je dnešek, pak zítřek, pak zbytek týdne. A když si chceš vzpomenout na loňský duben, jsi tam raz dva.',
  },
  karta: {
    label: 'Obrazovka 2 — Karta klientky',
    title: 'Všechno pohromadě',
    text: 'Jediná obrazovka, na které najdeš všechno odshora dolů. Bez záložek, bez prokliků.',
  },
};

export const story = {
  num: '02',
  titleHtml: 'Aplikace, jakou Lída <em>potřebovala</em>.',
  sub: 'Tricholožka · Pardubice · 8 let praxe',
  quotes: [
    'Vedu si kartotéku osm let. Začínala jsem na papírových kartičkách v zamykatelné skříňce — pak v Excelu, pak ve fotkách v galerii.',
    'Žádná aplikace neuměla to, co jsem potřebovala. <em>Tak jsme si ji udělali.</em>',
  ],
  authorName: 'Ludmila Beránková',
  authorRole: 'Tricholožka, Pardubice',
  videoLabel: 'Ukázka',
  videoDuration: '75 vteřin',
  videoAriaPlay: 'Přehrát video',
  videoPlaceholderTag: '[ Video Ludmily — placeholder ]',
  manifestoHtml:
    'Aplikaci píšeme v malém českém týmu podle toho, jak Ludmila pracuje. Proto v ní nenajdeš grafy, statistiky ani „doporučení od AI". <em>Karta, diář — klid.</em>',
};

export const privacy = {
  num: '03',
  titleHtml: 'Co ti řekne klientka,<br>zůstane <em>mezi vámi</em>.',
  prose: [
    {
      kind: 'normal' as const,
      html: 'Tvoje záznamy se zašifrují rovnou v telefonu, dřív než se uloží. Šifrovací klíč ti telefon vytvoří a předá.',
    },
    {
      kind: 'lift' as const,
      html: 'K datům se nedostane nikdo.<br>Ani hacker, <em>ani my …</em>',
    },
    {
      kind: 'normal' as const,
      html: 'A když ztratíš klíč? Data jsou pryč. Neumíme je obnovit — to není chyba, to je důvod, proč to funguje. Pro případ ztráty nebo výměny telefonu můžeš využít šifrované zálohy.',
    },
  ],
  pillars: [
    {
      label: 'Vždycky můžeš odejít.',
      html: 'Svoje data si kdykoli stáhneš v <code>JSON</code> souboru a jdeš s nimi jinam.',
    },
    {
      label: 'Funguje offline.',
      html: 'Kartu otevřeš i bez signálu. Až budeš online, srovná se sama.',
    },
    {
      label: 'Bez App Store.',
      html: 'Otevřeš v prohlížeči, přidáš na plochu — a chová se jako každá jiná aplikace.',
    },
  ],
};

export const pricing = {
  num: '04',
  titleHtml: 'Aplikace zdarma. Tečka.',
  sub: 'Free',
  free: {
    label: 'Aplikace',
    titleHtml: 'Bez <em>háčku</em>.',
    text: 'Bez omezení počtu klientek, bez časového limitu. Žádný „trial", po kterém se zamknou funkce. Co máš teď, máš napořád.',
    ctaLabel: 'Požádat o pozvánku',
    ctaHref: '#pozvanka',
    features: [
      'Tolik klientek i termínů, kolik potřebuješ',
      'Šifrování přímo v telefonu',
      'Diář a karta klientky',
      'Zálohy do souboru',
      'Funguje plně bez připojení',
    ],
  },
  plansIntro: {
    label: '05',
    titleHtml: 'Když chceš víc.<br><em>Synchronizace</em> mezi zařízeními <em>a záloha</em> v cloudu.',
    text: 'Pro  /  Max',
  },
  plans: [
    {
      name: 'Pro',
      amount: '299 Kč',
      period: '/rok',
      tag: 'Pro telefon a tablet. Záloha rok zpátky.',
      features: [
        '<strong>2 zařízení</strong> v synchronizaci',
        'Automatické šifrované zálohy v cloudu',
        'Zálohy fotek<strong> 12 měsíců zpětně</strong>',
        'Neomezené zálohy diáře a návštěv',
        'Snadná obnova při výměně telefonu',
      ],
      microcopy: 'Vyjde to na 25 Kč měsíčně. Platíš jednou ročně.',
    },
    {
      name: 'Max',
      amount: '999 Kč',
      period: '/rok',
      tag: 'Pro víc zařízení a dlouhou paměť.',
      features: [
        '<strong>5 zařízení</strong> v synchronizaci',
        'Automatické šifrované zálohy v cloudu',
        'Zálohy fotek<strong> 5 let zpětně</strong>',
        'Neomezené zálohy diáře a návštěv',
        'Snadná obnova při výměně telefonu',
      ],
      microcopy: 'Pro někoho luxus, pro jiného přesně to, co potřebuje.',
    },
  ],
  fineprint: 'Když předplatné ukončíš, aplikace i data ti zůstanou.',
};

export const voices = {
  num: '05',
  titleHtml: 'Co říkají <em>kolegyně</em>.',
  sub: 'Tricholožky a kadeřnice, ČR a SR',
  testimonials: [
    {
      quoteHtml:
        'Klientka přijde po půl roce a chce ‚přesně to samé jako minule‘. <em>Dřív jsem chvíli vzpomínala, teď to mám rozkliknuté za dvě vteřiny.</em>',
      initials: 'MN',
      name: 'Marie Nováková',
      role: 'Kadeřnice a tricholožka, Brno',
    },
    {
      quoteHtml:
        'Bála jsem se, že se budu zase něco učit. <em>První záznam návštěvy jsem zvládla do minuty.</em>',
      initials: 'JK',
      name: 'Jana Kratochvílová',
      role: 'Kadeřnice, Olomouc',
    },
    {
      quoteHtml:
        'Klientky mi posílají hormonální profily, fotky pokožky, zdravotní zprávy. <em>Nemůžu to válet v galerii vedle fotek z dovolené.</em>',
      initials: 'PS',
      name: 'Petra Svobodová',
      role: 'Tricholožka, Praha',
    },
  ],
  fineprint:
    'Tricho.app zatím testujeme s pár tricholožkami a kadeřnicemi. Zapojíš se?',
};

export const faq = {
  num: '06',
  titleHtml: 'Otázky, a <em>odpovědi</em>.',
  sub: 'Co se ptáte nejčastěji',
  items: [
    {
      question: 'Wifi v salonu jde a nejde. Tricho.app mi vypadne?',
      answerHtml:
        'Nevypadne. Tricho.app funguje plně offline. Otevřeš kartu, zapíšeš poznámku, zavřeš. S aktivovanou synchronizací se to samo srovná s druhým zařízením jakmile bude signál.',
    },
    {
      question: 'Klientky mi posílají citlivé věci. Je to opravdu jen u mě?',
      answerHtml:
        'Ano. Tricho.app šifruje data přímo ve tvém telefonu a klíč nikam neposílá. Ani my jako provozovatel se k těm datům nedostaneme — na serveru je jen rozsypaný čaj a kávová sedlina.',
    },
    {
      question: 'A GDPR? Můžu to klientce zaručit ve smlouvě?',
      answerHtml:
        'Můžeš. U klientek pracuješ s údaji o zdraví, tedy s citlivými osobními údaji podle čl. 9 GDPR. Tricho.app je postavená tak, aby tobě i klientce zaručila, že údaje vidíš jen ty. Data šifrujeme end-to-end, hostujeme v EU, neprodáváme nikomu.',
    },
    {
      question: 'Free napořád — fakt napořád, nebo „dokud to nezměníme"?',
      answerHtml:
        'Napořád. Žádný trial, žádné automatické přepnutí, žádná kreditka při registraci. Když někdy budeš chtít synchronizaci nebo automatické zálohy, koupíš si Pro. Appku si můžeš nechat zdarma klidně deset let.',
    },
    {
      question: 'Co když Tricho.app zanikne?',
      answerHtml:
        'Myslíš, až Skynet převzme nadvládu? Stáhneš si fotky i data v otevřeném formátu — můžeš si je nahrát jinam, nebo si je nechat ležet na disku. V Tricho.app tě nikdo nedrží.',
    },
    {
      question: 'Mám iPhone. Funguje to?',
      answerHtml:
        'Funguje. V Safari klepneš na <strong>↑ Sdílet</strong>, pak na <strong>Přidat na plochu</strong>. Hotovo — od té chvíle Tricho.app otevíráš ze své plochy jako každou jinou aplikaci. iOS má jedno omezení: automatická synchronizace běží jen, když je aplikace otevřená.',
    },
    {
      question: 'Můžou se u mě klientky samy rezervovat?',
      answerHtml:
        'Ne. Tricho.app je zápisník, ne rezervační systém. <span class="hand-soft">Zatím.</span>',
    },
  ],
};

export const finalCta = {
  titleHtml: 'Začni s <em>další klientkou</em>.',
  ledeHtml: 'Otevři Tricho.app, staré poznámky vyfoť a rovnou zaznamenej aktuální návštěvu.',
  // FinalCta renders <InviteForm /> in place of the old button — kept here
  // for any consumers that still want a fallback link target.
  ctaLabel: 'Požádat o pozvánku',
  ctaHref: '#pozvanka',
  riskReversal:
    'Žádný spam. Když si to rozmyslíš, jeden klik a tvůj e-mail u nás nezůstane.',
  micro: 'iPhone i Android · iPad i tablet · Funguje i v prohlížeči na PC',
};

export const footer = {
  brandName: 'Tricho.app',
  brandVersion: 'v přípravě',
  tagline:
    'Chytrý zápisník pro tricholožky a kadeřnice. Postavený v Česku, hostovaný v EU.',
  columns: [
    {
      title: 'Produkt',
      links: [
        { label: 'Plány', href: '#plany' },
        { label: 'Soukromí', href: '#' },
        { label: 'Nápověda', href: '/help' },
        { label: 'Blog', href: '/blog' },
      ],
    },
    {
      title: 'Právní',
      links: [
        { label: 'GDPR', href: '/gdpr' },
        { label: 'Podmínky', href: '/podminky' },
        { label: 'Cookies', href: '/cookies' },
      ],
    },
    {
      title: 'Kontakt',
      links: [
        { label: 'ahoj@tricho.app', href: 'mailto:ahoj@tricho.app' },
        { label: 'O nás', href: '/o-nas' },
      ],
    },
  ],
  copyright: '© 2026 Tricho.app · Praha, EU',
  versionTag: 'hlavně jednoduše',
};
