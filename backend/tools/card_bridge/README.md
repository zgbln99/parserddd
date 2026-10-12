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

## Instalacja na Windows

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

### Jeden plik .exe (opcjonalnie)

```powershell
pip install pyscard pyinstaller
pyinstaller --onefile --name LTS-CardBridge lts_card_bridge.py
```

Plik `dist\LTS-CardBridge.exe` można dodać do autostartu
(`shell:startup`), żeby mostek działał po zalogowaniu do Windows.

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
- `--origin https://inna.domena` (powtarzalne) lub `LTS_BRIDGE_ORIGINS`
  z listą rozdzieloną spacjami, gdy aplikacja działa pod innym adresem.
