---
project: splitdom
researched_at: 2026-09-19
recommended_platform: netlify
runner_up: vercel
context_type: mvp
tech_stack:
  language: typescript
  framework: nextjs-app-router
  runtime: nodejs
---

## Rekomendacja

**Wdrożenie na Netlify.**

Netlify spełnia wszystkie pięć kryteriów przyjazności dla agentów, jego darmowe Scheduled Functions pokrywają FR-005 (automatyczne zamykanie okresu rozliczeniowego na koniec miesiąca) bez dodatkowej usługi, a oficjalny serwer MCP (GA) daje agentowi ustrukturyzowany dostęp do wdrożeń i logów. To wybór świadomie dokonany po kontroli błędu potwierdzenia: pierwotnym liderem rankingu był Vercel, ale po zidentyfikowaniu ryzyk (granica ToS planu Hobby, brak wbudowanych alertów o nieudanym uruchomieniu crona, zależność od poolingu połączeń Neon) użytkownik zdecydował się zamienić rekomendację na Netlify, akceptując w zamian ryzyko związane z tym, że wsparcie Next.js App Router opiera się na oficjalnym, ale zewnętrznym względem samego frameworka adapterze.

## Porównanie platform

Ocena względem pięciu kryteriów z `references/agent-friendly-criteria.md`: CLI-first, zarządzana/serverless infrastruktura, dokumentacja czytelna dla agentów, stabilne API wdrożeniowe, serwer MCP/integracja. Skala: Spełnia / Częściowo / Nie spełnia.

**Filtry twarde**: żadna platforma nie została odrzucona filtrem twardym — SplitDom nie wymaga połączeń długożyjących (WebSockets/long-polling), a wszystkie sześć platform obsługuje TypeScript/Node.js/Next.js w jakiejś formie.

| Platforma | CLI-first | Zarządzana/serverless | Dokumentacja dla agentów | Stabilne API wdrożeń | MCP/integracja | Uwaga kluczowa |
|---|---|---|---|---|---|---|
| **Netlify** | Spełnia | Spełnia | Spełnia | Spełnia | Spełnia | Adapter `@netlify/plugin-nextjs` (GA), ale z historią drobnych niezgodności przy dużych wersjach Next.js |
| **Vercel** | Spełnia | Spełnia | Spełnia | Spełnia | Spełnia | Natywne środowisko Next.js (twórca frameworka), zero podatku adaptera |
| **Cloudflare (Workers/Pages)** | Spełnia | Spełnia | Spełnia (najlepsza w stawce) | Spełnia | Spełnia | Wymaga adaptera OpenNext; limit 10ms CPU na darmowym planie ciasny dla SSR |
| **Railway** | Częściowo | Spełnia | Spełnia | Spełnia | Spełnia | Brak CLI-owego rollbacku do dowolnej wersji; brak darmowego planu (próg ~10-20 USD/mies.) |
| **Render** | Spełnia | Spełnia | Spełnia | Spełnia | Spełnia | Darmowy Postgres wygasa po 30 dniach — krócej niż trwa samo MVP |
| **Fly.io** | Częściowo | Częściowo | Spełnia | Spełnia | Częściowo | Brak natywnego crona — wymaga obejścia (Supercronic/scheduled machine) |

Wagi miękkie z wywiadu z użytkownikiem: brak połączeń długożyjących (bez filtra twardego), priorytet minimalizacji kosztów (penalizuje Railway i płatne warstwy Render/Cloudflare), brak istniejącej znajomości platform (brak remisów do rozstrzygnięcia), ruch jednoregionalny (brak premii za sieć edge), zewnętrzny dostawca bazy danych akceptowalny (nie penalizuje platform bez własnego Postgresa).

Cztery platformy (Netlify, Vercel, Cloudflare, Render) uzyskały komplet "Spełnia" na pięciu kryteriach — różnicę robi dopasowanie do FR-005 i realne ryzyko wdrożeniowe specyficzne dla Next.js, opisane niżej. Fly.io odpada z krótkiej listy: nie ma natywnego mechanizmu harmonogramu, więc FR-005 wymagałby dokładnie takiego ręcznego obejścia, jakie było powodem odrzucenia pierwotnej kombinacji Astro/Cloudflare na etapie wyboru stacku.

### Platformy na skróconej liście

#### 1. Netlify (rekomendowana)

Darmowe Scheduled Functions (`@monthly`, `0 0 1 * *` UTC) realizują FR-005 na każdym planie, łącznie z darmowym — zero dodatkowej usługi. Oficjalny serwer MCP (GA od czerwca 2025, github.com/netlify/netlify-mcp) obejmuje wdrożenia, zmienne środowiskowe i logi. CLI ma pełne pokrycie (`netlify deploy`, rollback, `netlify logs --follow` dodane w 2026). Ryzyko: wsparcie App Router idzie przez `@netlify/plugin-nextjs` (oparty o OpenNext) — oficjalnie wspierany i aktywnie utrzymywany, ale społeczność zgłaszała w latach 2024-2026 przejściowe niezgodności przy dużych aktualizacjach Next.js (patrz kontrola błędu potwierdzenia niżej). Nowy, kredytowy model darmowego planu (300 kredytów/mies., 15 kredytów za wdrożenie produkcyjne, bez trybu nadwyżki) to dodatkowy czynnik do monitorowania przy częstym wdrażaniu wieczorami.

#### 2. Vercel (runner-up)

Pierwotny lider rankingu — twórca Next.js, więc zero podatku adaptera; Cron Jobs (GA) trywialnie pokrywają FR-005 nawet na darmowym planie Hobby (minimalna częstotliwość raz dziennie, więc harmonogram miesięczny mieści się z zapasem); oficjalny, niebeta serwer MCP. Odrzucony na etapie kontroli błędu potwierdzenia z powodu: niejasnej granicy ToS planu Hobby przy użyciu niekomercyjnym przez wielu domowników, braku wbudowanego alertu o nieudanym uruchomieniu crona (ryzykowne dla wymogu PRD, że salda muszą się zawsze zgadzać) oraz zależności od poolera połączeń Neon (Vercel Postgres zostało wycofane na rzecz Neon w 2024/2025) jako dodatkowej warstwy do poprawnego skonfigurowania.

#### 3. Cloudflare Workers + Pages

Najlepsza dokumentacja czytelna dla agentów (`llms.txt`, markdown przez content negotiation) i najtańszy płatny plan (5 USD/mies. płasko, bez opłat za transfer). Natywny mechanizm Cron Triggers czysto pokrywa FR-005. Traci miejsce na liście głównie przez podatek adaptera: Next.js App Router nie działa natywnie — wymaga `@opennextjs/cloudflare` (dojrzały, ale z udokumentowanym tarciem przy integracji NextAuth/`jose`, błąd `[unenv] https.request is not implemented yet!` w polyfillach `nodejs_compat`) oraz limitu 10ms czasu CPU na darmowym planie, który badanie oceniło jako "genuinely tight" dla SSR w Next.js.

## Kontrola błędu potwierdzenia: Netlify

### Diabelski adwokat — słabości

1. Adapter `@netlify/plugin-nextjs` (oparty o OpenNext) to warstwa Netlify, nie natywne środowisko uruchomieniowe Next.js — społeczność zgłaszała w latach 2024-2025 realne, choć przejściowe, awarie powiązane z dużymi aktualizacjami wersji (spowolnienia/timeouty na 14.1, błędy 500 przy bezpośrednim wejściu/odświeżeniu strony po migracji na App Router, inna kolejność wykonania middleware niż w standardowym Next.js). Przy solowym, 3-tygodniowym projekcie bez zapasu czasu, trafienie na taki problem oznacza dni spędzone na debugowaniu adaptera zamiast budowania funkcji.
2. Nowy, kredytowy model darmowego planu (dla kont założonych po ok. wrześniu 2025) daje 300 kredytów/miesiąc bez trybu nadwyżki — każde wdrożenie produkcyjne kosztuje 15 kredytów, czyli limit to ok. 20 wdrożeń/miesiąc, zanim zużyje się cokolwiek na transfer czy funkcje. Przy aktywnym kodowaniu wieczorami (kilka wdrożeń na sesję) budżet może się wyczerpać szybciej niż oczekiwano, a strona zostaje wtedy wstrzymana do następnego cyklu — dokładnie wtedy, gdy Scheduled Function miałaby się uruchomić.
3. Brak własnej, zarządzanej bazy Postgres — SplitDom i tak zależy od zewnętrznego dostawcy (Neon/Supabase) z tymi samymi pułapkami poolingu połączeń co przy Vercelu (surowy connection string wyczerpie pulę połączeń pod współbieżnymi wywołaniami funkcji). Zmiana platformy z Vercela na Netlify nie eliminuje tej klasy ryzyka.
4. Scheduled Functions uruchamiają się wyłącznie na opublikowanym wdrożeniu produkcyjnym, nigdy w podglądach (deploy previews) — logika FR-005 nie ma środowiska do pełnego testu end-to-end przed produkcją, co jest ryzykowne dla funkcji bezpośrednio wpływającej na gwarancję PRD, że kwoty długu muszą się zawsze zgadzać.
5. **Ustalenie z bieżącego badania (19.09.2026)**: wsparcie Netlify dla Next.js 16 zostało ogłoszone dopiero dzisiaj w oficjalnym changelogu — czyli nie ma jeszcze żadnej realnej historii eksploatacyjnej na tej konkretnej kombinacji wersji. Co więcej, na forum wsparcia Netlify widnieje nierozwiązane zgłoszenie: build Next.js 16.0.3 z Turbopackiem failuje na Edge Functions z błędem `Failed to load external module pino` przy przetwarzaniu middleware — support Netlify potwierdził brak sposobu na wyłączenie obsługi Edge Middleware i zasugerował unikanie zależności CommonJS (nie-ESM). To bezpośrednio dotyczy SplitDom, bo FR-001 (logowanie przez zewnętrznego dostawcę tożsamości) niemal na pewno będzie wymagało middleware do ochrony tras, a biblioteki auth (np. NextAuth/Auth.js) często pociągają za sobą zależności logujące typu `pino`.

### Analiza przedwyroczna (pre-mortem) — jak mogłoby się to nie udać

Zespół wdrożył SplitDom na Netlify w trzy tygodnie, ciesząc się, że darmowe Scheduled Functions załatwiają miesięczne zamykanie okresu bez dodatkowych kosztów. Cztery miesiące później Next.js wydał kolejną łatkę z drobną zmianą API middleware; adapter Netlify nie nadążył z aktualizacją równie szybko jak zwykle, a strona logowania zaczęła zwracać sporadyczne błędy 500 po odświeżeniu — dokładnie ten wzorzec, który społeczność zgłaszała wcześniej przy przejściach na nowe wersje frameworka. Deweloper spędził cały weekend, próbując odróżnić błąd własnej aplikacji od błędu adaptera, zamiast pracować nad funkcją niestandardowego podziału wydatków. Równolegle aktywne iterowanie (kilka wdrożeń każdego wieczoru) niepostrzeżenie zużyło miesięczny limit 300 kredytów w połowie miesiąca — konto zostało wstrzymane na kilka dni tuż przed zaplanowanym zamknięciem okresu, a Scheduled Function nigdy się nie uruchomiła, bo strona była spauzowana. Dług dwóch grup rozliczeniowych pozostał otwarty do ręcznej korekty. Wniosek: nikt nie zmapował ryzyka "adapter opóźniony względem nowej wersji Next.js" ani nie monitorował zużycia kredytów w czasie rzeczywistym — oba ryzyka były znane od dnia decyzji, ale żadne nie miało przypisanej konkretnej kontroli.

### Nieznane niewiadome

- Netlify przeniosło konta założone po ok. wrześniu 2025 na nowy, kredytowy model rozliczeń bez trybu nadwyżki (overage) — strona jest wtedy wstrzymywana do następnego cyklu zamiast przełączana na płatne doliczanie, co nie jest oczywiste z samej strony cennika.
- Scheduled Functions uruchamiają się wyłącznie na opublikowanym wdrożeniu produkcyjnym, nigdy w podglądach — nie da się przetestować logiki zamykania okresu end-to-end przed wypchnięciem na produkcję, a ta informacja nie jest wyeksponowana w głównej dokumentacji Scheduled Functions.
- Wsparcie dla Next.js 16 na Netlify zostało ogłoszone dopiero w dniu tego badania (19.09.2026) — SplitDom ma w `package.json` dokładnie tę wersję (16.3.5), więc projekt startuje na kombinacji platforma+wersja frameworka bez żadnej sprawdzonej historii produkcyjnej, a otwarte zgłoszenie o błędzie budowania z Turbopackiem i middleware (prawdopodobnie zależności auth typu `pino`) nie ma potwierdzonego obejścia ze strony supportu Netlify.
- Middleware w adapterze Netlify może wykonywać się w innej kolejności niż w standardowym Next.js (zgłoszenia społeczności z 2024-2025) — kod middleware napisany i przetestowany lokalnie na `next dev` może zachowywać się inaczej po wdrożeniu.
- Brak własnej, natywnej bazy Postgres oznacza, że dokładnie te same pułapki poolingu połączeń (Neon/Supabase) co na Vercelu przenoszą się na Netlify — zmiana platformy hostingowej nie eliminuje tego ryzyka, mimo że mogłoby się tak wydawać na pierwszy rzut oka.

## Historia operacyjna

- **Podgląd wdrożeń**: każdy branch/PR na GitHubie automatycznie dostaje własny URL podglądu (Deploy Preview) generowany przez Netlify po pushu, bez dodatkowej konfiguracji; URL-e podglądu są domyślnie publiczne, więc dla gałęzi z danymi zbliżonymi do produkcyjnych warto rozważyć ochronę hasłem/Netlify Access. Scheduled Functions (w tym logika FR-005) **nie uruchamiają się** na podglądach — tylko na opublikowanym wdrożeniu produkcyjnym.
- **Sekrety**: zmienne środowiskowe (dane OAuth, connection string do bazy) trzymane w Netlify Environment Variables per-site i per-context (production / deploy-preview / branch-deploy), ustawiane przez `netlify env:set` lub w panelu — nie trafiają do repozytorium. Rotacja polega na aktualizacji wartości w Netlify i ponownym wdrożeniu, aby weszła w życie w uruchomionych funkcjach.
- **Rollback**: `netlify rollback` lub wybór wcześniejszego wdrożenia w CLI/panelu przywraca poprzednią wersję produkcyjną w ciągu sekund. Migracje bazy danych **nie cofają się automatycznie** — rollback samego kodu bez cofnięcia migracji schematu może zostawić bazę niespójną ze starszą wersją aplikacji, więc migracje wymagają osobnego, ręcznego planu wycofania.
- **Zatwierdzanie**: rutynowe wdrożenia na produkcję po mergu do głównej gałęzi mogą przebiegać automatycznie (CI/CD z GitHub Actions, zgodnie z `tech-stack.md`); rotacja głównych sekretów (sekret NextAuth, dane dostępowe do bazy) oraz jakiekolwiek zmiany planu rozliczeniowego pozostają czynnościami wykonywanymi ręcznie przez człowieka.
- **Logi**: `netlify logs --follow` do logów na żywo (funkcja dodana w 2026), `netlify logs:function <nazwa>` dla logów konkretnej funkcji; oficjalny serwer MCP Netlify (github.com/netlify/netlify-mcp) pozwala agentowi odpytywać status wdrożeń i logi w sposób ustrukturyzowany zamiast parsować wyjście CLI.

## Rejestr ryzyk

| Ryzyko | Źródło | Prawdopodobieństwo | Wpływ | Mitygacja |
|---|---|---|---|---|
| Build z Turbopackiem na Next.js 16 failuje na Netlify Edge Functions, gdy middleware/zależności auth (np. `pino`) nie są w pełni ESM — otwarte, nierozwiązane zgłoszenie na forum wsparcia bez potwierdzonego obejścia | Ustalenie badawcze | Ś | W | Przed implementacją pełnego FR-001 wdrożyć minimalny middleware-placeholder na Netlify i zweryfikować, że build przechodzi; jeśli nie, zbudować bez `--turbopack` (`next build` domyślnym webpackiem) jako plan B |
| Niezgodność adaptera `@netlify/plugin-nextjs` z nową wersją Next.js po dużej aktualizacji (błędy 500, spowolnienia, inna kolejność middleware) | Diabelski adwokat | Ś | Ś | Przypiąć dokładną wersję Next.js i śledzić changelog `@netlify/plugin-nextjs` przed każdą aktualizacją; testować upgrade na osobnym branchu przed mergem do produkcji |
| Wyczerpanie miesięcznego limitu 300 kredytów przez częste wdrożenia produkcyjne podczas aktywnego kodowania wieczorami (15 kredytów/wdrożenie ≈ 20 wdrożeń/mies.) | Diabelski adwokat | Ś | W | Iterować na podglądach (deploy previews) i wdrażać na produkcję dopiero po ukończeniu partii zmian; monitorować zużycie kredytów w panelu Netlify |
| Scheduled Function (FR-005) nie ma środowiska do testu end-to-end przed produkcją, bo nie uruchamia się na podglądach | Nieznane niewiadome | Ś | W | Napisać dedykowany test jednostkowy/integracyjny wywołujący handler scheduled function bezpośrednio (bez czekania na harmonogram), uruchamiany w CI przed każdym wdrożeniem |
| Brak własnej zarządzanej bazy Postgres — zależność od poolowanego connection stringa zewnętrznego dostawcy (Neon/Supabase); surowy connection string wyczerpie połączenia pod współbieżnością | Ustalenie badawcze | Ś | Ś | Od pierwszego dnia używać connection stringa z poolerem (Neon PgBouncer / Supabase Supavisor transaction mode); udokumentować to w README projektu |
| 30-sekundowy limit czasu wykonania Scheduled Functions może być niewystarczający, jeśli zamykanie okresu kiedyś obejmie wiele grup w jednym uruchomieniu | Diabelski adwokat | N | Ś | Zaprojektować handler tak, by przetwarzał grupy niezależnie i dało się go łatwo podzielić na wiele mniejszych wywołań, jeśli limit zostanie kiedyś osiągnięty |
| Granica ToS planu Hobby / niekomercyjnego użycia (dotyczy Vercela jako runner-upa, warto mieć na uwadze przy ewentualnej migracji) | Diabelski adwokat (z pierwszej kontroli, Vercel) | N | Ś | Nie dotyczy Netlify bezpośrednio — odnotowane jako kontekst decyzji, gdyby projekt kiedyś migrował z powrotem na Vercel |

*Prawdopodobieństwo/Wpływ: N = niskie, Ś = średnie, W = wysokie.*

## Pierwsze kroki

1. Zainstalować Netlify CLI (`npm i -g netlify-cli`) i zalogować się (`netlify login`), następnie połączyć repozytorium (`netlify init`) — Netlify automatycznie wykryje Next.js 16.3.5 i zainstaluje adapter `@netlify/plugin-nextjs`, bez potrzeby ręcznej konfiguracji `netlify.toml` dla podstawowego działania.
2. Przed implementacją FR-001 wdrożyć na Netlify minimalny middleware-placeholder (bez pełnej logiki auth) i zweryfikować, że build z Turbopackiem przechodzi na Edge Functions — jeśli napotka się błąd `Failed to load external module` znany z otwartego zgłoszenia na forum Netlify, zbudować bez flagi `--turbopack` jako obejście.
3. Skonfigurować zewnętrzną bazę Postgres (np. Neon) z connection stringiem **poolowanym** (PgBouncer/transaction mode) od pierwszego dnia i ustawić go w Netlify Environment Variables osobno dla kontekstu production i deploy-preview (`netlify env:set`).
4. Zaimplementować Scheduled Function dla FR-005 (`export const config = { schedule: "@monthly" }`, odpowiadające `0 0 1 * *` UTC) razem z osobnym testem jednostkowym wywołującym handler bezpośrednio, ponieważ scheduled functions nie uruchamiają się na podglądach.
5. Włączyć `netlify logs --follow` i skonfigurować oficjalny serwer MCP Netlify do bieżącego, ustrukturyzowanego odpytywania stanu wdrożeń podczas dalszej implementacji.

## Poza zakresem

Tego badania nie obejmowało:
- Konfiguracja obrazów Dockerowych
- Konfiguracja pipeline'ów CI/CD (poza samym faktem, że `tech-stack.md` zakłada GitHub Actions z auto-deploy-on-merge)
- Architektura na skalę produkcyjną (multi-region, wysoka dostępność, disaster recovery)
