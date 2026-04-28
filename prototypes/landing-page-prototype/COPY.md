# Copy — Tricho.app landing page

> Veškerý český copy stránky. **Tento soubor je pravda.** Při rozporu s `landing-page.html` má `COPY.md` přednost (zde mohou být pozdější opravy).

> **Konvence:**
> - `*kurzíva*` v Markdown = `<em>` v HTML = **italic v teal-700** (signature emphasis)
> - `**tučné**` v Markdown = `<strong>` v HTML, použito hlavně v plánech a FAQ pro klíčová čísla/fráze
> - `<hand>...</hand>` = inline span s Patrick Hand fontem (ručně psaný akcent)
> - `<code>JSON</code>` = mono inline code
> - `↑ Sdílet` = symbol „nahoru/sdílet" v iOS UI, znak `↑`

---

## Site meta

- **Title:** `Tricho.app — Karta klientky, která si pamatuje za tebe`
- **Description:** `Aplikace pro samostatné tricholožky a kadeřnice. Anamnéza, alergeny, fotky pokožky, historie návštěv — všechno na jednom místě, v telefonu. Šifrované, offline, zdarma.`
- **OG title:** stejné jako title
- **OG description:** stejné jako description
- **Lang:** `cs`

---

## Header (sticky nav)

- **Brand:** `Tricho.app`
- **Brand version (vedle loga):** `v0.9 · v přípravě`
- **Nav links:** Blog · Nápověda · Plány
- **CTA button:** `Začít zdarma`
- **Theme toggle aria-label:** `Přepnout motiv`

---

## Hero

- **Eyebrow:** `Pro samostatné tricholožky a kadeřnice`

- **H1:**
  > Karta klientky,
  > která si *pamatuje za tebe*.

- **Lede:**
  > Anamnéza, alergeny, fotky pokožky, co jste minule zkoušely, kdy přijde příště. Všechno o jedné klientce na jednom místě, v telefonu.

- **CTA:** `Začít zdarma`

- **Meta řada (mono labely):**
  - `iPhone i Android`
  - `Bez platební karty`

### Phone mockup obsah (Diář)

- Status bar: `9:41`, signal + battery ikony
- Header: `Dnes 15°` + `22. dubna`
- Sloty (čas / jméno / typ / stav):
  - `09:10 — Jana Nováková — Konzultace, Diagnostika — ✓ done`
  - `10:30 — Klára Dvořáková — Diagnostika · zbývá 45 min — active`
  - `11:30 — volno 1 h 30 min — +`  *(volno = Patrick Hand, "+" = Caveat copper)*
  - `14:00 — Tereza Malá — Střih`
  - `15:30 — Adam Kříž — Trichologický zákrok`
- Divider: `Zítra` + `23. dubna`
- Slot: `10:00 — Markéta Holá — Diagnostika`

---

## Sekce 01 — Dvě obrazovky

- **Section num:** `01`
- **H2:** Aplikace má *dvě obrazovky*.
- **Section sub:** `Diář a karta klientky`

- **Intro:**
  > V diáři vidíš, koho čekáš a v kolik. Z jejího jména otevřeš její *kartu* — anamnéza, alergeny, fotky před a po, co jste minule zkoušely.

### Mini phone 1 — Diář
*(zkrácená verze hlavního mockupu, viz HTML)*

- **Label:** `Obrazovka 1 — Diář`
- **H3:** Co máš dnes a co bylo
- **Popis:**
  > Nahoře je dnešek, pak zítřek, pak zbytek týdne. A když si chceš vzpomenout na loňský duben, odscrolluješ tam.

### Mini phone 2 — Karta klientky

Obsah karty (mockup, ne copy stránky):
- Header: `Klára Dvořáková` + `42 let · klientka od 2023`
- Tagy alergenů (Caveat font, copper): `Amoniak`, `PPD`, `Citlivá pokožka`
- Diagnostika label: `Diagnostika`
- Diagnostika text: `Difuzní řídnutí ve frontální oblasti. Začáteční fáze AGA. Doporučeno minoxidil 5 %.`
- Historie label: `Historie`
- Historie items:
  - `22. 4. — Diagnostika`
  - `14. 4. — Konzultace`
  - `28. 3. — Trichologický zákrok`
  - `11. 3. — Konzultace`
- Photos: dva placeholder gradient čtverce s data-label `28.3.` a `22.4.`

A popis pod mockupem:

- **Label:** `Obrazovka 2 — Karta klientky`
- **H3:** Všechno o ní pohromadě
- **Popis:**
  > Jedna obrazovka, na které najdeš všechno odshora dolů. Bez záložek, bez prokliků.

---

## Sekce 02 — Ludmila

- **Section num:** `02`
- **H2:** Aplikace, jakou Ludmila *potřebovala*.
- **Section sub:** `Tricholožka · Pardubice · 8 let praxe`

### Citace (dvě po sobě, oba ve Fraunces 300)

> Vedu si kartotéku osm let. Začínala jsem na papírových kartičkách v zamykatelné skříňce — pak v Excelu, pak ve fotkách v galerii.

> Žádná aplikace neuměla to, co jsem potřebovala. *Tak jsme si ji udělali.*

- **Author name:** `Ludmila Beránková`
- **Author role:** `Tricholožka, Pardubice`

### Video placeholder

- **Label:** `Ukázka`
- **Duration:** `75 vteřin`
- **Aria-label tlačítka:** `Přehrát video`

### Manifesto (po videu, samostatný odstavec)

> Aplikaci píšeme v malém českém týmu podle toho, jak Ludmila pracuje. Proto v ní nenajdeš grafy, statistiky ani „doporučení od AI". *Karta klientky, diář — a ticho.*

---

## Sekce 03 — Soukromí

- **Section num:** `03`
- **H2:**
  > Co ti řekne klientka,
  > zůstane *mezi vámi*.
- *(žádný section-sub — záměrně, viz STRUCTURE.md)*

### Prose (3 odstavce ve Fraunces 300)

> Tvoje záznamy se zašifrují rovnou v telefonu, dřív než cokoli odejde ven. Šifrovací klíč ti telefon vytvoří z tvého hesla a ven se nedostane.

> *(lift, copper border-left)*  
> K datům se nedostane nikdo. *Ani my, ani hacker, ani úřad.*

> A co když zapomeneš heslo a nemáš zálohu? Data jsou pryč. Neumíme je obnovit — to není chyba, je to ten důvod, proč to funguje. Proto je v každém plánu, <hand>i v tom zdarma</hand>, šifrovaná záloha do souboru. Schováš si ji.

### 3 pilíře (grid pod prose)

**Pilíř 1**
- Label: `Vždycky můžeš odejít.`
- Text: Svoje data si kdykoli stáhneš v `<code>JSON</code>` souboru a jdeš s nimi jinam.

**Pilíř 2**
- Label: `Funguje offline.`
- Text: Kartu otevřeš i bez signálu. Až budeš online, srovná se sama.

**Pilíř 3**
- Label: `Bez App Store.`
- Text: Otevřeš v prohlížeči, přidáš na plochu — a chová se jako každá jiná aplikace.

---

## Sekce 04 — Plány

- **Section num:** `04`
- **H2:**
  > Aplikace zdarma.
  > *Synchronizace volitelná.*
- **Section sub:** `Free / Pro / Max`

### Free block (velký panel)

- Label: `Aplikace`
- H3: Bez *háčku*.
- Text:
  > Bez omezení počtu klientek, bez časového limitu. Žádný „trial", po kterém se zamknou funkce. Co máš teď, máš napořád.
- CTA: `Začít zdarma`
- Features (5 položek):
  - Tolik klientek a termínů, kolik potřebuješ
  - Diář a karta klientky
  - Fotky před a po
  - Šifrování přímo v telefonu
  - Záloha do souboru

### Plans intro (mezisekce)

- Eyebrow: `Když chceš víc`
- H3: Synchronizace mezi zařízeními a *záloha v cloudu*.
- Text:
  > Hodí se ti, když pracuješ na víc zařízeních nebo nechceš řešit zálohy ručně.

### Pro plán

- Name: `Pro`
- Amount: `299 Kč/rok`
- Tag: `Pro telefon a tablet. Záloha rok zpátky.`
- Features:
  - **2 zařízení**
  - Zálohy v cloudu — **12 měsíců zpětně**
  - Synchronizace mezi zařízeními
  - Obnova při výměně telefonu
- Microcopy (Patrick Hand): `Vyjde to na 25 Kč měsíčně. Platíš jednou ročně.`

### Max plán

- Name: `Max`
- Amount: `999 Kč/rok`
- Tag: `Pro víc zařízení a dlouhou paměť.`
- Features:
  - **5 zařízení**
  - Zálohy v cloudu — **5 let zpětně**
  - Synchronizace mezi zařízeními
  - Obnova při výměně telefonu
- Microcopy: `Pro někoho přebytek, pro jiného přesně to, co potřebuje.`

### Fineprint pod plány

> Když přestaneš platit, vrátíš se na Free plán a data zůstanou s tebou.

---

## Sekce 05 — Hlasy / Testimonialy

- **Section num:** `05`
- **H2:** Co říkají *kolegyně*.
- **Section sub:** `Trichologky a kadeřnice, ČR a SR`

### Testimonial 1 — Marie

- Citace:
  > Klientka přijde po půl roce a chce „přesně to samé jako minule". *Dřív jsem chvíli vzpomínala, teď to mám rozkliknuté za dvě vteřiny.*
- Avatar initials: `MN`
- Name: `Marie Nováková`
- Role: `Kadeřnice a trichologyně, Brno`

### Testimonial 2 — Jana

- Citace:
  > Bála jsem se, že se budu zase něco učit. *Naťukala jsem první klientku do minuty.*
- Avatar initials: `JK`
- Name: `Jana Kratochvílová`
- Role: `Trichologyně, Olomouc`

### Testimonial 3 — Petra

- Citace:
  > Klientky mi posílají hormonální profily, fotky pokožky, zdravotní zprávy. *Nemůžu to mít válet v galerii vedle dovolené.*
- Avatar initials: `PS`
- Name: `Petra Svobodová`
- Role: `Kadeřnice, Pardubice`

### Fineprint pod testimonialy (Patrick Hand)

> Tricho zatím testujeme s pár trichologkami a kadeřnicemi z ČR a SR. Citace jsou jejich, fotky doplníme, až aplikaci spustíme veřejně.

---

## Sekce 06 — FAQ

- **Section num:** `06`
- **H2:** Otázky, které *chodí*.
- **Section sub:** `Co se ptáte nejčastěji`

### Otázka 1
**Q:** Zapomněla jsem heslo. Co teď?  
**A:** Když nemáš zálohu, jsou data pryč. Heslo neumíme obnovit — neznáme ho a vědomě ani neuchováváme. Proto je v každém plánu, **i ve Free**, šifrovaná záloha do souboru. Schováš si ji do iCloudu, na flashku, do e-mailu — kam chceš. V Pro a Max plánu se zálohy ukládají do cloudu samy.

### Otázka 2
**Q:** Wifi v salonu jde a nejde. Tricho mi vypadne?  
**A:** Ne. Tricho funguje offline. Otevřeš kartu, zapíšeš poznámku, zavřeš. Až přijde signál a máš zapnutý sync, samo se srovná s druhým zařízením.

### Otázka 3
**Q:** Klientky mi posílají citlivé věci. Je to opravdu jen u mě?  
**A:** Ano. Tricho šifruje data přímo v tvém telefonu a klíč nikam neposílá. Ani my jako provozovatel se k těm datům nedostaneme — kdybychom se podívali na server, vidíme jen šum.

### Otázka 4
**Q:** A GDPR? Můžu to klientce ukázat ve smlouvě?  
**A:** Můžeš. U klientek pracuješ s údaji o zdraví — to je čl. 9 GDPR a Tricho je postavené tak, aby tobě i klientce zaručilo, že data vidíš jen ty. Hostujeme v EU, šifrujeme E2E, neprodáváme nikomu. Šablonu DPA si stáhneš v patičce.

### Otázka 5
**Q:** Free napořád — fakt napořád, nebo „dokud to nezměníme"?  
**A:** Napořád. Žádný trial, žádné automatické přepnutí, žádná kreditka při registraci. Když někdy budeš chtít synchronizaci nebo cloudové zálohy, koupíš si Pro. Free plán si můžeš nechat klidně deset let.

### Otázka 6
**Q:** Co když Tricho v roce 2030 zanikne?  
**A:** Stáhneš si data v `<code>JSON</code>` souboru. Otevřený formát — můžeš si je nahrát jinam, nebo si je nechat ležet na disku. V Tricho tě nikdo nedrží.

### Otázka 7
**Q:** Mám iPhone. Funguje to?  
**A:** Funguje. V Safari otevřeš tricho.app, klepneš na **↑ Sdílet** → „Přidat na plochu". Hotovo — od té chvíle Tricho otevíráš ze své plochy jako každou jinou aplikaci. iOS má jedno omezení: synchronizace běží jen, když je aplikace otevřená.

### Otázka 8
**Q:** Můžou si u mě klientky samy rezervovat?  
**A:** Ne — a vědomě. Tricho je sešit, ne rezervační systém. Když potřebuješ veřejné rezervace pro klientky, dál používej Reservio nebo Booksy a Tricho měj vedle nich na evidenci. Většině kolegyň takhle stačí.

---

## Final CTA

- **H2:** Začni s *další klientkou*.
- **Lede:**
  > Staré poznámky nech v sešitě. První návštěvu, která ti přijde, zapiš do Tricha — a uvidíš, jestli ti sedne.
- **CTA:** `Začít zdarma`
- **Risk reversal (Patrick Hand):**
  > Bez platební karty. Když ti to nesedne, smažeš účet jedním klepnutím a data si vezmeš s sebou.
- **Micro (mono):** `iPhone i Android · iPad i tablet · Funguje i v prohlížeči na PC`

---

## Footer

### Brand column
- Logo: `Tricho.app` + version `v0.9 · v přípravě`
- Tagline:
  > Sešit pro tricholožky a kadeřnice. Postavený v Česku, hostovaný v EU.

### Column 2 — Produkt
- Plány → `#plany`
- Soukromí → `#`
- Nápověda → `/help`
- Blog → `/blog`

### Column 3 — Právní
- GDPR → `/gdpr`
- Podmínky → `/podminky`
- Cookies → `/cookies`

### Column 4 — Kontakt
- E-mail: `ahoj@tricho.app` → `mailto:ahoj@tricho.app`
- O nás → `/o-nas`

### Footer bottom
- `© 2026 Tricho.app · Praha, EU`
- `v0.9 · v přípravě`

---

## Aria labely a accessibility texts

- Theme toggle button: `aria-label="Přepnout motiv"`
- Video play button: `aria-label="Přehrát video"`
- Brand link → `/`
- Skip-link (přidat): `Přejít k obsahu` → `#main`

---

## Slovník — co dělat / nedělat (rychlá reference pro agenta)

**Drž:** klientka, návštěva, anamnéza, alergen, vlasová pokožka, mikrokamera, diář, karta, sešit, kartotéka, zálohu, synchronizace, šifrování (zřídka)

**Vyhýbej se:** uživatelka, klient, CRM, dashboard, workflow, onboarding, scheduler, end-to-end (rozepiš česky), Free napořád v copy mimo brand pozice (je to brand fráze, mimo ni používej "zdarma napořád"), tichý sešit (jen ve footeru)

**Brand fráze (drž doslova):** Tricho, Tricho.app, Free / Pro / Max (názvy plánů), Začít zdarma (CTA tag)
