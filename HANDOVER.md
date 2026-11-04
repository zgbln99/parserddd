# Przekazanie prac — FleetView / Tachoprüfung (LTS Logistik)

Dokument dla następnego wykonawcy (człowieka albo asystenta AI z dostępem do repo),
który ma kontynuować prace. Opisuje stan na gałęzi `claude/festive-clarke-Kid4W`,
konwencje projektu, jak testować i co jest otwarte. Odpowiedzi dla użytkownika
pisz po polsku; teksty w aplikacji są dwujęzyczne (PL/DE).

## 1. Co to za system

Aplikacja webowa do analizy plików tachografu (karty kierowców `.ddd`) dla firmy
transportowej LTS Logistik GmbH: rozliczenia kierowców, Stundenzettel, Maut
(Toll Collect), pojazdy (Samsara), mapa floty, przebiegi, archiwum plików w MEGA S4.

- **Backend:** Python 3.11, Flask 3, Gunicorn. Fabryka aplikacji `backend/app.py`,
  blueprinty w `backend/routes/*.py` (rejestr w `backend/routes/__init__.py`),
  logika w `backend/services/*.py`, parsery w `backend/core/*.py`.
- **Baza:** SQLite (domyślnie) lub PostgreSQL. Jeden schemat w `backend/database.py`
  (lista `_SCHEMA`, dialekt SQLite, adaptowany do Postgresa; migracje kolumn w
  `_MIGRATIONS` jako krotki `(wersja, tabela, kolumna, definicja)`). Dostęp przez
  `with get_db() as db: db.query(...) / db.query_one(...) / db.execute(...) / db.commit()`.
  Placeholdery `?` zawsze (adapter zamienia na `%s`).
- **Storage:** MEGA S4 (S3-kompatybilne) przez `backend/services/storage_service.py`
  (`download_bytes`, `upload_bytes`, `list_prefix`, `list_folder`, `is_configured`).
  Bez zmiennych `MEGA_S4_*` w env storage jest wyłączony.
- **Auth:** tabela `app_users`, bcrypt, sesja Flask; dekoratory `login_required`,
  `admin_required`, `permission_required('vehicles'|'toll'|...)` w `backend/auth/decorators.py`.
  Log aktywności: `_log_activity(action, detail)` z `backend/auth/helpers.py`.
- **Frontend:** React 19 + Vite 7 + TypeScript + Tailwind v4 w `frontend/`.
  Strony w `src/pages`, komponenty w `src/components`, klient API w `src/lib/api.ts`
  (funkcja `request<T>()` z cookie sesji; 401 przekierowuje na `/login`).
  Tłumaczenia: `src/i18n/pl.ts` i `src/i18n/de.ts` **muszą mieć identyczny zbiór kluczy**
  (typ `TranslationKey` pochodzi z `pl.ts`; brak klucza w `de.ts` = błąd TypeScript).
  Style tylko przez tokeny z `src/styles/globals.css` (`bg-accent`, `text-ink`, `text-muted`,
  `border-border`, `bg-surface-2`, `bg-success-soft`, `.card`, `.kpi kpi-accent`, `.btn-primary`,
  `.btn-secondary`, `.input`, `.btn-press`). Animacje: `data-animate` na kartach (GSAP przez
  `PageTransition`).
- **Build frontendu jest w repo:** `frontend/dist` jest commitowany. Po każdej zmianie w
  `frontend/src` trzeba uruchomić `npm run build` w `frontend/` i dodać `frontend/dist` do commita,
  inaczej serwer dalej serwuje stary interfejs.

## 2. Jak uruchomić lokalnie i testować

```bash
# backend
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt pytest
cd backend
DATA_DIR=/tmp/fv DATABASE_FILE=/tmp/fv/app.db ADMIN_USERNAME=admin ADMIN_PASSWORD=TestPass123 \
FLASK_SECRET_KEY=dev ../.venv/bin/gunicorn --bind 127.0.0.1:8000 "app:create_app()"
# testy (bez MEGA, storage jest udawany w conftest)
../.venv/bin/python -m pytest tests/odometer_audit -q

# frontend
cd frontend && npm ci && npx tsc --noEmit -p . && npm run build
```

Serwer serwuje `frontend/dist` pod `/` i API pod `/api/*`. Limiter API: 60 żądań/min na IP
(pliki statyczne są z niego wyłączone). Logowanie: `POST /api/auth/login {username, password}`.

Produkcja: Docker (`docker compose up -d --build`), opis w `DEPLOY.md`. Aktualizacja serwera:
`git pull` + `docker compose up -d --build`; schemat bazy migruje się sam przy starcie.

## 3. Co zostało zrobione w tej serii prac (od najstarszego)

1. **Maut:** podział pojazdu na 2 tury wg zakresu godzin (`TollCollectPage.tsx`).
2. **Porządki:** logowanie login+hasło z bcrypt, użytkownicy/logi/konfiguracja w bazie,
   usunięte moduły (km kierowców, diagnostyka, wykroczenia, siatka zbiorcza, terminy, karty
   paliwowe, km dzień/noc) i silniki compliance. Martwe pliki stron wciąż fizycznie są w repo
   i są wykluczone w `frontend/tsconfig.json` (`exclude`); można je usunąć `git rm`.
3. **Nowy wygląd** (ciemny pasek nawigacji, tokeny kolorów, GSAP), pasek górny z jednym
   przyciskiem okresu (`DateFilterPopover`).
4. **Czytnik kart USB:** lokalny mostek PC/SC `backend/tools/card_bridge/lts_card_bridge.py`
   (serwer HTTP na 127.0.0.1:27182, CORS na `https://dd.ltslog.de`), budowany do `.exe` przez
   GitHub Actions `.github/workflows/card-bridge.yml` (artefakt `LTS-CardBridge`), wgrywany
   przez admina (`POST /api/admin/card-bridge`) i serwowany kierowcom z Reader page.
   Na Reader page jest tylko mały znacznik „Czytnik USB: połączony/niepołączony”
   (`frontend/src/components/UsbCardReader.tsx`). Znane: Chrome/Edge ≥142 wymagają zgody
   „dostęp do sieci lokalnej” dla https→127.0.0.1; podpowiedź jest w popoverze.
5. **Linki dla księgowości:** `/share/<token>` z hasłem (`backend/routes/fileshare.py`,
   `backend/services/file_share_service.py`, tabela `file_shares`, strona
   `frontend/src/pages/FileSharePage.tsx`, zakładka admina `FileSharesTab.tsx`). Domyślnie po
   niemiecku, wyszukiwanie bez znaków diakrytycznych (`frontend/src/lib/text.ts`, używane też
   na stronie Kierowcy i w globalnej wyszukiwarce).
6. **Przebieg na koniec roku (audyt licznika)** — główne, najnowsze narzędzie, opis niżej.

## 4. Narzędzie „Przebieg roczny” (odometer audit) — stan i architektura

Cel: dla kontroli podać stan licznika każdej ciężarówki na 31.12 danego roku (np. 2021),
bez danych z kart pojazdów, na podstawie ~6000 plików z archiwum: kart kierowców **i**
odczytów tachografów pojazdów (VU).

### Backend

- `backend/core/card_vehicles.py` — czysty parser karty kierowcy (TLV `FID TYPE LEN DATA`):
  `EF_Vehicles_Used` (0x0505, rekordy Gen1 31 B / Gen2 48 B) i `EF_Identification` (0x0520).
  Zwraca `{card_number, holder, records:[{plate, nation, vin, odo_begin, odo_end, first_use, last_use}]}`.
- `backend/core/vu_odometer.py` — parser pliku VU (bloki `0x76 <TREP>`; Gen1 01..05 wg
  szerokości rekordów z Annex 1B, Gen2 21..25 i Gen2v2 31..35 jako tablice rekordów
  `typ(1) rozmiar(2) liczba(2)`). Zwraca rejestrację, VIN, `days:[{day, at, odo}]`
  (licznik o północy) i `card_records` (włożenia/wyjęcia kart). **Zweryfikowany tylko na
  plikach syntetycznych** (`backend/tests/odometer_audit/synth_vu.py`), nie na prawdziwych VU.
- `backend/services/odometer_audit.py` — cała logika:
  - rozpoznanie typu pliku po zawartości (`is_vu_file`), `ingest_file` → `card_scan_files`
    (kolumny `kind` card/vu, `plate`), `card_vehicle_usage` (wpisy kart i wpisy kart z VU),
    `vu_odometer_days` (licznik o północy, unikalny per `source, plate_norm, day`);
  - **źródła (`SOURCES = drivers | mega | archive`) są rozdzielone**: każdy wiersz ma `source`,
    skan i raport dotyczą zawsze jednego źródła. `drivers` = foldery kierowców
    `SYNC_DEST_FOLDER/<kierowca>/*`, `mega` = foldery wskazane ręcznie (zapis w `app_settings`
    pod kluczem `odometer_audit_folders`), `archive` = uploady (`ODOMETER_AUDIT_FOLDER`,
    domyślnie `/Archiv-Fahrerkarten/<nr karty lub VU_<rejestracja>>/<plik>`);
  - skan w wątku (`start_scan(source, force, refresh_list)`, status w `ScanState`, 4 równoległe
    pobrania, pomijanie plików już w bazie o tym samym rozmiarze);
  - rozszerzenia uznawane za pliki tachografu: `.ddd .c1b .esm .tgd .dat .v1b .v2b .vub`;
    w folderach wybranych ręcznie z MEGA próbowany jest każdy plik poza dokumentami;
  - normalizacja rejestracji `normalize_plate` („TF LS 2262” = „TF LS2262” = `TFLS2262`);
  - `year_report(year, source)`: cutoff = 31.12 23:59:59 Europe/Berlin; odczyty z kart
    (wyjęcie przed / włożenie po) i z VU (północ) są scalane; **odczyt VU z 1.01 00:00 wygrywa**
    (`kind='midnight'`, gap 0); jakość `exact` (≤3 dni) / `ok` (≤14) / `gap`; dodatkowo
    stan rok wcześniej, km w roku, wpisy w roku, liczba dni VU;
  - `vehicle_timeline` — wpisy ±45 dni wokół końca roku (karty + północ VU);
  - `ensure_schema()` uruchamiane w `app.py` przed `init_db()`: wykrywa starą wersję tabel
    (bez kolumny `source`) i kasuje je (to cache, odtwarza je ponowny skan).
- `backend/routes/odometer_audit.py` — uprawnienie `vehicles`:
  `GET summary`, `POST scan {source, force, refresh}`, `POST scan/cancel`, `GET scan/status`,
  `POST upload (multipart files[], keep=1|0)`, `GET report?year&source`,
  `GET vehicle?plate&year&source&days`, `GET files?errors=1`, `GET storage/browse?path`,
  `GET/PUT folders`, `POST reset` (admin).
- `backend/services/storage_service.list_folder(path)` — jeden poziom drzewa (CommonPrefixes).

### Frontend

- `frontend/src/pages/OdometerAuditPage.tsx` — strona `/odometer-audit` (menu „Przebieg roczny” /
  „Km-Stand Jahresende”): przełącznik źródła (zapamiętany w `localStorage` `oa-source`),
  przyciski skanu per źródło z paskiem postępu (polling co 2,5 s), strefa uploadu
  (pliki/folder/ZIP w paczkach ≤150 plików i ≤12 MB; limit serwera 16 MB), lista folderów MEGA
  z modalem `FolderPicker`, KPI, tabela z rozwijaną osią czasu, eksporty.
- `frontend/src/lib/odometer-audit-export.ts` — Excel (xlsx-js-style, 2 arkusze) i PDF
  (jsPDF + autotable, czcionka Inter z `public/fonts`), oba z podpisem
  „Erstellt mit LTS Tachoanalyzer (FleetView)” (stała `TOOL` w tym pliku).
- Typy API: `frontend/src/lib/api.ts` (sekcja „Year-end odometer audit”).
- Klucze i18n z prefiksem `oa` w `pl.ts`/`de.ts`.

### Testy

`backend/tests/odometer_audit/` (pytest, bez MEGA): parsery na dwóch prawdziwych kartach z repo
(`backend/tachograph-1880301040190000-...ddd`, `C_20260312_1153_T_Goliasz_...DDD`) i na
syntetycznych VU; przepływ serwisu (skan per źródło, upload ZIP i deduplikacja, VU w raporcie,
przeglądarka folderów). Uruchomienie: `cd backend && python -m pytest tests/odometer_audit -q`.

## 5. Co jest otwarte / następne kroki

1. **Weryfikacja parsera VU na prawdziwych plikach.** Po skanie archiwum użytkownika sprawdzić
   listę „Pliki z błędami” (`GET /api/odometer-audit/files?errors=1`). Typowe ryzyka: inna
   kolejność bloków, bloki producenta (`0x76 0x8x`), inne szerokości rekordów Gen1 — poprawki
   w `core/vu_odometer.py`, test dopisać w `tests/odometer_audit/test_parsers.py`
   (generator `synth_vu.py` można rozszerzyć o nowy wariant).
2. Jeśli prawdziwe pliki VU dostarczą `odometer at midnight` dla 1.01, raport pokazuje je
   jako „VU”; sprawdzić z użytkownikiem, czy taka interpretacja (stan na przełomie roku = licznik
   o północy 1.01 wg UTC) odpowiada kontroli.
3. Skan 6000 plików: sekwencyjne wstawianie do SQLite; przy problemach z czasem rozważyć
   większą pulę pobrań lub batchowe commity w `ingest_file`.
4. Użytkownik nie chce płatnych integracji AI; compliance ma być później przez zewnętrzne API.
5. Pozostałe propozycje z przeglądu (nie zamawiane): ustawienia Maut w bazie, jedna biblioteka
   Excel, powiadomienia, worker/scheduler, CI dla testów.

## 6. Konwencje pracy

- Gałąź: `claude/festive-clarke-Kid4W`; małe, opisowe commity (po polsku lub angielsku);
  nigdy nie commitować sekretów; `.env.example` opisuje zmienne.
- Każda zmiana frontendu = `npx tsc --noEmit -p .` + `npm run build` + commit `frontend/dist`.
- Każda nowa funkcja backendu = test w `backend/tests/` (wzorzec: `tests/odometer_audit/conftest.py`
  z `FakeStorage` i `app_env`).
- Przy nowych tabelach: dodać `CREATE TABLE IF NOT EXISTS` do `_SCHEMA`; nowe kolumny w
  istniejących tabelach tylko przez `_MIGRATIONS` (kolejny numer wersji).
- Teksty w UI: zawsze klucz w `pl.ts` i `de.ts`; na stronie `/share` domyślny język to niemiecki.
