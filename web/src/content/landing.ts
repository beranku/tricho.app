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
  brandName: 'Tricho.app',
  brandVersion: 'v0.9 · v přípravě',
  navLinks: [
    { label: 'Blog', href: '/blog' },
    { label: 'Nápověda', href: '/help' },
    { label: 'Plány', href: '#plany' },
  ],
  themeToggleLabel: 'Přepnout motiv',
  ctaLabel: 'Požádat o pozvánku',
  ctaHref: '#pozvanka',
};

export const inviteForm = {
  // `label` is rendered visually-hidden for screen readers — the placeholder
  // and the surrounding section copy carry the visual context.
  label: 'Tvůj e-mail',
  placeholder: 'tvůj@email.cz',
  submitLabel: 'Požádat o pozvánku',
  helper: 'Pošleme ti pozvánku, jakmile uvolníme místo.',
  successMessage: 'Díky! Ozveme se ti.',
  errorMessage: 'Něco se pokazilo. Napiš nám na ahoj@tricho.app.',
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
  eyebrow: 'Pro samostatné tricholožky a kadeřnice',
  // Title is rendered as raw HTML (set:html) so <em> can flip to italic teal.
  titleHtml: 'Karta klientky,<br>která si <em>pamatuje za tebe</em>.',
  lede: 'Anamnéza, alergeny, fotky pokožky, co jste minule zkoušely, kdy přijde příště. Všechno o jedné klientce na jednom místě, v telefonu.',
  // Hero renders <InviteForm /> instead of a single CTA button while the
  // app is invite-only.
  meta: ['iPhone i Android', 'Bez platební karty'],
};

export const twoScreens = {
  num: '01',
  titleHtml: 'Aplikace má <em>dvě obrazovky</em>.',
  sub: 'Diář a karta klientky',
  introHtml:
    'V diáři vidíš, koho čekáš a v kolik. Z jejího jména otevřeš její <em>kartu</em> — anamnéza, alergeny, fotky před a po, co jste minule zkoušely.',
  diar: {
    label: 'Obrazovka 1 — Diář',
    title: 'Co máš dnes a co bylo',
    text: 'Nahoře je dnešek, pak zítřek, pak zbytek týdne. A když si chceš vzpomenout na loňský duben, odscrolluješ tam.',
  },
  karta: {
    label: 'Obrazovka 2 — Karta klientky',
    title: 'Všechno o ní pohromadě',
    text: 'Jedna obrazovka, na které najdeš všechno odshora dolů. Bez záložek, bez prokliků.',
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
    'Aplikaci píšeme v malém českém týmu podle toho, jak Ludmila pracuje. Proto v ní nenajdeš grafy, statistiky ani „doporučení od AI". <em>Karta klientky, diář — a ticho.</em>',
};

export const privacy = {
  num: '03',
  titleHtml: 'Co ti řekne klientka,<br>zůstane <em>mezi vámi</em>.',
  prose: [
    {
      kind: 'normal' as const,
      html: 'Tvoje záznamy se zašifrují rovnou v telefonu, dřív než cokoli odejde ven. Šifrovací klíč ti telefon vytvoří z tvého hesla a ven se nedostane.',
    },
    {
      kind: 'lift' as const,
      html: 'K datům se nedostane nikdo. <em>Ani my, ani hacker, ani úřad.</em>',
    },
    {
      kind: 'normal' as const,
      html: 'A co když zapomeneš heslo a nemáš zálohu? Data jsou pryč. Neumíme je obnovit — to není chyba, je to ten důvod, proč to funguje. Proto je v každém plánu, <span class="hand-soft">i v tom zdarma</span>, šifrovaná záloha do souboru. Schováš si ji.',
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
  titleHtml: 'Aplikace zdarma.<br><em>Synchronizace volitelná.</em>',
  sub: 'Free / Pro / Max',
  free: {
    label: 'Aplikace',
    titleHtml: 'Bez <em>háčku</em>.',
    text: 'Bez omezení počtu klientek, bez časového limitu. Žádný „trial", po kterém se zamknou funkce. Co máš teď, máš napořád.',
    ctaLabel: 'Požádat o pozvánku',
    ctaHref: '#pozvanka',
    features: [
      'Tolik klientek a termínů, kolik potřebuješ',
      'Diář a karta klientky',
      'Fotky před a po',
      'Šifrování přímo v telefonu',
      'Záloha do souboru',
    ],
  },
  plansIntro: {
    label: 'Když chceš víc',
    titleHtml: 'Synchronizace mezi zařízeními a <em>záloha v cloudu</em>.',
    text: 'Hodí se ti, když pracuješ na víc zařízeních nebo nechceš řešit zálohy ručně.',
  },
  plans: [
    {
      name: 'Pro',
      amount: '299 Kč',
      period: '/rok',
      tag: 'Pro telefon a tablet. Záloha rok zpátky.',
      features: [
        '<strong>2 zařízení</strong>',
        'Zálohy v cloudu — <strong>12 měsíců zpětně</strong>',
        'Synchronizace mezi zařízeními',
        'Obnova při výměně telefonu',
      ],
      microcopy: 'Vyjde to na 25 Kč měsíčně. Platíš jednou ročně.',
    },
    {
      name: 'Max',
      amount: '499 Kč',
      period: '/rok',
      tag: 'Pro víc zařízení a dlouhou paměť.',
      features: [
        '<strong>5 zařízení</strong>',
        'Zálohy v cloudu — <strong>5 let zpětně</strong>',
        'Synchronizace mezi zařízeními',
        'Obnova při výměně telefonu',
      ],
      microcopy: 'Pro někoho přebytek, pro jiného přesně to, co potřebuje.',
    },
  ],
  fineprint: 'Když přestaneš platit, vrátíš se na Free plán a data zůstanou s tebou.',
};

export const voices = {
  num: '05',
  titleHtml: 'Co říkají <em>kolegyně</em>.',
  sub: 'Trichologky a kadeřnice, ČR a SR',
  testimonials: [
    {
      quoteHtml:
        'Klientka přijde po půl roce a chce „přesně to samé jako minule". <em>Dřív jsem chvíli vzpomínala, teď to mám rozkliknuté za dvě vteřiny.</em>',
      initials: 'MN',
      name: 'Marie Nováková',
      role: 'Kadeřnice a trichologyně, Brno',
    },
    {
      quoteHtml:
        'Bála jsem se, že se budu zase něco učit. <em>Naťukala jsem první klientku do minuty.</em>',
      initials: 'JK',
      name: 'Jana Kratochvílová',
      role: 'Trichologyně, Olomouc',
    },
    {
      quoteHtml:
        'Klientky mi posílají hormonální profily, fotky pokožky, zdravotní zprávy. <em>Nemůžu to mít válet v galerii vedle dovolené.</em>',
      initials: 'PS',
      name: 'Petra Svobodová',
      role: 'Kadeřnice, Pardubice',
    },
  ],
  fineprint:
    'Tricho zatím testujeme s pár trichologkami a kadeřnicemi z ČR a SR. Citace jsou jejich, fotky doplníme, až aplikaci spustíme veřejně.',
};

export const faq = {
  num: '06',
  titleHtml: 'Otázky, které <em>chodí</em>.',
  sub: 'Co se ptáte nejčastěji',
  items: [
    {
      question: 'Zapomněla jsem heslo. Co teď?',
      answerHtml:
        'Když nemáš zálohu, jsou data pryč. Heslo neumíme obnovit — neznáme ho a vědomě ani neuchováváme. Proto je v každém plánu, <strong>i ve Free</strong>, šifrovaná záloha do souboru. Schováš si ji do iCloudu, na flashku, do e-mailu — kam chceš. V Pro a Max plánu se zálohy ukládají do cloudu samy.',
    },
    {
      question: 'Wifi v salonu jde a nejde. Tricho mi vypadne?',
      answerHtml:
        'Ne. Tricho funguje offline. Otevřeš kartu, zapíšeš poznámku, zavřeš. Až přijde signál a máš zapnutý sync, samo se srovná s druhým zařízením.',
    },
    {
      question: 'Klientky mi posílají citlivé věci. Je to opravdu jen u mě?',
      answerHtml:
        'Ano. Tricho šifruje data přímo v tvém telefonu a klíč nikam neposílá. Ani my jako provozovatel se k těm datům nedostaneme — kdybychom se podívali na server, vidíme jen šum.',
    },
    {
      question: 'A GDPR? Můžu to klientce ukázat ve smlouvě?',
      answerHtml:
        'Můžeš. U klientek pracuješ s údaji o zdraví — to je čl. 9 GDPR a Tricho je postavené tak, aby tobě i klientce zaručilo, že data vidíš jen ty. Hostujeme v EU, šifrujeme E2E, neprodáváme nikomu. Šablonu DPA si stáhneš v patičce.',
    },
    {
      question: 'Free napořád — fakt napořád, nebo „dokud to nezměníme"?',
      answerHtml:
        'Napořád. Žádný trial, žádné automatické přepnutí, žádná kreditka při registraci. Když někdy budeš chtít synchronizaci nebo cloudové zálohy, koupíš si Pro. Free plán si můžeš nechat klidně deset let.',
    },
    {
      question: 'Co když Tricho v roce 2030 zanikne?',
      answerHtml:
        'Stáhneš si data v <code>JSON</code> souboru. Otevřený formát — můžeš si je nahrát jinam, nebo si je nechat ležet na disku. V Tricho tě nikdo nedrží.',
    },
    {
      question: 'Mám iPhone. Funguje to?',
      answerHtml:
        'Funguje. V Safari otevřeš tricho.app, klepneš na <strong>↑ Sdílet</strong> → „Přidat na plochu". Hotovo — od té chvíle Tricho otevíráš ze své plochy jako každou jinou aplikaci. iOS má jedno omezení: synchronizace běží jen, když je aplikace otevřená.',
    },
    {
      question: 'Můžou si u mě klientky samy rezervovat?',
      answerHtml:
        'Ne — a vědomě. Tricho je sešit, ne rezervační systém. Když potřebuješ veřejné rezervace pro klientky, dál používej Reservio nebo Booksy a Tricho měj vedle nich na evidenci. Většině kolegyň takhle stačí.',
    },
  ],
};

export const finalCta = {
  titleHtml: 'Začni s <em>další klientkou</em>.',
  lede: 'Staré poznámky nech v sešitě. První návštěvu, která ti přijde, zapiš do Tricha — a uvidíš, jestli ti sedne.',
  // FinalCta renders <InviteForm /> in place of the old button — kept here
  // for any consumers that still want a fallback link target.
  ctaLabel: 'Požádat o pozvánku',
  ctaHref: '#pozvanka',
  riskReversal:
    'Bez platební karty. Když ti to nesedne, smažeš účet jedním klepnutím a data si vezmeš s sebou.',
  micro: 'iPhone i Android · iPad i tablet · Funguje i v prohlížeči na PC',
};

export const footer = {
  brandName: 'Tricho.app',
  brandVersion: 'v0.9 · v přípravě',
  tagline:
    'Sešit pro tricholožky a kadeřnice. Postavený v Česku, hostovaný v EU.',
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
  versionTag: 'v0.9 · v přípravě',
};
