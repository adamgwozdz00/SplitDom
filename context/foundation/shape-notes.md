---
project: "SplitDom"
context_type: greenfield
created: 2026-09-18
updated: 2026-09-20
product_type: web-app
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "tarcie procesowe (ręczna, powtarzalna robota) + dane rozproszone (historia banku) + narzut koordynacyjny między domownikami"
    - topic: "insight"
      decision: "narzędzie na własny użytek, zastępujące Excel; nie chodzi o przewagę funkcjonalną nad istniejącymi appkami (Splitwise itp.)"
    - topic: "primary persona scope"
      decision: "jedna ogólna persona 'osoba współdzieląca koszty domowe' obejmująca zarówno małżonków, jak i współlokatorów — bez różnicowania na etapie MVP"
    - topic: "auth model"
      decision: "logowanie (email+hasło / OAuth) — konto per osoba, dostęp z różnych urządzeń"
    - topic: "role model"
      decision: "w większości płaski model, z jednym wyjątkiem: twórca grupy (\"gospodarz\") ma wyłączne prawo zamykania okresu rozliczeniowego (FR-015); rola gospodarza jest przypisana na trwałe do twórcy grupy w MVP, bez możliwości przekazania. Poza tym uprawnieniem gospodarz nie ma żadnych innych praw administracyjnych. Zrewidowano 2026-09-20 w związku ze zmianą modelu zamykania okresu z automatycznego na manualny."
    - topic: "MVP flow scope"
      decision: "pełny cykl: logowanie Google → utworzenie grupy → zaproszenie mailem → dodanie wydatków → wyliczenie salda → wygenerowanie danych do przelewu → oznaczenie wysłania → oznaczenie spłaty. Użytkownik potwierdził wykonalność w 3 tygodnie pracy po godzinach."
    - topic: "split method"
      decision: "osoba dodająca wydatek wybiera sposób podziału (równo / własne kwoty / tylko wybrani członkowie), nie zawsze równy podział"
    - topic: "settle-up minimization algorithm"
      decision: "zdegradowany do nice-to-have po rundzie sokratejskiej (FR-006) — MVP rozlicza pary osobno"
    - topic: "billing cycle close"
      decision: "okres rozliczeniowy zamyka gospodarz (twórca grupy) manualną akcją — możliwą tylko po zakończeniu kalendarzowego miesiąca i tylko gdy własne długi gospodarza z tego okresu (jako dłużnika) zostały potwierdzone jako spłacone; zamknięcie automatycznie otwiera nowy okres. Wydatki z zamkniętego okresu są niezmienne. Zrewidowano 2026-09-20: zastąpiono automatyczne (harmonogramowe) zamykanie akcją użytkownika, by uniknąć zależności od crona/scheduled function na etapie MVP."
    - topic: "product type"
      decision: "strona/aplikacja webowa (nie natywna aplikacja mobilna)"
    - topic: "target scale"
      decision: "mała skala — użytkownik i garstka osób z jego otoczenia"
    - topic: "deadline"
      decision: "brak sztywnego terminu; aspiracyjny cel to 2026-11-04, z akceptowalnym poślizgiem na późniejszy termin"
    - topic: "work mode"
      decision: "wyłącznie praca po godzinach"
  frs_drafted: 15
  quality_check_status: accepted
---

# Shape Notes

## Seed idea

Aplikacja do sprawiedliwego dzielenia wydatków gospodarstwa domowego dla małżonków i współlokatorów (np. grupy studentów). Funkcje: podział wydatków w grupie, wyliczanie salda/długu każdego uczestnika, generowanie danych do przelewu dla rozliczenia.

Do rozważenia (nieuzgodnione): algorytm minimalizujący liczbę przelewów przy rozliczaniu grupy naraz.

## Vision & Problem Statement

Osoby współdzielące koszty gospodarstwa domowego — małżonkowie lub współlokatorzy (np. grupa studentów wynajmująca mieszkanie) — co okres rozliczeniowy (zwykle miesiąc) ręcznie rozliczają wspólne wydatki: budują i duplikują arkusze Excel z regułami podziału, przeglądają historię konta bankowego, żeby zebrać transakcje, i sumują kwoty na kalkulatorze. Ta praca jest żmudna i powtarzalna, dane o wydatkach są rozproszone (historia banku, arkusze), a dodatkowo trzeba koordynować z domownikami, kto komu jest winien.

To narzędzie powstaje na własny użytek — ma zastąpić Excel dla siebie i swoich współlokatorów/małżonka, a nie konkurować funkcjonalnie z istniejącymi aplikacjami do dzielenia wydatków (np. Splitwise). Wartość leży w dopasowaniu do własnego przepływu rozliczeń, nie w przewadze rynkowej.

## User & Persona

Osoba współdzieląca koszty gospodarstwa domowego z innymi — małżonek/partner lub współlokator (np. w grupie studenckiej wynajmującej mieszkanie). Sięga po produkt w momencie okresowego (zwykle comiesięcznego) rozliczenia wspólnych wydatków, żeby uniknąć ręcznego prowadzenia arkusza i przegrzebywania historii konta bankowego. Ta sama persona obejmuje oba przypadki użycia (małżonkowie i współlokatorzy) bez rozróżnienia na etapie MVP.

## Access Control

Logowanie (email+hasło lub OAuth) — każdy użytkownik ma własne konto i loguje się z dowolnego urządzenia. W obrębie grupy rozliczeniowej (np. mieszkania/gospodarstwa) obowiązuje w większości płaski model uprawnień: każdy członek grupy może dodawać wydatki i widzieć pełne rozliczenie grupy. Jedyny wyjątek: twórca grupy ("gospodarz") ma dodatkowe, wyłączne uprawnienie do zamykania bieżącego okresu rozliczeniowego (FR-015) — rola gospodarza jest przypisana na trwałe do twórcy grupy w MVP, bez możliwości przekazania (rozważane po MVP). Poza tym uprawnieniem gospodarz nie ma żadnych innych praw administracyjnych — nie może np. usuwać innych członków z grupy.

## Success Criteria

### Primary
- Pełny cykl działa od zalogowania po zamknięcie długu: logowanie kontem Google → utworzenie grupy rozliczeniowej → zaproszenie współlokatora linkiem/kodem zaproszenia → dodanie wydatków przez członków grupy → poprawne wyliczenie salda/długu każdego uczestnika → wygenerowanie danych do przelewu → oznaczenie przelewu jako wysłanego przez nadawcę → oznaczenie długu jako spłaconego przez odbiorcę.

### Secondary
- Generowanie kodu QR do zeskanowania i zapłaty w banku.
- Automatyczna spłata długu przez integrację z bankiem lub BLIK.
- Kategoryzacja wydatków (np. opłaty mieszkaniowe, zakupy spożywcze, wyjścia).
- Podsumowanie kosztów w ujęciu miesięcznym/rocznym.

### Guardrails
- Prywatność danych finansowych między grupami — dane jednej grupy rozliczeniowej nie są widoczne dla osób spoza niej.
- Poprawność wyliczeń salda — kwoty długu muszą się zawsze zgadzać (suma wydatków = suma przypisanych udziałów).
- Brak możliwości modyfikacji wpisu wydatku należącego do innej osoby przez kogoś innego niż jego autor.

## Functional Requirements

### Konto i grupa rozliczeniowa
- FR-001: Użytkownik może zalogować się kontem Google. Priority: must-have
  > Socrates: Counter-argument considered: "logowanie tylko Google wyklucza osoby bez takiego konta." Resolution: MVP zaczyna od Google; logowanie e-mail+hasło jako alternatywa przechodzi do nice-to-have (FR-014).
- FR-002: Użytkownik może utworzyć grupę rozliczeniową ("mieszkanie"). W MVP użytkownik należy tylko do jednej grupy naraz. Priority: must-have
  > Socrates: Counter-argument considered: "jedna osoba może chcieć dzielić koszty i z małżonkiem, i ze współlokatorami naraz — brak obsługi wielu grup." Resolution: świadome uproszczenie na MVP — jedna grupa na użytkownika; wielość grup poza zakresem MVP.
- FR-003: Użytkownik może zaprosić inną osobę do grupy, generując link/kod zaproszenia, który samodzielnie wysyła wybranym przez siebie kanałem (e-mail, SMS, komunikator). Priority: must-have
  > Socrates: Counter-argument considered: "wysyłka e-maila zaproszenia z serwera aplikacji to dodatkowa zależność zewnętrzna." Resolution: zastąpione generowaniem linku/kodu zaproszenia do ręcznego wysłania — bez integracji z serwisem mailowym po stronie aplikacji.

### Wydatki i rozliczenia
- FR-004: Członek grupy może dodać wydatek w ramach bieżącego, otwartego okresu rozliczeniowego; wydatek jest domyślnie dzielony po równo między wszystkich członków grupy. Priority: must-have
  > Socrates: Counter-argument considered: "większość wydatków domowych dzieli się po równo — elastyczny podział (własne kwoty / wybrani członkowie) to nadmiarowa praca na MVP." Resolution: uproszczone do stałego podziału równego w MVP; niestandardowy podział przechodzi do nice-to-have (FR-014).
- FR-005: Aplikacja wylicza saldo/dług każdego członka grupy na podstawie dodanych wydatków w danym okresie rozliczeniowym. Wydatek nie może być edytowany ani usunięty, gdy jego okres rozliczeniowy jest zamknięty (zamknięcie okresu opisane w FR-015) lub gdy dotyczący go dług został już oznaczony jako spłacony. Priority: must-have
  > Socrates: Counter-argument considered: "edycja/usunięcie wydatku po fakcie komplikuje już rozliczone saldo." Resolution: wydatek jest blokowany do edycji/usunięcia po zamknięciu okresu rozliczeniowego lub po oznaczeniu powiązanego długu jako spłaconego — pierwsze z tych dwóch zdarzeń obowiązuje.
- FR-015: Gospodarz (twórca grupy) może zamknąć bieżący, otwarty okres rozliczeniowy — tylko gdy (a) kalendarzowy miesiąc, którego dotyczy okres, już się zakończył, oraz (b) wszystkie długi, w których gospodarz jest dłużnikiem za wydatki z tego okresu, zostały oznaczone jako spłacone przez ich odbiorców. Zamknięcie okresu automatycznie otwiera nowy, kolejny okres rozliczeniowy. Priority: must-have
  > Socrates: Counter-argument considered: "gospodarz mógłby zamykać okres wedle własnej wygody, ignorując nierozliczone długi innych członków — nadmierna władza jednej osoby." Resolution: zamknięcie nie wymaga rozliczenia długów INNYCH członków, ale jest blokowane, dopóki własne długi gospodarza (jako dłużnika) z tego okresu nie zostaną potwierdzone jako spłacone — to ogranicza możliwość zamykania okresu bez wywiązania się z własnych zobowiązań.
- FR-006: Aplikacja wylicza minimalny zestaw przelewów rozliczających całą grupę naraz (zamiast rozliczać każdą parę osobno). Priority: nice-to-have
  > Socrates: Counter-argument considered: "zbędna złożoność algorytmiczna na MVP — rozliczanie parami też rozwiązuje problem, mniej optymalnie, ale prościej." Resolution: zdegradowane z must-have do nice-to-have; MVP rozlicza pary osobno.

### Rozliczenie i przelewy
- FR-007: Użytkownik może wygenerować dane do przelewu rozliczającego dług wobec innego członka grupy — tekst do ręcznego skopiowania: numer konta, kwota, tytuł przelewu. Priority: must-have
  > Socrates: Counter-argument considered: "bez integracji z konkretnym bankiem format danych może nie pasować do żadnej bankowości." Resolution: dane mają uniwersalny, tekstowy format (numer konta, kwota, tytuł) do ręcznego wklejenia w dowolnej bankowości elektronicznej.
- FR-008: Nadawca przelewu może oznaczyć przelew jako wysłany — to przypomnienie dla nadawcy, nie ostateczne potwierdzenie rozliczenia długu. Priority: must-have
  > Socrates: Counter-argument considered: "brak weryfikacji, że przelew faktycznie wysłano — możliwe nadużycie." Resolution: oznaczenie "wysłano" jest tylko informacyjne dla nadawcy; ostateczne zamknięcie długu następuje dopiero, gdy odbiorca potwierdzi otrzymanie (FR-009).
- FR-009: Odbiorca przelewu może oznaczyć dług jako spłacony po otrzymaniu przelewu — to ostateczne potwierdzenie zamykające dług. Priority: must-have
  > Socrates: Counter-argument considered: "odbiorca może zapomnieć/zwlekać z potwierdzeniem, więc dług formalnie zostaje otwarty mimo otrzymanej wpłaty." Resolution: zaakceptowane — dług widnieje jako "oczekujący" aż do potwierdzenia przez odbiorcę; brak dodatkowej logiki na MVP.

### Funkcje dodatkowe (nice-to-have)
- FR-010: Użytkownik może wygenerować kod QR do zapłaty w banku. Priority: nice-to-have
  > Socrates: Counter-argument considered: "wymaga znajomości konkretnego standardu QR płatności — ryzyko niezgodności z bankowościami." Resolution: ryzyko zaakceptowane; funkcja zostaje jako nice-to-have do rozważenia po MVP.
- FR-011: Użytkownik może kategoryzować wydatki (np. opłaty mieszkaniowe, zakupy spożywcze, wyjścia) i zobaczyć podsumowanie kosztów w tych kategoriach w ujęciu miesięcznym/rocznym. Priority: nice-to-have
  > Socrates: Counter-argument considered: "kategoryzacja bez podsumowań nie daje samodzielnej wartości." Resolution: połączone w jedną funkcję nice-to-have — kategorie i podsumowania wdrażane razem.
- FR-012: Użytkownik może spłacić dług automatycznie poprzez integrację bankową/BLIK. Priority: nice-to-have
  > Socrates: Counter-argument considered: "integracja płatnicza niesie duży zakres regulacyjny i techniczny (PSD2, licencje), nieproporcjonalny do reszty projektu." Resolution: ryzyko zaakceptowane; zostaje jako odległy kierunek rozwoju, nie blokuje MVP.
- FR-013: Użytkownik może zalogować się e-mailem i hasłem jako alternatywa dla logowania kontem Google. Priority: nice-to-have
- FR-014: Osoba dodająca wydatek może wybrać niestandardowy sposób podziału (własne kwoty / tylko wybrani członkowie) zamiast domyślnego podziału równego. Priority: nice-to-have

## User Stories

### US-01: Użytkownik dodaje wydatek i widzi wyliczony dług współlokatora

- **Given** grupa jest pusta (brak zapisanych wydatków), rozpoczął się nowy okres rozliczeniowy, grupa ma co najmniej dwóch członków — Użytkownika A i Użytkownika B
- **When** Użytkownik A dodaje wydatek "Czynsz" 400 zł z podziałem 50%/50%
- **Then** aplikacja oblicza dług Użytkownika B jako 200 zł (50% × 400 zł), zapisuje ten dług i pokazuje: dług Użytkownika B = 200 zł, należność Użytkownika A = 200 zł

#### Acceptance Criteria
- Dług Użytkownika B i należność Użytkownika A są widoczne natychmiast po dodaniu wydatku, bez dodatkowej akcji użytkownika
- Kwota długu Użytkownika B i kwota należności Użytkownika A zawsze się równoważą (są kwotami przeciwnymi wynikającymi z tego samego wydatku)

### US-02: Gospodarz zamyka okres rozliczeniowy i automatycznie otwiera się nowy

- **Given** trwający okres rozliczeniowy dotyczy miesiąca, który już się zakończył (jest co najmniej 1. dzień kolejnego miesiąca), a gospodarz (twórca grupy) ma już potwierdzone jako spłacone wszystkie swoje długi wynikające z wydatków tego okresu
- **When** gospodarz wykonuje akcję zamknięcia okresu rozliczeniowego
- **Then** wydatki z zamkniętego okresu stają się niezmienne (nie można ich edytować/usuwać), a aplikacja automatycznie otwiera nowy, kolejny okres rozliczeniowy, do którego członkowie grupy mogą od razu dodawać nowe wydatki

#### Acceptance Criteria
- Akcja zamknięcia jest widoczna i dostępna tylko dla gospodarza (twórcy grupy) — inni członkowie jej nie widzą i nie mogą jej wykonać
- Jeśli miesiąc, którego dotyczy okres, jeszcze się nie zakończył, akcja zamknięcia jest zablokowana z odpowiednim komunikatem
- Jeśli gospodarz ma niespłacone (niepotwierdzone) własne długi z tego okresu, akcja zamknięcia jest zablokowana z odpowiednim komunikatem
- Bezpośrednio po zamknięciu istnieje dokładnie jeden nowy, otwarty okres rozliczeniowy, a poprzedni jest oznaczony jako zamknięty

## Business Logic

Aplikacja przelicza dług i należność każdego użytkownika na podstawie wydatków uzupełnionych przez wszystkich członków grupy w danym okresie rozliczeniowym.

Wejściem reguły są kwoty i sposób podziału wydatków dodawanych przez członków grupy w bieżącym, otwartym okresie rozliczeniowym (domyślnie miesięcznym). Wyjściem jest saldo (dług lub należność) każdego uczestnika grupy w tym okresie, wyrażone kwotowo.

Saldo jest widoczne natychmiast po dodaniu wydatku przez siebie lub innego domownika, a na jego podstawie użytkownik generuje dane do przelewu rozliczającego dług. Wydatek pozostaje edytowalny tylko dopóki jego okres rozliczeniowy jest otwarty i dopóki powiązany z nim dług nie został potwierdzony jako spłacony przez odbiorcę; okres rozliczeniowy zamyka gospodarz (twórca grupy) manualną akcją, dostępną tylko po zakończeniu kalendarzowego miesiąca i tylko wtedy, gdy własne długi gospodarza z tego okresu zostały potwierdzone jako spłacone — po zamknięciu wydatki z tego okresu stają się niezmienne, a nowy okres rozliczeniowy otwiera się automatycznie.

## Non-Functional Requirements

- NFR-1: Aplikacja jest w pełni użyteczna na urządzeniach mobilnych (telefon), niezależnie od systemu (iOS, Android).
- NFR-2: Aplikacja działa poprawnie w przeglądarce Safari oraz na systemach macOS, Windows i Linux.
- NFR-3: Dane finansowe użytkownika (wydatki, salda, dane do przelewu) są dostępne wyłącznie dla członków danej grupy rozliczeniowej — niewidoczne dla osób spoza grupy i nieuprawnionych stron trzecich.

## Forward: tech-stack

Preferencje dotyczące konkretnych dostawców, zebrane podczas shapingu — nie są częścią PRD (PRD pozostaje neutralny wobec stacku), ale `/10x-tech-stack-selector` powinien je uwzględnić:

- Logowanie: użytkownik wskazał logowanie kontem Google jako preferowany sposób uwierzytelniania (FR-001/FR-013 w PRD są sformułowane neutralnie jako "zewnętrzny dostawca tożsamości").
- Płatności (nice-to-have, odległe): użytkownik wskazał BLIK jako preferowany system płatności mobilnych do automatycznej spłaty długu (FR-012 w PRD sformułowane neutralnie).
- Zamykanie okresu rozliczeniowego (FR-015) jest teraz akcją użytkownika (gospodarza), nie zadaniem harmonogramowym — `/10x-tech-stack-selector` i badanie infrastruktury nie powinny już traktować mechanizmu cron/scheduled function jako wymogu twardego wynikającego z tej funkcji. To był (2026-09-19) główny powód odejścia od domyślnego stacku (Astro/Cloudflare) na Next.js/Vercel — decyzja stacku wymaga ponownego rozważenia w świetle tej zmiany.

## Non-Goals

- Brak automatycznej integracji płatniczej z bankiem/BLIK w MVP — rzeczywista spłata długu odbywa się poza aplikacją (ręczny przelew); automatyzacja pozostaje odległym nice-to-have (FR-012).
- Brak wsparcia wielowalutowości — rozliczenia w grupie odbywają się w jednej walucie.
- Brak zaawansowanej analityki/dashboardów wydatków (wykresy, trendy, predykcje) — poza prostym podsumowaniem miesięcznym/rocznym (FR-011).
- Brak automatycznego (harmonogramowanego, np. cron/scheduled function) zamykania okresu rozliczeniowego w MVP — zamknięcie jest zawsze inicjowane manualną akcją gospodarza grupy (FR-015); eliminuje to zależność od infrastruktury typu scheduled jobs na etapie MVP.
- Brak możliwości przekazania roli gospodarza innemu członkowi grupy w MVP — rola jest trwale przypisana do twórcy grupy (do rozważenia po MVP).
