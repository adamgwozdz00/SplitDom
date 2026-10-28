---
project: "SplitDom"
version: 1
status: draft
created: 2026-09-18
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: "# TODO: qps — see Open Questions"
  data_volume: "# TODO: data_volume — see Open Questions"
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

# SplitDom — PRD

## Vision & Problem Statement

Osoby współdzielące koszty gospodarstwa domowego — małżonkowie lub współlokatorzy (np. grupa studentów wynajmująca mieszkanie) — co okres rozliczeniowy (zwykle miesiąc) ręcznie rozliczają wspólne wydatki: budują i duplikują arkusze Excel z regułami podziału, przeglądają historię konta bankowego, żeby zebrać transakcje, i sumują kwoty na kalkulatorze. Ta praca jest żmudna i powtarzalna, dane o wydatkach są rozproszone (historia banku, arkusze), a dodatkowo trzeba koordynować z domownikami, kto komu jest winien.

To narzędzie powstaje na własny użytek — ma zastąpić Excel dla siebie i swoich współlokatorów/małżonka, a nie konkurować funkcjonalnie z istniejącymi aplikacjami do dzielenia wydatków (np. Splitwise). Wartość leży w dopasowaniu do własnego przepływu rozliczeń, nie w przewadze rynkowej.

## User & Persona

Osoba współdzieląca koszty gospodarstwa domowego z innymi — małżonek/partner lub współlokator (np. w grupie studenckiej wynajmującej mieszkanie). Sięga po produkt w momencie okresowego (zwykle comiesięcznego) rozliczenia wspólnych wydatków, żeby uniknąć ręcznego prowadzenia arkusza i przegrzebywania historii konta bankowego. Ta sama persona obejmuje oba przypadki użycia (małżonkowie i współlokatorzy) bez rozróżnienia na etapie MVP.

## Success Criteria

### Primary
- Pełny cykl działa od zalogowania po zamknięcie długu: logowanie przez zewnętrznego dostawcę tożsamości → utworzenie grupy rozliczeniowej → zaproszenie współlokatora linkiem/kodem zaproszenia → dodanie wydatków przez członków grupy → poprawne wyliczenie salda/długu każdego uczestnika → wygenerowanie danych do przelewu → oznaczenie przelewu jako wysłanego przez nadawcę → oznaczenie długu jako spłaconego przez odbiorcę.

### Secondary
- Generowanie kodu QR do zeskanowania i zapłaty w banku.
- Automatyczna spłata długu przez integrację z bankiem lub popularnym w Polsce systemem płatności mobilnych.
- Kategoryzacja wydatków (np. opłaty mieszkaniowe, zakupy spożywcze, wyjścia).
- Podsumowanie kosztów w ujęciu miesięcznym/rocznym.

### Guardrails
- Prywatność danych finansowych między grupami — dane jednej grupy rozliczeniowej nie są widoczne dla osób spoza niej.
- Poprawność wyliczeń salda — kwoty długu muszą się zawsze zgadzać (suma wydatków = suma przypisanych udziałów).
- Brak możliwości modyfikacji wpisu wydatku należącego do innej osoby przez kogoś innego niż jego autor.

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
- **Then** wydatki z zamkniętego okresu stają się niezmienne (nie można ich edytować/usuwać), a aplikacja automatycznie otwiera okres na następny miesiąc kalendarzowy, do którego członkowie grupy mogą od razu dodawać nowe wydatki; niezerowe, rozliczone (zaksięgowane) długi między członkami przechodzą do niego jako długi przeniesione z poprzedniego miesiąca, a wpłaty oczekujące na potwierdzenie przechodzą do niego bez zmian i odbiorca może je tam nadal potwierdzić lub odrzucić

#### Acceptance Criteria
- Akcja zamknięcia jest widoczna i dostępna tylko dla gospodarza (twórcy grupy) — inni członkowie jej nie widzą i nie mogą jej wykonać
- Jeśli miesiąc, którego dotyczy okres, jeszcze się nie zakończył, akcja zamknięcia jest zablokowana z odpowiednim komunikatem
- Jeśli gospodarz ma niespłacone (niepotwierdzone) własne długi z tego okresu, akcja zamknięcia jest zablokowana z odpowiednim komunikatem
- Bezpośrednio po zamknięciu istnieje dokładnie jeden nowy, otwarty okres rozliczeniowy (następnego miesiąca), a poprzedni jest oznaczony jako zamknięty
- Salda (oczekujące i zaksięgowane) każdego członka i każdej pary są bezpośrednio po zamknięciu takie same jak w chwili zamknięcia; długi przeniesione z poprzedniego miesiąca są widoczne w nowym okresie osobno od wydatków

## Functional Requirements

### Konto i grupa rozliczeniowa
- FR-001: Użytkownik może zalogować się przy użyciu zewnętrznego dostawcy tożsamości. Priority: must-have
  > Socrates: Counter-argument considered: "poleganie wyłącznie na jednym zewnętrznym dostawcy tożsamości wyklucza osoby bez konta u tego dostawcy." Resolution: MVP zaczyna od jednego dostawcy tożsamości; logowanie e-mail+hasło jako alternatywa przechodzi do nice-to-have (FR-013).
- FR-002: Użytkownik może utworzyć grupę rozliczeniową ("mieszkanie"). Użytkownik może tworzyć dowolną liczbę grup i należeć do wielu grup naraz. Priority: must-have
  > Socrates: Counter-argument considered: "jedna osoba może chcieć dzielić koszty i z małżonkiem, i ze współlokatorami naraz — brak obsługi wielu grup." Resolution: pierwotnie świadome uproszczenie na MVP (jedna grupa na użytkownika); zmienione 2026-10-02 podczas planowania S-02 — użytkownik może tworzyć wiele grup i należeć do wielu grup, a grupę wybiera się w aplikacji (osobna strona każdej grupy).
- FR-003: Użytkownik może zaprosić inną osobę do grupy, generując link/kod zaproszenia, który samodzielnie wysyła wybranym przez siebie kanałem (e-mail, SMS, komunikator). Priority: must-have
  > Socrates: Counter-argument considered: "wysyłka e-maila zaproszenia z serwera aplikacji to dodatkowa zależność zewnętrzna." Resolution: zastąpione generowaniem linku/kodu zaproszenia do ręcznego wysłania — bez integracji z serwisem mailowym po stronie aplikacji.

### Wydatki i rozliczenia
- FR-004: Członek grupy może dodać wydatek w ramach bieżącego, otwartego okresu rozliczeniowego; wydatek jest domyślnie dzielony po równo między wszystkich członków grupy. Priority: must-have
  > Socrates: Counter-argument considered: "większość wydatków domowych dzieli się po równo — elastyczny podział (własne kwoty / wybrani członkowie) to nadmiarowa praca na MVP." Resolution: uproszczone do stałego podziału równego w MVP; niestandardowy podział przechodzi do nice-to-have (FR-014).
- FR-005: Aplikacja wylicza saldo/dług każdego członka grupy na podstawie dodanych wydatków w danym okresie rozliczeniowym. Wydatek nie może być edytowany ani usunięty, gdy jego okres rozliczeniowy jest zamknięty (zamknięcie okresu opisane w FR-015) lub gdy odbiorca potwierdził wpłatę między płatnikiem tego wydatku a członkiem, który ma w nim udział (potwierdzona wpłata blokuje wszystkie wydatki tej pary w okresie, także dodane później). Potwierdzone wpłaty najpierw spłacają dług przeniesiony z poprzedniego miesiąca w tym samym kierunku: wydatki pary blokują się dopiero wtedy, gdy suma potwierdzonych wpłat w jednym kierunku przekroczy ten przeniesiony dług. Wpłaty oczekujące na potwierdzenie i odrzucone nie blokują wydatków. Priority: must-have
  > Socrates: Counter-argument considered: "edycja/usunięcie wydatku po fakcie komplikuje już rozliczone saldo." Resolution: wydatek jest blokowany do edycji/usunięcia po zamknięciu okresu rozliczeniowego lub po oznaczeniu powiązanego długu jako spłaconego — pierwsze z tych dwóch zdarzeń obowiązuje.
- FR-015: Gospodarz (twórca grupy) może zamknąć bieżący, otwarty okres rozliczeniowy — tylko gdy (a) kalendarzowy miesiąc, którego dotyczy okres, już się zakończył, oraz (b) wszystkie długi, w których gospodarz jest dłużnikiem za wydatki z tego okresu, zostały oznaczone jako spłacone przez ich odbiorców. Zamknięcie okresu automatycznie otwiera okres na następny miesiąc kalendarzowy: niezerowe długi między członkami, liczone z sald zaksięgowanych, przechodzą do niego jako długi przeniesione, a wpłaty oczekujące na potwierdzenie przechodzą do niego bez zmian. Wydatki zostają w zamkniętym okresie, który jest niezmienny. Priority: must-have
  > Socrates: Counter-argument considered: "gospodarz mógłby zamykać okres wedle własnej wygody, ignorując nierozliczone długi innych członków — nadmierna władza jednej osoby." Resolution: zamknięcie nie wymaga rozliczenia długów innych członków, ale jest blokowane, dopóki własne długi gospodarza (jako dłużnika) z tego okresu nie zostaną potwierdzone jako spłacone — to ogranicza możliwość zamykania okresu bez wywiązania się z własnych zobowiązań.
- FR-006: Aplikacja wylicza minimalny zestaw przelewów rozliczających całą grupę naraz (zamiast rozliczać każdą parę osobno). Priority: nice-to-have
  > Socrates: Counter-argument considered: "zbędna złożoność algorytmiczna na MVP — rozliczanie parami też rozwiązuje problem, mniej optymalnie, ale prościej." Resolution: zdegradowane z must-have do nice-to-have; MVP rozlicza pary osobno.

### Rozliczenie i przelewy
- FR-007: Użytkownik może wygenerować dane do przelewu rozliczającego dług wobec innego członka grupy — tekst do ręcznego skopiowania: numer konta, kwota, tytuł przelewu. Priority: must-have
  > Socrates: Counter-argument considered: "bez integracji z konkretnym bankiem format danych może nie pasować do żadnej bankowości." Resolution: dane mają uniwersalny, tekstowy format (numer konta, kwota, tytuł) do ręcznego wklejenia w dowolnej bankowości elektronicznej.
- FR-008: Nadawca przelewu może zapisać go w aplikacji jako wysłaną wpłatę (kwota, data). Wpłata liczy się w saldach od razu jako oczekująca na potwierdzenie, nie może przekraczać bieżącego długu, a nadawca może ją wycofać, dopóki odbiorca jej nie potwierdzi. Priority: must-have
  > Socrates: Counter-argument considered: "brak weryfikacji, że przelew faktycznie wysłano — możliwe nadużycie." Resolution: wysłana wpłata zmienia salda oczekujące (widoczne dla grupy, z adnotacją "oczekuje na potwierdzenie"), bo saldo ma odzwierciedlać pieniądze, które faktycznie przeszły — samo przypomnienie poza saldami rozjeżdżało się z rzeczywistym długiem. Ostatnie słowo należy do odbiorcy: dopiero jego potwierdzenie (FR-009) czyni wpłatę ostateczną (zaksięgowaną), a odrzucenie ją usuwa.
- FR-009: Odbiorca przelewu może potwierdzić wpłatę po otrzymaniu przelewu albo ją odrzucić — potwierdzenie czyni wpłatę ostateczną (wlicza ją do sald zaksięgowanych, na których opierają się reguły, np. zamknięcie okresu FR-015, i blokuje edycję wydatków tej pary, FR-005). Odrzucenie usuwa wpłatę z sald (dług nadawcy wraca), ale pozostawia ją widoczną dla grupy ze statusem „odrzucona”. Potwierdzenie i odrzucenie są ostateczne — jeśli pieniądze jednak dotarły, nadawca rejestruje nową wpłatę. Priority: must-have
  > Socrates: Counter-argument considered: "odbiorca może zapomnieć/zwlekać z potwierdzeniem, więc dług formalnie zostaje otwarty mimo otrzymanej wpłaty." Resolution: zaakceptowane — wpłata widnieje jako "oczekująca" aż do potwierdzenia przez odbiorcę i w międzyczasie zmniejsza saldo oczekujące; brak dodatkowej logiki na MVP.

### Funkcje dodatkowe (nice-to-have)
- FR-010: Użytkownik może wygenerować kod QR do zapłaty w banku. Priority: nice-to-have
  > Socrates: Counter-argument considered: "wymaga znajomości konkretnego standardu QR płatności — ryzyko niezgodności z bankowościami." Resolution: ryzyko zaakceptowane; funkcja zostaje jako nice-to-have do rozważenia po MVP.
- FR-011: Użytkownik może kategoryzować wydatki (np. opłaty mieszkaniowe, zakupy spożywcze, wyjścia) i zobaczyć podsumowanie kosztów w tych kategoriach w ujęciu miesięcznym/rocznym. Priority: nice-to-have
  > Socrates: Counter-argument considered: "kategoryzacja bez podsumowań nie daje samodzielnej wartości." Resolution: połączone w jedną funkcję nice-to-have — kategorie i podsumowania wdrażane razem.
- FR-012: Użytkownik może spłacić dług automatycznie poprzez integrację z popularnym w Polsce systemem płatności mobilnych. Priority: nice-to-have
  > Socrates: Counter-argument considered: "integracja płatnicza niesie duży zakres regulacyjny i techniczny, nieproporcjonalny do reszty projektu." Resolution: ryzyko zaakceptowane; zostaje jako odległy kierunek rozwoju, nie blokuje MVP.
- FR-013: Użytkownik może zalogować się e-mailem i hasłem jako alternatywa dla logowania przez zewnętrznego dostawcę tożsamości. Priority: nice-to-have
- FR-014: Osoba dodająca wydatek może wybrać niestandardowy sposób podziału (własne kwoty / tylko wybrani członkowie) zamiast domyślnego podziału równego. Priority: nice-to-have

## Non-Functional Requirements

- NFR-1: Aplikacja jest w pełni użyteczna na urządzeniach mobilnych (telefon), niezależnie od systemu (iOS, Android).
- NFR-2: Aplikacja działa poprawnie w przeglądarce Safari oraz na systemach macOS, Windows i Linux.
- NFR-3: Dane finansowe użytkownika (wydatki, salda, dane do przelewu) są dostępne wyłącznie dla członków danej grupy rozliczeniowej — niewidoczne dla osób spoza grupy i nieuprawnionych stron trzecich.

## Business Logic

Aplikacja przelicza dług i należność każdego użytkownika na podstawie wydatków uzupełnionych przez wszystkich członków grupy w danym okresie rozliczeniowym.

Wejściem reguły są kwoty i sposób podziału wydatków dodawanych przez członków grupy w bieżącym, otwartym okresie rozliczeniowym (domyślnie miesięcznym). Wyjściem jest saldo (dług lub należność) każdego uczestnika grupy w tym okresie, wyrażone kwotowo.

Saldo jest widoczne natychmiast po dodaniu wydatku przez siebie lub innego domownika, a na jego podstawie użytkownik generuje dane do przelewu rozliczającego dług. Wydatek pozostaje edytowalny tylko dopóki jego okres rozliczeniowy jest otwarty i dopóki powiązany z nim dług nie został potwierdzony jako spłacony przez odbiorcę; okres rozliczeniowy zamyka gospodarz (twórca grupy) manualną akcją, dostępną tylko po zakończeniu kalendarzowego miesiąca i tylko wtedy, gdy własne długi gospodarza z tego okresu zostały potwierdzone jako spłacone — po zamknięciu wydatki z tego okresu stają się niezmienne, a okres na następny miesiąc otwiera się automatycznie, z długami przeniesionymi z poprzedniego miesiąca i z wpłatami oczekującymi na potwierdzenie. Niespłacone długi innych członków nie blokują zamknięcia, ale też nie giną: przechodzą do nowego okresu, gdzie można je spłacać i potwierdzać.

## Access Control

Logowanie (email+hasło lub OAuth) — każdy użytkownik ma własne konto i loguje się z dowolnego urządzenia. W obrębie grupy rozliczeniowej (np. mieszkania/gospodarstwa) obowiązuje w większości płaski model uprawnień: każdy członek grupy może dodawać wydatki i widzieć pełne rozliczenie grupy. Jedyny wyjątek: twórca grupy ("gospodarz") ma dodatkowe, wyłączne uprawnienie do zamykania bieżącego okresu rozliczeniowego (FR-015) — rola gospodarza jest przypisana na trwałe do twórcy grupy w MVP, bez możliwości przekazania. Poza tym uprawnieniem gospodarz nie ma żadnych innych praw administracyjnych — nie może np. usuwać innych członków z grupy.

## Non-Goals

- Brak automatycznej integracji płatniczej (np. z systemem płatności mobilnych) w MVP — rzeczywista spłata długu odbywa się poza aplikacją (ręczny przelew); automatyzacja pozostaje odległym nice-to-have (FR-012).
- Brak wsparcia wielowalutowości — rozliczenia w grupie odbywają się w jednej walucie.
- Brak zaawansowanej analityki/dashboardów wydatków (wykresy, trendy, predykcje) — poza prostym podsumowaniem miesięcznym/rocznym (FR-011).
- Brak automatycznego, harmonogramowego zamykania okresu rozliczeniowego w MVP — zamknięcie wymaga zawsze manualnej akcji gospodarza grupy (FR-015).
- Brak możliwości przekazania roli gospodarza innemu członkowi grupy w MVP — rola jest trwale przypisana do twórcy grupy.

## Open Questions

1. **Jaki jest oczekiwany wolumen zapytań (qps) przy docelowej skali?** — Owner: user. By: przed uruchomieniem `/10x-tech-stack-selector`. Block: no.
2. **Jaki jest oczekiwany wolumen danych (data volume)?** — Owner: user. By: przed uruchomieniem `/10x-tech-stack-selector`. Block: no.
