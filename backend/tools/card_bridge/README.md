# LTS Card Bridge — czytnik kart kierowców przez USB

Mały program uruchamiany na komputerze dyspozytora. Czyta kartę kierowcy
z czytnika kart (PC/SC, dowolny czytnik USB ze sterownikiem CCID), buduje
plik `.ddd` zgodnie z załącznikiem IC, dodatek 7, i podaje go stronie
**Czytnik kart** w FleetView, która zapisuje plik w chmurze (MEGA S4)
w folderze kierowcy.

Przeglądarka sama nie dostanie się do czytnika (system zajmuje go przez
sterownik), dlatego potrzebny jest mostek. Działa tylko lokalnie
(`http://127.0.0.1:27182`) i odpowiada wyłącznie stronie
`https://dd.ltslog.de` (plus localhost do developmentu).

## Instalacja na Windows (zalecana: jeden plik .exe)

1. Na stronie **Czytnik kart** kliknij „Pobierz LTS-CardBridge.exe”
   (przycisk pojawia się, gdy administrator wgrał plik w Admin → Konfiguracja).
2. Uruchom plik. W zasobniku (obok zegara) pojawi się niebieska ikona karty.
   Program sam dodaje się do autostartu Windows (klucz Run w HKCU, bez
   uprawnień administratora). Menu ikony: status czytnika, „Otwórz
   FleetView”, „Pokaż log”, „Uruchamiaj z Windows”, „Zakończ”.
3. Podłącz czytnik, włóż kartę i wróć na stronę Czytnik kart.

Log działania: `%LOCALAPPDATA%\LTSCardBridge\bridge.log`.
Windows SmartScreen może ostrzec przed niepodpisanym plikiem: „Więcej
informacji” → „Uruchom mimo to”.

### Skąd wziąć .exe

Workflow GitHub Actions **Card Bridge EXE** (`.github/workflows/card-bridge.yml`)
buduje plik na Windows przy każdej zmianie w tym katalogu, ręcznie
(„Run workflow”) albo dla tagu `bridge-v*` (wtedy dodaje go do release).
Pobierz artefakt `LTS-CardBridge` i wgraj plik w FleetView:
Admin → Konfiguracja → „Mostek czytnika kart”. Lokalnie: `build-exe.ps1`.

## Instalacja ze źródeł (Python)

1. Zainstaluj Pythona 3.12 z <https://www.python.org/downloads/windows/>
   (zaznacz „Add python.exe to PATH”).
2. Pobierz `lts_card_bridge.py` ze strony Czytnik kart (przycisk
   „Pobierz mostek”) albo z tego katalogu.
3. W PowerShell:

   ```powershell
   pip install pyscard
   python lts_card_bridge.py
   ```

4. Podłącz czytnik, włóż kartę kierowcy, otwórz stronę Czytnik kart.
   Sekcja „Czytnik kart USB” pokaże status mostka i przycisk
   „Pobierz z karty”.

Windows ma wbudowaną usługę kart inteligentnych; nie trzeba instalować
nic więcej. Na Linuksie potrzebne są `pcscd` i `libccid`.

Tryb konsolowy nie dodaje się do autostartu; zrobi to
`python lts_card_bridge.py --install-autostart` (`--uninstall-autostart`
cofa wpis).

## Co robi podczas pobierania

- czyta EF_ICC i EF_IC, potem wszystkie pliki aplikacji Gen1
  (`Tachograph`) i, jeśli karta jest Gen2, aplikacji `Tachograph_G2`
  łącznie z plikami Gen2 v2 (GNSS, przekroczenia granic, załadunki),
- dla plików wymaganych przez rozporządzenie pobiera podpis karty
  (PERFORM HASH OF FILE + PSO:COMPUTE DIGITAL SIGNATURE),
- składa plik TLV: `FID + 00/01` dla Gen1 (dane/podpis) i `FID + 02/03`
  dla Gen2,
- po udanym pobraniu zapisuje na karcie datę pobrania (EF_Card_Download),
  tak jak każde narzędzie do pobierania.

Nazwa pliku: `{numer karty}_{RRRR-MM-DD}.ddd`, czyli tak jak pliki
z synchronizacji Samsara.

## Test bez czytnika

```powershell
python lts_card_bridge.py --selftest
```

Uruchamia logikę pobierania na symulowanej karcie i sprawdza strukturę
pliku. Nie zastępuje testu na prawdziwej karcie.

## Parametry

- `--port 27182` (lub zmienna `LTS_BRIDGE_PORT`)
- `--tray` ikona w zasobniku (domyślne dla .exe), `--console` wymusza konsolę
- `--install-autostart` / `--uninstall-autostart`
- `--origin https://inna.domena` (powtarzalne) lub `LTS_BRIDGE_ORIGINS`
  z listą rozdzieloną spacjami, gdy aplikacja działa pod innym adresem.

## Mostek działa, a strona pokazuje „Czytnik USB: niepołączony”

1. Otwórz w nowej karcie `http://127.0.0.1:27182/status`. Jeśli widać JSON
   z nazwą czytnika, mostek działa i winna jest przeglądarka (punkt 2).
   Jeśli nie, mostek nie działa: sprawdź ikonę w zasobniku i plik
   `%LOCALAPPDATA%\LTSCardBridge\bridge.log`.
2. Chrome i Edge (od wersji 142) pytają o zgodę, zanim strona https
   połączy się z `127.0.0.1` („dostęp do sieci lokalnej”). Kliknij
   „Zezwól”, gdy pojawi się pytanie. Jeśli zgoda została wcześniej
   odrzucona: kliknij ikonę obok adresu strony → Uprawnienia → „Dostęp do
   sieci lokalnej” (Local network access) → Zezwól i odśwież stronę.
3. W `bridge.log` po otwarciu strony powinna pojawić się linia
   `Connected from https://dd.ltslog.de`. Jej brak oznacza, że przeglądarka
   nie wysyła żądań do mostka (punkt 2). Linia `Origin not allowed` oznacza,
   że aplikacja działa pod innym adresem: uruchom mostek z
   `--origin https://adres.aplikacji`.
