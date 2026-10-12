# Builds LTS-CardBridge.exe on Windows (needs Python 3.12 on PATH).
#   powershell -ExecutionPolicy Bypass -File build-exe.ps1
$ErrorActionPreference = "Stop"
python -m pip install --upgrade pip
python -m pip install -r requirements.txt pyinstaller
python lts_card_bridge.py --selftest
python -c "from lts_card_bridge import _tray_icon_image; _tray_icon_image().save('bridge.ico', sizes=[(16,16),(32,32),(48,48),(64,64)])"
python -m PyInstaller --onefile --noconsole --name LTS-CardBridge --icon bridge.ico `
  --hidden-import smartcard.scard --hidden-import pystray._win32 --hidden-import PIL.Image `
  lts_card_bridge.py
Write-Host "Built: dist\LTS-CardBridge.exe"
