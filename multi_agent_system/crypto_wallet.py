"""
NEXUS Crypto Wallet — Monero (XMR) + Litecoin (LTC)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
All operations use:
  • Offline key generation   (no network, no API key)
  • Free blockchain APIs     (no key required for balance/explorer)
  • Free broadcast endpoints (no key required for sending LTC)
  • Monero privacy model     (view-key based balance lookup)

Supported coins
  LTC  Litecoin   — full send/receive
  XMR  Monero     — generate, receive, view-key balance
"""
from __future__ import annotations
import json, os, time, secrets, hashlib, urllib.request, urllib.parse, urllib.error
from typing import Dict, Any, Optional, List

WALLET_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nexus_wallets.json")

# ── Tor / SOCKS5 proxy support ───────────────────────────────────────────────
# Set TOR_ENABLED=1 and optionally TOR_PROXY=socks5h://127.0.0.1:9050
TOR_ENABLED = os.environ.get("TOR_ENABLED", "0").strip() == "1"
TOR_PROXY   = os.environ.get("TOR_PROXY", "socks5h://127.0.0.1:9050")

def _install_tor_opener():
    """Install a global urllib opener that routes through the Tor SOCKS5 proxy."""
    try:
        import socks, socket as _socket
        from urllib.request import ProxyHandler, build_opener, install_opener
        proto, _, hostport = TOR_PROXY.replace("socks5h://","").replace("socks5://","").partition(":")
        host = (hostport or "127.0.0.1:9050").split(":")[0]
        port = int((hostport or "127.0.0.1:9050").split(":")[-1])
        socks.set_default_proxy(socks.SOCKS5, host, port)
        _socket.socket = socks.socksocket
        print(f"[CryptoWallet] Tor SOCKS5 proxy active → {host}:{port}")
    except ImportError:
        print("[CryptoWallet] PySocks not installed — Tor routing disabled. pip install PySocks")
    except Exception as e:
        print(f"[CryptoWallet] Tor proxy setup error: {e}")

if TOR_ENABLED:
    _install_tor_opener()


# ─────────────────────────────────────────────────────────────────────────────
# Wallet persistence  (plaintext JSON; private keys stored locally)
# ─────────────────────────────────────────────────────────────────────────────
def _load() -> dict:
    if os.path.exists(WALLET_FILE):
        try:
            with open(WALLET_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {"ltc": {}, "xmr": {}}


def _save(data: dict) -> None:
    with open(WALLET_FILE, "w") as f:
        json.dump(data, f, indent=2)


def _upsert(coin: str, address: str, record: dict) -> None:
    data = _load()
    data.setdefault(coin, {})[address] = record
    _save(data)


# ─────────────────────────────────────────────────────────────────────────────
# HTTP helper
# ─────────────────────────────────────────────────────────────────────────────
def _get(url: str, timeout: int = 15) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "NEXUS-Wallet/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", errors="replace"))


def _post(url: str, body: dict, timeout: int = 20) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json", "User-Agent": "NEXUS-Wallet/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", errors="replace"))


# ═════════════════════════════════════════════════════════════════════════════
#  LITECOIN  (LTC)
# ═════════════════════════════════════════════════════════════════════════════

def ltc_new_wallet(label: str = "default") -> Dict[str, Any]:
    """Generate a new Litecoin wallet offline.  Returns address, WIF, keys."""
    try:
        from bitcoinlib.keys import Key
        k = Key(network="litecoin")
        address = k.address()
        record = {
            "coin": "LTC",
            "label": label,
            "address": address,
            "wif": k.wif(),
            "private_hex": k.private_hex,
            "public_hex": k.public_hex,
            "created": int(time.time()),
        }
        _upsert("ltc", address, record)
        return {"ok": True, **record}
    except Exception as e:
        return {"ok": False, "coin": "LTC", "error": str(e)}


def ltc_balance(address: str) -> Dict[str, Any]:
    """Check LTC balance via free Blockchair API (no key needed)."""
    apis = [
        ("blockchair", f"https://api.blockchair.com/litecoin/dashboards/address/{address}?limit=0"),
        ("sochain",    f"https://sochain.com/api/v2/get_address_balance/LTC/{address}"),
    ]
    for name, url in apis:
        try:
            data = _get(url)
            if name == "blockchair":
                ad = data.get("data", {}).get(address, {}).get("address", {})
                bal_sat = int(ad.get("balance", 0) or 0)
                return {
                    "ok": True, "coin": "LTC", "address": address,
                    "balance": bal_sat / 1e8,
                    "balance_sat": bal_sat,
                    "received": int(ad.get("received", 0) or 0) / 1e8,
                    "tx_count": ad.get("transaction_count", 0),
                    "provider": "blockchair (free)",
                    "explorer": f"https://blockchair.com/litecoin/address/{address}",
                }
            if name == "sochain":
                d = data.get("data", {})
                bal = float(d.get("confirmed_balance", 0) or 0)
                return {
                    "ok": True, "coin": "LTC", "address": address,
                    "balance": bal, "balance_sat": int(bal * 1e8),
                    "provider": "sochain (free)",
                    "explorer": f"https://blockchair.com/litecoin/address/{address}",
                }
        except Exception:
            continue
    return {"ok": False, "coin": "LTC", "address": address, "error": "All balance APIs failed"}


def ltc_send(from_address_or_wif: str, to_address: str, amount_ltc: float,
             wif: Optional[str] = None) -> Dict[str, Any]:
    """Build, sign and broadcast a Litecoin transaction — all free, no API key."""
    try:
        from bitcoinlib.transactions import Transaction
        from bitcoinlib.keys import Key

        # Resolve WIF
        if from_address_or_wif.startswith("L") or from_address_or_wif.startswith("K"):
            # It's a WIF directly
            wif_key = from_address_or_wif
        elif wif:
            wif_key = wif
        else:
            # Look up in stored wallets
            data = _load()
            found = data.get("ltc", {}).get(from_address_or_wif, {})
            wif_key = found.get("wif", "")
            if not wif_key:
                return {"ok": False, "error": "WIF private key not found — provide wif= or the WIF as from address"}

        k = Key(wif_key, network="litecoin")
        from_address = k.address()

        # Fetch UTXOs
        utxo_url = f"https://api.blockchair.com/litecoin/outputs?q=recipient({from_address}),is_spent(false)&limit=20"
        try:
            utxo_data = _get(utxo_url, timeout=15)
            raw_utxos = utxo_data.get("data", [])
        except Exception:
            raw_utxos = []

        if not raw_utxos:
            return {"ok": False, "error": "No unspent outputs found — balance may be zero or not yet confirmed"}

        amount_sat = int(round(amount_ltc * 1e8))
        fee_sat = 15000  # ~0.00015 LTC, comfortable for L1

        t = Transaction(network="litecoin")
        total_in = 0
        for u in raw_utxos:
            if total_in >= amount_sat + fee_sat:
                break
            t.add_input(u["transaction_hash"], u["index"], value=u["value"],
                        keys=[k.public_hex], script_type="p2pkh")
            total_in += u["value"]

        if total_in < amount_sat + fee_sat:
            avail = total_in / 1e8
            need = (amount_sat + fee_sat) / 1e8
            return {"ok": False, "error": f"Insufficient: have {avail:.8f} LTC, need {need:.8f} LTC (incl fee)"}

        t.add_output(amount_sat, to_address)
        change = total_in - amount_sat - fee_sat
        if change > 546:  # dust threshold
            t.add_output(change, from_address)

        t.sign(k.private_hex)
        raw_hex = t.raw_hex()

        # Broadcast via Blockchair (free, no key)
        result = _post(
            "https://api.blockchair.com/litecoin/push/transaction",
            {"data": raw_hex},
        )
        txid = result.get("data", {}).get("transaction_hash") or result.get("hash")
        if txid:
            return {
                "ok": True, "coin": "LTC",
                "txid": txid, "amount": amount_ltc, "fee": fee_sat / 1e8,
                "from": from_address, "to": to_address,
                "explorer": f"https://blockchair.com/litecoin/transaction/{txid}",
            }
        return {"ok": False, "error": f"Broadcast error: {result}"}
    except Exception as e:
        return {"ok": False, "coin": "LTC", "error": str(e)}


# ═════════════════════════════════════════════════════════════════════════════
#  MONERO  (XMR)
# ═════════════════════════════════════════════════════════════════════════════

def xmr_new_wallet(label: str = "default") -> Dict[str, Any]:
    """Generate a new Monero wallet offline. Returns mnemonic, keys, address."""
    try:
        from monero.seed import Seed
        seed = Seed()
        address = str(seed.public_address())
        record = {
            "coin": "XMR",
            "label": label,
            "address": address,
            "seed_phrase": seed.phrase,
            "spend_key": seed.secret_spend_key(),
            "view_key": seed.secret_view_key(),
            "created": int(time.time()),
        }
        _upsert("xmr", address, record)
        return {"ok": True, **record}
    except Exception as e:
        return {"ok": False, "coin": "XMR", "error": str(e)}


def xmr_balance(address: str, view_key: Optional[str] = None) -> Dict[str, Any]:
    """
    Check XMR balance.
    Without view_key: returns address validity info only (Monero is private by design).
    With view_key: queries MyMonero API (view-key based, no spend authority given).
    """
    if not view_key:
        # Try to load from stored wallet
        data = _load()
        stored = data.get("xmr", {}).get(address, {})
        view_key = stored.get("view_key", "")

    if view_key:
        try:
            result = _post(
                "https://api.mymonero.com/get_address_info",
                {"address": address, "view_key": view_key},
                timeout=25,
            )
            received = int(result.get("total_received", 0) or 0)
            sent = int(result.get("total_sent", 0) or 0)
            locked = int(result.get("locked_funds", 0) or 0)
            balance_raw = received - sent
            piconero = 1e12  # 1 XMR = 1_000_000_000_000 piconero
            return {
                "ok": True, "coin": "XMR", "address": address,
                "balance": balance_raw / piconero,
                "locked": locked / piconero,
                "received": received / piconero,
                "spent": sent / piconero,
                "provider": "MyMonero API (view-key only, no spend authority)",
            }
        except Exception as e:
            return {
                "ok": False, "coin": "XMR", "address": address,
                "error": f"MyMonero API error: {e}",
                "note": "Monero balances are private. View key is needed for remote lookup.",
            }
    else:
        return {
            "ok": True, "coin": "XMR", "address": address,
            "balance": None,
            "note": (
                "Monero is private by design — balances are not visible on public explorers. "
                "Your view key is stored in NEXUS wallet. Run 'xmr balance' to auto-use it."
            ),
        }


def xmr_send(from_address: str, to_address: str, amount_xmr: float) -> Dict[str, Any]:
    """
    Prepare XMR send instructions.
    Full Monero sends require the spend key + a daemon/wallet RPC.
    NEXUS returns the exact CLI command to execute.
    """
    data = _load()
    stored = data.get("xmr", {}).get(from_address, {})
    spend_key = stored.get("spend_key", "SPEND_KEY")
    view_key = stored.get("view_key", "VIEW_KEY")

    cli_cmd = (
        f"monero-wallet-cli \\\n"
        f"  --generate-from-spend-key /tmp/nexus_wallet \\\n"
        f"  --password '' \\\n"
        f"  --restore-height 3000000 \\\n"
        f"  --command 'transfer {to_address} {amount_xmr}'"
    )
    return {
        "ok": True, "coin": "XMR",
        "from": from_address, "to": to_address,
        "amount": amount_xmr,
        "spend_key": spend_key if stored else "(not stored — load your wallet)",
        "send_command": cli_cmd,
        "note": (
            "Monero transactions require the spend key + a daemon. "
            "NEXUS stores your keys locally. Use the CLI command above, "
            "or open Feather Wallet / Monero GUI with your stored seed phrase."
        ),
    }


# ═════════════════════════════════════════════════════════════════════════════
#  WALLET MANAGER
# ═════════════════════════════════════════════════════════════════════════════

def wallet_list() -> Dict[str, Any]:
    """Return all stored wallets (addresses + labels, no private keys)."""
    data = _load()
    ltc = [
        {"address": addr, "label": w.get("label", ""), "created": w.get("created", 0)}
        for addr, w in data.get("ltc", {}).items()
    ]
    xmr = [
        {"address": addr, "label": w.get("label", ""), "created": w.get("created", 0)}
        for addr, w in data.get("xmr", {}).items()
    ]
    return {"ok": True, "ltc": ltc, "xmr": xmr}


def wallet_get(coin: str, address: str) -> Dict[str, Any]:
    """Return full wallet record (including private keys — treat with care)."""
    data = _load()
    record = data.get(coin.lower(), {}).get(address)
    if not record:
        return {"ok": False, "error": f"Wallet not found: {coin.upper()} {address}"}
    return {"ok": True, "wallet": record}


def wallet_delete(coin: str, address: str) -> Dict[str, Any]:
    """Remove a wallet from local storage."""
    data = _load()
    removed = data.get(coin.lower(), {}).pop(address, None)
    if removed is None:
        return {"ok": False, "error": "Wallet not found"}
    _save(data)
    return {"ok": True, "removed": address}


def qr_url(data: str) -> str:
    """Return a free QR code image URL for any string (address, URI, etc)."""
    enc = urllib.parse.quote(data, safe="")
    return f"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={enc}&margin=10"


def ltc_uri(address: str, amount: Optional[float] = None, label: str = "") -> str:
    """Build a litecoin: payment URI."""
    uri = f"litecoin:{address}"
    params = {}
    if amount:
        params["amount"] = f"{amount:.8f}"
    if label:
        params["label"] = label
    if params:
        uri += "?" + urllib.parse.urlencode(params)
    return uri


def xmr_uri(address: str, amount: Optional[float] = None, description: str = "") -> str:
    """Build a monero: payment URI."""
    uri = f"monero:{address}"
    params = {}
    if amount:
        params["tx_amount"] = f"{amount:.12f}"
    if description:
        params["tx_description"] = description
    if params:
        uri += "?" + urllib.parse.urlencode(params)
    return uri


# ─────────────────────────────────────────────────────────────────────────────
# Chat-command dispatcher — called from coordinator / orchestrator tools
# ─────────────────────────────────────────────────────────────────────────────
def handle_command(cmd: str, args: dict) -> Dict[str, Any]:
    """
    Dispatch wallet commands from the AI chat.
    cmd examples:
      ltc_new, ltc_balance, ltc_send, ltc_address,
      xmr_new, xmr_balance, xmr_send, xmr_address,
      wallet_list, wallet_get
    """
    coin = args.get("coin", "").upper()
    address = args.get("address", "")
    label = args.get("label", "default")
    amount = float(args.get("amount", 0) or 0)
    to = args.get("to", "")
    view_key = args.get("view_key", "")
    wif = args.get("wif", "")

    handlers = {
        "ltc_new":      lambda: ltc_new_wallet(label),
        "ltc_balance":  lambda: ltc_balance(address),
        "ltc_send":     lambda: ltc_send(address, to, amount, wif or None),
        "ltc_address":  lambda: wallet_get("ltc", address),
        "xmr_new":      lambda: xmr_new_wallet(label),
        "xmr_balance":  lambda: xmr_balance(address, view_key or None),
        "xmr_send":     lambda: xmr_send(address, to, amount),
        "xmr_address":  lambda: wallet_get("xmr", address),
        "wallet_list":  wallet_list,
        "wallet_get":   lambda: wallet_get(coin.lower(), address),
    }
    fn = handlers.get(cmd)
    if not fn:
        return {"ok": False, "error": f"Unknown wallet command: {cmd}"}
    try:
        return fn()
    except Exception as e:
        return {"ok": False, "error": str(e)}
