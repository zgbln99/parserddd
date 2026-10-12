#!/usr/bin/env python3
"""
LTS Card Bridge — reads a tachograph driver card from a USB smart-card
reader (PC/SC) and hands the resulting .DDD file to the FleetView web app.

Why a bridge: a browser cannot talk to a smart-card reader directly (the
operating system owns the reader through its CCID driver), so this small
program runs on the dispatcher's PC, listens on http://127.0.0.1:27182 and
answers two requests from the web app:

    GET  /status   -> readers, card present?, bridge version
    POST /read     -> downloads the card and returns the .DDD (base64)

The download follows Annex IC Appendix 7 (Regulation (EU) 2016/799):
every EF of the Gen1 "Tachograph" and Gen2 "Tachograph_G2" applications
is read with READ BINARY and, where the regulation requires it, signed by
the card (PERFORM HASH OF FILE + PSO:COMPUTE DIGITAL SIGNATURE). The file
is assembled as TLV records: FID + 0x00/0x01 (Gen1 data/signature) or
FID + 0x02/0x03 (Gen2 data/signature). After a successful download the
card's EF_Card_Download timestamp is updated, like every download tool.

Requirements: Python 3.9+, pyscard (pip install pyscard). On Windows the
PC/SC service is built in; on Linux install pcscd + libccid.

Run:   python lts_card_bridge.py            (console log, Ctrl+C to stop)
       LTS-CardBridge.exe                   (tray icon; adds itself to Windows
                                             autostart on first run)
Test:  python lts_card_bridge.py --selftest (no reader needed)
"""

import argparse
import base64
import json
import os
import struct
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.1.1"
APP_NAME = "LTSCardBridge"
FLEETVIEW_URL = "https://dd.ltslog.de/reader"
IS_WINDOWS = sys.platform.startswith("win")
IS_FROZEN = bool(getattr(sys, "frozen", False))  # running as the PyInstaller .exe
DEFAULT_PORT = 27182
DEFAULT_ORIGINS = [
    "https://dd.ltslog.de",
    "http://localhost:5173",
    "http://localhost:8000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
]

# ---------------------------------------------------------------------------
# Card file system (Appendix 2 of Annex IC)
# ---------------------------------------------------------------------------

AID_GEN1 = [0xFF, 0x54, 0x41, 0x43, 0x48, 0x4F]  # "ÿTACHO"
AID_GEN2 = [0xFF, 0x53, 0x4D, 0x52, 0x44, 0x54]  # "ÿSMRDT"

# (name, FID, signed)
EF_MASTER = [
    ("EF_ICC", 0x0002, False),
    ("EF_IC", 0x0005, False),
]
EF_GEN1 = [
    ("EF_Application_Identification", 0x0501, True),
    ("EF_Card_Certificate", 0xC100, False),
    ("EF_CA_Certificate", 0xC108, False),
    ("EF_Identification", 0x0520, True),
    ("EF_Card_Download", 0x050E, False),
    ("EF_Driving_Licence_Info", 0x0521, True),
    ("EF_Events_Data", 0x0502, True),
    ("EF_Faults_Data", 0x0503, True),
    ("EF_Driver_Activity_Data", 0x0504, True),
    ("EF_Vehicles_Used", 0x0505, True),
    ("EF_Places", 0x0506, True),
    ("EF_Current_Usage", 0x0507, True),
    ("EF_Control_Activity_Data", 0x0508, True),
    ("EF_Specific_Conditions", 0x0522, True),
]
EF_GEN2 = [
    ("EF_Application_Identification", 0x0501, True),
    ("EF_CardMA_Certificate", 0xC100, False),
    ("EF_CardSignCertificate", 0xC101, False),
    ("EF_CA_Certificate", 0xC108, False),
    ("EF_Link_Certificate", 0xC109, False),
    ("EF_Identification", 0x0520, True),
    ("EF_Card_Download", 0x050E, False),
    ("EF_Driving_Licence_Info", 0x0521, True),
    ("EF_Events_Data", 0x0502, True),
    ("EF_Faults_Data", 0x0503, True),
    ("EF_Driver_Activity_Data", 0x0504, True),
    ("EF_Vehicles_Used", 0x0505, True),
    ("EF_Places", 0x0506, True),
    ("EF_Current_Usage", 0x0507, True),
    ("EF_Control_Activity_Data", 0x0508, True),
    ("EF_Specific_Conditions", 0x0522, True),
    ("EF_VehicleUnits_Used", 0x0523, True),
    ("EF_GNSS_Places", 0x0524, True),
    # Gen2 version 2 (optional on older Gen2 cards — skipped when absent)
    ("EF_Application_Identification_V2", 0x0525, True),
    ("EF_Places_Authentication", 0x0526, True),
    ("EF_GNSS_Places_Authentication", 0x0527, True),
    ("EF_Border_Crossings", 0x0528, True),
    ("EF_Load_Unload_Operations", 0x0529, True),
    ("EF_Load_Type_Entries", 0x052A, True),
    ("EF_VU_Configuration", 0x0540, True),
]

CODE_PAGES = {
    0x01: "latin-1", 0x02: "iso8859-2", 0x03: "iso8859-3", 0x05: "iso8859-5",
    0x07: "iso8859-7", 0x09: "iso8859-9", 0x0D: "iso8859-13", 0x0F: "iso8859-15",
    0x10: "iso8859-16", 0x50: "koi8-r", 0x55: "koi8-u",
}


class CardError(Exception):
    pass


_LOG_FILE = None


def _log_path():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    d = os.path.join(base, APP_NAME)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "bridge.log")


def log(msg: str):
    """Console when there is one; always the log file when running as .exe."""
    global _LOG_FILE
    line = f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
    try:
        print(line, flush=True)
    except Exception:
        pass
    if IS_FROZEN:
        try:
            if _LOG_FILE is None:
                _LOG_FILE = open(_log_path(), "a", encoding="utf-8")
            _LOG_FILE.write(line + "\n")
            _LOG_FILE.flush()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# APDU layer — works on anything with transmit(list[int]) -> (data, sw1, sw2)
# ---------------------------------------------------------------------------

class CardSession:
    def __init__(self, connection):
        self.conn = connection
        self.chunk = 0xFE  # READ BINARY size; lowered when the card objects

    def apdu(self, cla, ins, p1, p2, data=None, le=None):
        cmd = [cla, ins, p1, p2]
        if data:
            cmd += [len(data)] + list(data)
        if le is not None:
            cmd.append(le)
        resp, sw1, sw2 = self.conn.transmit(cmd)
        # 61xx: more data available via GET RESPONSE
        while sw1 == 0x61:
            more, sw1, sw2 = self.conn.transmit([0x00, 0xC0, 0x00, 0x00, sw2])
            resp += more
        # 6Cxx: wrong Le, the card tells us the right one
        if sw1 == 0x6C and le is not None:
            cmd[-1] = sw2
            resp, sw1, sw2 = self.conn.transmit(cmd)
        return bytes(resp), (sw1 << 8) | sw2

    def select_mf(self):
        _, sw = self.apdu(0x00, 0xA4, 0x00, 0x0C, [0x3F, 0x00])
        return sw == 0x9000

    def select_df(self, aid):
        _, sw = self.apdu(0x00, 0xA4, 0x04, 0x0C, aid)
        return sw == 0x9000

    def select_ef(self, fid):
        _, sw = self.apdu(0x00, 0xA4, 0x02, 0x0C, [fid >> 8, fid & 0xFF])
        return sw == 0x9000

    def read_binary_all(self, max_len=65535):
        out = bytearray()
        offset = 0
        while offset < max_len:
            le = min(self.chunk, max_len - offset)
            data, sw = self.apdu(0x00, 0xB0, offset >> 8, offset & 0xFF, le=le)
            if sw == 0x6700 and self.chunk > 0x80:      # wrong length: smaller chunks
                self.chunk = 0x80
                continue
            if sw in (0x6B00, 0x6A86):                   # offset beyond EOF
                break
            if sw == 0x9000 or (sw & 0xFF00) == 0x6200:  # ok / EOF reached
                out += data
                offset += len(data)
                if len(data) < le or sw != 0x9000:
                    break
                continue
            raise CardError(f"READ BINARY failed at {offset}: SW={sw:04X}")
        return bytes(out)

    def sign_selected_ef(self, gen2: bool):
        _, sw = self.apdu(0x80, 0x2A, 0x90, 0x00)        # PERFORM HASH OF FILE
        if sw != 0x9000:
            raise CardError(f"PERFORM HASH failed: SW={sw:04X}")
        le = 0x00 if gen2 else 0x80                      # Gen2 signatures vary in size
        sig, sw = self.apdu(0x00, 0x2A, 0x9E, 0x9A, le=le)  # PSO: COMPUTE DIGITAL SIGNATURE
        if sw != 0x9000 or not sig:
            raise CardError(f"PSO:CDS failed: SW={sw:04X}")
        return sig

    def update_binary(self, offset, data):
        _, sw = self.apdu(0x00, 0xD6, offset >> 8, offset & 0xFF, list(data))
        return sw == 0x9000


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def _tlv(fid, kind, payload):
    return struct.pack(">HBH", fid, kind, len(payload)) + payload


def _decode_name(raw: bytes) -> str:
    if not raw:
        return ""
    enc = CODE_PAGES.get(raw[0], "latin-1")
    try:
        return raw[1:].decode(enc, errors="replace").strip(" \x00")
    except LookupError:
        return raw[1:].decode("latin-1", errors="replace").strip(" \x00")


def parse_identification(data: bytes) -> dict:
    """CardIdentification (65 bytes) + DriverCardHolderIdentification (78 bytes)."""
    if len(data) < 143:
        return {}
    card_number = data[1:17].decode("ascii", errors="replace").strip(" \x00")
    member_state = data[0]
    surname = _decode_name(data[65:101])
    first_names = _decode_name(data[101:137])
    expiry = struct.unpack(">I", data[61:65])[0]
    return {
        "card_number": card_number,
        "member_state": member_state,
        "surname": surname,
        "first_names": first_names,
        "expiry": datetime.fromtimestamp(expiry, tz=timezone.utc).strftime("%Y-%m-%d") if expiry else "",
    }


def download_card(session: CardSession, progress=lambda *_: None) -> dict:
    """Read the whole driver card; returns {ddd: bytes, identification, generation}."""
    out = bytearray()
    ident = {}
    steps_done = 0

    def step(name):
        nonlocal steps_done
        steps_done += 1
        progress(name, steps_done)

    # Master file: EF_ICC, EF_IC
    session.select_mf()
    for name, fid, _ in EF_MASTER:
        if not session.select_ef(fid):
            raise CardError(f"{name} not found — is this a tachograph card?")
        data = session.read_binary_all(max_len=64)
        out += _tlv(fid, 0x00, data)
        step(name)

    # Gen1 application
    if not session.select_df(AID_GEN1):
        raise CardError("Tachograph application not found on this card")
    for name, fid, signed in EF_GEN1:
        if not session.select_ef(fid):
            log(f"  {name}: absent, skipped")
            continue
        data = session.read_binary_all()
        out += _tlv(fid, 0x00, data)
        if fid == 0x0520:
            ident = parse_identification(data) or ident
        if signed:
            out += _tlv(fid, 0x01, session.sign_selected_ef(gen2=False))
        step(name)
    gen1_download_fid = 0x050E

    # Gen2 application (present on Gen2 cards only)
    generation = 1
    if session.select_df(AID_GEN2):
        generation = 2
        for name, fid, signed in EF_GEN2:
            if not session.select_ef(fid):
                continue
            data = session.read_binary_all()
            out += _tlv(fid, 0x02, data)
            if fid == 0x0520 and not ident:
                ident = parse_identification(data) or ident
            if signed:
                try:
                    out += _tlv(fid, 0x03, session.sign_selected_ef(gen2=True))
                except CardError as exc:
                    log(f"  {name}: signature failed ({exc}), data kept")
            step(f"{name} (G2)")

    # Record the download on the card (EF_Card_Download = TimeReal, 4 bytes).
    now = struct.pack(">I", int(time.time()))
    try:
        if generation == 2 and session.select_ef(gen1_download_fid):
            session.update_binary(0, now)
        if session.select_df(AID_GEN1) and session.select_ef(gen1_download_fid):
            session.update_binary(0, now)
    except Exception as exc:  # not fatal: the file is already complete
        log(f"  card download timestamp not updated: {exc}")

    return {"ddd": bytes(out), "identification": ident, "generation": generation}


def ddd_filename(ident: dict) -> str:
    card = (ident.get("card_number") or "card").replace("/", "_")
    return f"{card}_{datetime.now().strftime('%Y-%m-%d')}.ddd"


# ---------------------------------------------------------------------------
# PC/SC access (pyscard)
# ---------------------------------------------------------------------------

def _pcsc():
    try:
        from smartcard.System import readers
        from smartcard.Exceptions import NoCardException, CardConnectionException
        return readers, NoCardException, CardConnectionException
    except ImportError as exc:
        raise RuntimeError("pyscard is not installed: pip install pyscard") from exc


def list_readers():
    readers, NoCardException, CardConnectionException = _pcsc()
    out = []
    for r in readers():
        entry = {"name": str(r), "card": False, "atr": ""}
        try:
            c = r.createConnection()
            c.connect()
            entry["card"] = True
            entry["atr"] = bytes(c.getATR()).hex().upper()
            c.disconnect()
        except (NoCardException, CardConnectionException):
            pass
        except Exception as exc:  # pragma: no cover
            entry["error"] = str(exc)
        out.append(entry)
    return out


def read_from_reader(reader_name=None, progress=lambda *_: None) -> dict:
    readers, NoCardException, CardConnectionException = _pcsc()
    candidates = [r for r in readers() if reader_name is None or str(r) == reader_name]
    if not candidates:
        raise CardError("No smart-card reader found")
    last_err = None
    for r in candidates:
        try:
            c = r.createConnection()
            c.connect()
        except (NoCardException, CardConnectionException) as exc:
            last_err = exc
            continue
        try:
            log(f"Reading card in {r}")
            result = download_card(CardSession(c), progress)
            result["reader"] = str(r)
            return result
        finally:
            try:
                c.disconnect()
            except Exception:
                pass
    raise CardError("No card in the reader" if last_err else "No reader available")


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

class Bridge:
    def __init__(self, origins):
        self.origins = set(origins)
        self.lock = threading.Lock()
        self.progress = {"step": "", "count": 0}
        self.seen_origins = set()


def make_handler(bridge: Bridge):
    class Handler(BaseHTTPRequestHandler):
        server_version = f"LTSCardBridge/{VERSION}"

        def log_message(self, fmt, *args):  # quieter default log
            if self.path != "/status" or self.command == "OPTIONS":
                log(f"{self.command} {self.path} {args[1] if len(args) > 1 else ''}")

        def _note_origin(self):
            # One line per site so the log shows whether the browser reaches us at all.
            origin = self.headers.get("Origin") or "(no Origin header)"
            if origin not in bridge.seen_origins:
                bridge.seen_origins.add(origin)
                log(f"Connected from {origin}")

        def _origin_ok(self):
            origin = self.headers.get("Origin")
            return origin is None or origin in bridge.origins

        def _cors(self):
            origin = self.headers.get("Origin")
            if origin and origin in bridge.origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")

        def _json(self, code, payload):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self._cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self._note_origin()
            if not self._origin_ok():
                log(f"Origin not allowed: {self.headers.get('Origin')}")
                self.send_response(403); self.end_headers(); return
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self):
            self._note_origin()
            if not self._origin_ok():
                log(f"Origin not allowed: {self.headers.get('Origin')}")
                return self._json(403, {"error": "origin not allowed"})
            if self.path.startswith("/status"):
                try:
                    readers = list_readers()
                except Exception as exc:
                    return self._json(200, {"ok": False, "version": VERSION, "readers": [], "error": str(exc)})
                return self._json(200, {
                    "ok": True, "version": VERSION, "readers": readers,
                    "card_present": any(r["card"] for r in readers),
                    "busy": bridge.lock.locked(), "progress": bridge.progress,
                })
            return self._json(404, {"error": "not found"})

        def do_POST(self):
            if not self._origin_ok():
                return self._json(403, {"error": "origin not allowed"})
            if not self.path.startswith("/read"):
                return self._json(404, {"error": "not found"})
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}") if length else {}
            if not bridge.lock.acquire(blocking=False):
                return self._json(409, {"error": "a download is already running"})
            try:
                def progress(step, count):
                    bridge.progress = {"step": step, "count": count}
                t0 = time.time()
                result = read_from_reader(body.get("reader"), progress)
                ident = result["identification"]
                log(f"Done: {ident.get('surname', '')} {ident.get('first_names', '')} "
                    f"{ident.get('card_number', '')} — {len(result['ddd'])} bytes, {time.time() - t0:.1f}s")
                return self._json(200, {
                    "ok": True,
                    "filename": ddd_filename(ident),
                    "size": len(result["ddd"]),
                    "generation": result["generation"],
                    "reader": result["reader"],
                    "identification": ident,
                    "data_b64": base64.b64encode(result["ddd"]).decode("ascii"),
                })
            except CardError as exc:
                log(f"Card error: {exc}")
                return self._json(422, {"error": str(exc)})
            except Exception as exc:
                log(f"Error: {exc}")
                return self._json(500, {"error": str(exc)})
            finally:
                bridge.progress = {"step": "", "count": 0}
                bridge.lock.release()

    return Handler


def serve(port, origins, bridge=None, block=True):
    bridge = bridge or Bridge(origins)
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(bridge))
    except OSError as exc:
        log(f"Port {port} is busy — another LTS Card Bridge is probably running ({exc})")
        return None
    log(f"LTS Card Bridge {VERSION} listening on http://127.0.0.1:{port}")
    log(f"Allowed origins: {', '.join(sorted(origins))}")
    try:
        readers = list_readers()
        log("Readers: " + (", ".join(r["name"] for r in readers) or "none found"))
    except Exception as exc:
        log(f"PC/SC not available yet: {exc}")
    if not block:
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        return httpd
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log("Stopped")
    return httpd


# ---------------------------------------------------------------------------
# Windows: autostart (HKCU Run key, no admin rights) and tray icon
# ---------------------------------------------------------------------------

_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def _exe_command():
    if IS_FROZEN:
        return f'"{sys.executable}" --tray'
    return f'"{sys.executable}" "{os.path.abspath(__file__)}" --tray'


def autostart_enabled():
    if not IS_WINDOWS:
        return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as k:
            value, _ = winreg.QueryValueEx(k, APP_NAME)
            return bool(value)
    except OSError:
        return False


def set_autostart(enabled: bool):
    if not IS_WINDOWS:
        log("Autostart is only available on Windows")
        return
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if enabled:
            winreg.SetValueEx(k, APP_NAME, 0, winreg.REG_SZ, _exe_command())
            log(f"Autostart enabled: {_exe_command()}")
        else:
            try:
                winreg.DeleteValue(k, APP_NAME)
            except FileNotFoundError:
                pass
            log("Autostart disabled")


def _tray_icon_image():
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((4, 4, 60, 60), radius=14, fill=(29, 95, 209, 255))
    d.rounded_rectangle((16, 22, 48, 44), radius=4, fill=(255, 255, 255, 255))   # card
    d.rectangle((20, 28, 30, 36), fill=(29, 95, 209, 255))                         # chip
    return img


def run_tray(port, origins):
    """Tray mode (the .exe): server in the background, icon with a small menu."""
    try:
        import pystray
    except ImportError:
        log("pystray not installed — running in console mode instead")
        serve(port, origins)
        return

    bridge = Bridge(origins)
    httpd = serve(port, origins, bridge=bridge, block=False)
    if httpd is None:
        return  # another instance owns the port
    if IS_FROZEN and not autostart_enabled():
        try:
            set_autostart(True)
        except Exception as exc:
            log(f"Could not enable autostart: {exc}")

    def status_text(_item=None):
        try:
            readers = list_readers()
        except Exception:
            return "Czytnik: niedostępny (PC/SC)"
        if not readers:
            return "Czytnik: nie podłączony"
        r = readers[0]
        return f"{r['name']}: {'karta włożona' if r['card'] else 'brak karty'}"

    def toggle_autostart(_icon, _item):
        set_autostart(not autostart_enabled())

    def quit_app(icon, _item):
        log("Stopped from tray")
        httpd.shutdown()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem(f"LTS Card Bridge {VERSION} — port {port}", None, enabled=False),
        pystray.MenuItem(status_text, None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Otwórz FleetView — Czytnik kart", lambda *_: webbrowser.open(FLEETVIEW_URL)),
        pystray.MenuItem("Pokaż log", lambda *_: webbrowser.open(_log_path()) if IS_FROZEN else None),
        pystray.MenuItem("Uruchamiaj z Windows", toggle_autostart, checked=lambda _i: autostart_enabled()),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Zakończ", quit_app),
    )
    icon = pystray.Icon(APP_NAME, _tray_icon_image(), "LTS Card Bridge", menu)
    icon.run()


# ---------------------------------------------------------------------------
# Self-test with a simulated card (no reader needed)
# ---------------------------------------------------------------------------

class _FakeCard:
    """Just enough of a tachograph card to exercise the download logic."""

    def __init__(self):
        ident = bytearray(143)
        ident[0] = 0x14
        ident[1:17] = b"1000000168070600"
        ident[61:65] = struct.pack(">I", int(datetime(2029, 3, 1, tzinfo=timezone.utc).timestamp()))
        ident[65] = 0x02; ident[66:101] = b"Goliasz".ljust(35)
        ident[101] = 0x02; ident[102:137] = b"Tomasz".ljust(35)
        self.files = {
            ("MF", 0x0002): bytes(range(25)), ("MF", 0x0005): bytes(8),
            ("G1", 0x0501): b"\x01" * 10, ("G1", 0xC100): b"\x02" * 194, ("G1", 0xC108): b"\x03" * 194,
            ("G1", 0x0520): bytes(ident), ("G1", 0x050E): bytes(4), ("G1", 0x0521): b"\x04" * 53,
            ("G1", 0x0502): b"\x05" * 1728, ("G1", 0x0503): b"\x06" * 1152, ("G1", 0x0504): b"\x07" * 5548,
            ("G1", 0x0505): b"\x08" * 2606, ("G1", 0x0506): b"\x09" * 1121, ("G1", 0x0507): b"\x0A" * 19,
            ("G1", 0x0508): b"\x0B" * 46, ("G1", 0x0522): b"\x0C" * 280,
            ("G2", 0x0501): b"\x11" * 17, ("G2", 0xC100): b"\x12" * 204, ("G2", 0xC101): b"\x13" * 204,
            ("G2", 0xC108): b"\x14" * 204, ("G2", 0xC109): b"\x15" * 204, ("G2", 0x0520): bytes(ident),
            ("G2", 0x050E): bytes(4), ("G2", 0x0504): b"\x16" * 13776, ("G2", 0x0524): b"\x17" * 300,
        }
        self.df = "MF"; self.ef = None; self.updated = {}

    def transmit(self, cmd):
        cla, ins, p1, p2 = cmd[:4]
        if ins == 0xA4:
            if p1 == 0x00: self.df = "MF"; self.ef = None; return [], 0x90, 0x00
            if p1 == 0x04:
                aid = cmd[5:11]
                self.df = "G1" if aid == AID_GEN1 else "G2" if aid == AID_GEN2 else None
                self.ef = None
                return ([], 0x90, 0x00) if self.df else ([], 0x6A, 0x82)
            if p1 == 0x02:
                fid = (cmd[5] << 8) | cmd[6]
                if (self.df, fid) in self.files: self.ef = fid; return [], 0x90, 0x00
                return [], 0x6A, 0x82
        if ins == 0xB0:
            data = self.files[(self.df, self.ef)]
            off = (p1 << 8) | p2; le = cmd[4] or 256
            if off >= len(data): return [], 0x6B, 0x00
            chunk = data[off:off + le]
            return list(chunk), (0x90 if len(chunk) == le else 0x62), (0x00 if len(chunk) == le else 0x82)
        if ins == 0x2A and p1 == 0x90: return [], 0x90, 0x00
        if ins == 0x2A and p1 == 0x9E:
            n = 128 if self.df == "G1" else 64
            return [0xAB] * n, 0x90, 0x00
        if ins == 0xD6:
            self.updated[(self.df, self.ef)] = bytes(cmd[5:]); return [], 0x90, 0x00
        return [], 0x6D, 0x00


def selftest():
    card = _FakeCard()
    res = download_card(CardSession(card))
    ddd = res["ddd"]
    # Walk the TLV records back and check they match what the card holds.
    pos, seen = 0, []
    while pos < len(ddd):
        fid, kind, ln = struct.unpack(">HBH", ddd[pos:pos + 5]); pos += 5
        payload = ddd[pos:pos + ln]; pos += ln
        df = "MF" if fid in (0x0002, 0x0005) else ("G1" if kind in (0, 1) else "G2")
        if kind in (0x00, 0x02):
            assert payload == card.files[(df, fid)], f"data mismatch for {df} {fid:04X}"
        else:
            assert len(payload) == (128 if df == "G1" else 64), f"signature size for {df} {fid:04X}"
        seen.append((df, fid, kind))
    assert pos == len(ddd)
    assert res["generation"] == 2
    assert res["identification"]["card_number"] == "1000000168070600"
    assert res["identification"]["surname"] == "Goliasz" and res["identification"]["first_names"] == "Tomasz"
    assert ("G2", 0x0504, 0x02) in seen and ("G1", 0x0504, 0x01) in seen
    assert card.updated[("G1", 0x050E)] and card.updated[("G2", 0x050E)]
    print(f"selftest ok: {len(ddd)} bytes, {len(seen)} records, file {ddd_filename(res['identification'])}")


def main():
    # A --noconsole build has no stdout/stderr; keep print() from crashing.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w")
    ap = argparse.ArgumentParser(description="LTS Card Bridge — tachograph card reader for FleetView")
    ap.add_argument("--port", type=int, default=int(os.environ.get("LTS_BRIDGE_PORT", DEFAULT_PORT)))
    ap.add_argument("--origin", action="append", default=[], help="extra allowed web origin (repeatable)")
    ap.add_argument("--selftest", action="store_true", help="run the download logic against a simulated card")
    ap.add_argument("--tray", action="store_true", help="tray icon mode (default for the .exe)")
    ap.add_argument("--console", action="store_true", help="force console mode even for the .exe")
    ap.add_argument("--install-autostart", action="store_true", help="add the bridge to Windows autostart and exit")
    ap.add_argument("--uninstall-autostart", action="store_true", help="remove the bridge from Windows autostart and exit")
    args = ap.parse_args()
    if args.selftest:
        selftest()
        return
    if args.install_autostart:
        set_autostart(True); return
    if args.uninstall_autostart:
        set_autostart(False); return
    extra = [o for o in args.origin + os.environ.get("LTS_BRIDGE_ORIGINS", "").split() if o]
    origins = DEFAULT_ORIGINS + extra
    if (args.tray or (IS_FROZEN and IS_WINDOWS)) and not args.console:
        run_tray(args.port, origins)
    else:
        serve(args.port, origins)


if __name__ == "__main__":
    main()
