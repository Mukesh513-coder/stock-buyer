#!/usr/bin/env python3
"""
Stock Buyer - Unified Live Web Server & SQL Backend
Built with Python Standard Library (Zero external dependencies).
Serves:
1. Static Website: index.html, css/styles.css, js/*.js on http://localhost:5000
2. SQL User Database: SQLite users.db (saved login credentials, sessions, profile)
3. Live Stocks & Crypto API: Real-time price feeds from Yahoo Finance & Binance
"""

import http.server
import socketserver
import json
import sqlite3
import hashlib
import secrets
import os
import mimetypes
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

PORT = 5000
SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SERVER_DIR) # Root project folder containing index.html, css/, js/
DB_FILE = os.path.join(SERVER_DIR, "users.db")

QUOTE_CACHE = {
    "data": {},
    "last_updated": 0
}

# --- SQL DATABASE INITIALIZATION ---
def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        avatar TEXT DEFAULT '👤',
        balance REAL DEFAULT 100000.00,
        saved_login_info TEXT DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)

    conn.commit()

    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        demo_pass_hash = hashlib.sha256("password123".encode()).hexdigest()
        saved_info_json = json.dumps({
            "remember_me": True,
            "saved_email": "trader@stockbuyer.io",
            "saved_username": "AlexTrader",
            "saved_at": datetime.now().isoformat(),
            "auto_login": True
        })
        cursor.execute("""
        INSERT INTO users (username, email, password_hash, full_name, avatar, balance, saved_login_info)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            "AlexTrader",
            "trader@stockbuyer.io",
            demo_pass_hash,
            "Alex Vance",
            "⚡",
            100000.00,
            saved_info_json
        ))
        conn.commit()
        print(" [SQL] Seeded demo user: username='AlexTrader', email='trader@stockbuyer.io', pass='password123'")

    conn.close()

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

# --- LIVE STOCK & CRYPTO API FETCH ENGINE ---
def fetch_live_quotes():
    now_ts = datetime.now().timestamp()
    if QUOTE_CACHE["data"] and (now_ts - QUOTE_CACHE["last_updated"] < 10):
        return QUOTE_CACHE["data"]

    symbols_map = {
        "NVDA": "NVDA", "AAPL": "AAPL", "TSLA": "TSLA", "MSFT": "MSFT",
        "AMZN": "AMZN", "GOOGL": "GOOGL", "AMD": "AMD", "SPY": "SPY", "QQQ": "QQQ"
    }

    quotes = {}
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

    # Yahoo Finance Chart API for Stocks
    for local_sym, yahoo_sym in symbols_map.items():
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_sym}?interval=1d&range=1d"
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=3.0) as response:
                if response.status == 200:
                    payload = json.loads(response.read().decode("utf-8"))
                    meta = payload.get("chart", {}).get("result", [{}])[0].get("meta", {})
                    if meta:
                        price = meta.get("regularMarketPrice")
                        prev_close = meta.get("chartPreviousClose") or meta.get("previousClose") or price
                        if price is not None and prev_close is not None:
                            change = price - prev_close
                            pct = (change / prev_close) * 100 if prev_close else 0.0
                            quotes[local_sym] = {
                                "symbol": local_sym,
                                "price": round(float(price), 2),
                                "prevClose": round(float(prev_close), 2),
                                "change": round(float(change), 2),
                                "changePercent": round(float(pct), 2),
                                "high": round(float(meta.get("regularMarketDayHigh", price)), 2),
                                "low": round(float(meta.get("regularMarketDayLow", price)), 2),
                                "timestamp": datetime.now().isoformat(),
                                "source": "Yahoo Finance (Live)"
                            }
        except Exception:
            pass

    # Binance Public API for Crypto (BTC, ETH, SOL)
    try:
        crypto_pairs = {"BTC-USD": "BTCUSDT", "ETH-USD": "ETHUSDT", "SOL-USD": "SOLUSDT"}
        b_url = "https://api.binance.com/api/v3/ticker/24hr"
        b_req = urllib.request.Request(b_url, headers=headers)
        with urllib.request.urlopen(b_req, timeout=3.0) as b_res:
            if b_res.status == 200:
                b_data = json.loads(b_res.read().decode("utf-8"))
                b_lookup = {item["symbol"]: item for item in b_data if item.get("symbol") in crypto_pairs.values()}
                for local_sym, b_pair in crypto_pairs.items():
                    if b_pair in b_lookup:
                        c_item = b_lookup[b_pair]
                        quotes[local_sym] = {
                            "symbol": local_sym,
                            "price": round(float(c_item["lastPrice"]), 2),
                            "prevClose": round(float(c_item["prevClosePrice"]), 2),
                            "change": round(float(c_item["priceChange"]), 2),
                            "changePercent": round(float(c_item["priceChangePercent"]), 2),
                            "high": round(float(c_item["highPrice"]), 2),
                            "low": round(float(c_item["lowPrice"]), 2),
                            "timestamp": datetime.now().isoformat(),
                            "source": "Binance Public API (Live)"
                        }
    except Exception:
        pass

    if quotes:
        QUOTE_CACHE["data"] = quotes
        QUOTE_CACHE["last_updated"] = now_ts
        return quotes
    return QUOTE_CACHE["data"]

# --- UNIFIED HTTP REQUEST HANDLER ---
class UnifiedLiveHandler(http.server.BaseHTTPRequestHandler):

    def _set_headers(self, status=200, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(204)

    def _read_json_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 0:
            body = self.rfile.read(content_length).decode("utf-8")
            try:
                return json.loads(body)
            except Exception:
                return {}
        return {}

    def _get_auth_token(self):
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            return auth_header[7:].strip()
        return None

    def _get_user_by_token(self, token):
        if not token:
            return None
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT u.id, u.username, u.email, u.full_name, u.avatar, u.balance, u.saved_login_info, u.created_at
            FROM users u
            JOIN sessions s ON u.id = s.user_id
            WHERE s.token = ? AND s.expires_at > datetime('now')
        """, (token,))
        row = cursor.fetchone()
        conn.close()
        if row:
            saved_info = {}
            try:
                saved_info = json.loads(row[6]) if row[6] else {}
            except Exception:
                pass
            return {
                "id": row[0],
                "username": row[1],
                "email": row[2],
                "fullName": row[3],
                "avatar": row[4],
                "balance": row[5],
                "savedLoginInfo": saved_info,
                "createdAt": row[7]
            }
        return None

    # --- GET: SERVES STATIC FRONTEND OR API ---
    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # 1. API: Health Check
        if path == "/api/health":
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM users")
            user_count = cursor.fetchone()[0]
            conn.close()
            self._set_headers(200)
            self.wfile.write(json.dumps({
                "status": "online",
                "database": "SQLite (users.db)",
                "totalUsers": user_count,
                "liveApiSupported": True,
                "timestamp": datetime.now().isoformat()
            }).encode())
            return

        # 2. API: Live Market Quotes
        elif path == "/api/market/live":
            live_quotes = fetch_live_quotes()
            self._set_headers(200)
            self.wfile.write(json.dumps({
                "success": True,
                "count": len(live_quotes),
                "quotes": live_quotes,
                "timestamp": datetime.now().isoformat()
            }).encode())
            return

        # 3. API: Current Authenticated User Info
        elif path == "/api/auth/me":
            token = self._get_auth_token()
            user = self._get_user_by_token(token)
            if user:
                self._set_headers(200)
                self.wfile.write(json.dumps({"success": True, "user": user}).encode())
            else:
                self._set_headers(401)
                self.wfile.write(json.dumps({"success": False, "message": "Invalid or expired session token."}).encode())
            return

        # 4. API: View All Users (Debug)
        elif path == "/api/users":
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("SELECT id, username, email, full_name, avatar, balance, saved_login_info, created_at FROM users")
            rows = cursor.fetchall()
            conn.close()

            users_list = []
            for r in rows:
                try:
                    s_info = json.loads(r[6]) if r[6] else {}
                except Exception:
                    s_info = {}
                users_list.append({
                    "id": r[0], "username": r[1], "email": r[2], "fullName": r[3],
                    "avatar": r[4], "balance": r[5], "savedLoginInfo": s_info, "createdAt": r[7]
                })

            self._set_headers(200)
            self.wfile.write(json.dumps({"success": True, "users": users_list}).encode())
            return

        # 5. STATIC FILES: Serve index.html, css/styles.css, js/*.js directly
        else:
            rel_path = path.lstrip("/")
            if not rel_path or rel_path == "":
                rel_path = "index.html"

            file_path = os.path.normpath(os.path.join(ROOT_DIR, rel_path))

            # Security check: ensure path stays within ROOT_DIR
            if not file_path.startswith(ROOT_DIR):
                self._set_headers(403)
                self.wfile.write(b"Access Denied")
                return

            if os.path.exists(file_path) and os.path.isfile(file_path):
                mime_type, _ = mimetypes.guess_type(file_path)
                if not mime_type:
                    mime_type = "application/octet-stream"
                if file_path.endswith(".css"):
                    mime_type = "text/css"
                elif file_path.endswith(".js"):
                    mime_type = "application/javascript"

                self.send_response(200)
                self.send_header("Content-Type", mime_type)
                self.send_header("Content-Length", str(os.path.getsize(file_path)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

                with open(file_path, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self._set_headers(404, "text/plain")
                self.wfile.write(b"404 Not Found")

    # --- POST ENDPOINTS ---
    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        body = self._read_json_body()

        # Register
        if path == "/api/auth/register":
            username = body.get("username", "").strip()
            email = body.get("email", "").strip().lower()
            password = body.get("password", "").strip()
            full_name = body.get("fullName", "").strip() or username
            avatar = body.get("avatar", "⚡")
            save_login_info = body.get("saveLoginInfo", True)

            if not username or not email or not password:
                self._set_headers(400)
                self.wfile.write(json.dumps({"success": False, "message": "Username, email, and password are required."}).encode())
                return

            if len(password) < 6:
                self._set_headers(400)
                self.wfile.write(json.dumps({"success": False, "message": "Password must be at least 6 characters long."}).encode())
                return

            pass_hash = hash_password(password)
            saved_info = json.dumps({
                "remember_me": bool(save_login_info),
                "saved_email": email,
                "saved_username": username,
                "saved_at": datetime.now().isoformat(),
                "auto_login": bool(save_login_info)
            })

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            try:
                cursor.execute("""
                INSERT INTO users (username, email, password_hash, full_name, avatar, balance, saved_login_info)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (username, email, pass_hash, full_name, avatar, 100000.00, saved_info))
                user_id = cursor.lastrowid

                token = secrets.token_hex(24)
                expires = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
                cursor.execute("INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)", (user_id, token, expires))
                conn.commit()

                user_data = {
                    "id": user_id, "username": username, "email": email, "fullName": full_name,
                    "avatar": avatar, "balance": 100000.00, "savedLoginInfo": json.loads(saved_info), "token": token
                }

                self._set_headers(201)
                self.wfile.write(json.dumps({
                    "success": True, "message": "User registered successfully in SQL database!",
                    "user": user_data, "token": token
                }).encode())
            except sqlite3.IntegrityError as err:
                self._set_headers(409)
                msg = "Username or email already exists." if "UNIQUE" in str(err) else f"Database error: {str(err)}"
                self.wfile.write(json.dumps({"success": False, "message": msg}).encode())
            finally:
                conn.close()
            return

        # Login
        elif path == "/api/auth/login":
            login_id = body.get("login", "").strip().lower()
            password = body.get("password", "").strip()
            save_login_info = body.get("saveLoginInfo", True)

            if not login_id or not password:
                self._set_headers(400)
                self.wfile.write(json.dumps({"success": False, "message": "Email/Username and password are required."}).encode())
                return

            pass_hash = hash_password(password)

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, username, email, full_name, avatar, balance, saved_login_info
                FROM users
                WHERE (lower(email) = ? OR lower(username) = ?) AND password_hash = ?
            """, (login_id, login_id, pass_hash))
            row = cursor.fetchone()

            if not row:
                conn.close()
                self._set_headers(401)
                self.wfile.write(json.dumps({"success": False, "message": "Invalid email/username or password."}).encode())
                return

            user_id, username, email, full_name, avatar, balance, raw_saved_info = row

            saved_info = {
                "remember_me": bool(save_login_info),
                "saved_email": email,
                "saved_username": username,
                "last_login": datetime.now().isoformat(),
                "auto_login": bool(save_login_info)
            }
            cursor.execute("UPDATE users SET saved_login_info = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (json.dumps(saved_info), user_id))

            token = secrets.token_hex(24)
            expires = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute("INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)", (user_id, token, expires))
            conn.commit()
            conn.close()

            user_data = {
                "id": user_id, "username": username, "email": email, "fullName": full_name,
                "avatar": avatar, "balance": balance, "savedLoginInfo": saved_info, "token": token
            }

            self._set_headers(200)
            self.wfile.write(json.dumps({
                "success": True, "message": f"Welcome back, {full_name}!",
                "user": user_data, "token": token
            }).encode())
            return

        # Update
        elif path == "/api/auth/update":
            token = self._get_auth_token()
            user = self._get_user_by_token(token)
            if not user:
                self._set_headers(401)
                self.wfile.write(json.dumps({"success": False, "message": "Unauthorized"}).encode())
                return

            new_full_name = body.get("fullName", user["fullName"]).strip()
            new_avatar = body.get("avatar", user["avatar"]).strip()
            new_password = body.get("newPassword", "").strip()
            saved_preferences = body.get("savedLoginInfo", {})

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            merged_saved_info = user.get("savedLoginInfo", {})
            merged_saved_info.update(saved_preferences)
            merged_saved_info["updated_at"] = datetime.now().isoformat()

            if new_password:
                if len(new_password) < 6:
                    conn.close()
                    self._set_headers(400)
                    self.wfile.write(json.dumps({"success": False, "message": "Password must be at least 6 characters."}).encode())
                    return
                pass_hash = hash_password(new_password)
                cursor.execute("""
                    UPDATE users
                    SET full_name = ?, avatar = ?, password_hash = ?, saved_login_info = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (new_full_name, new_avatar, pass_hash, json.dumps(merged_saved_info), user["id"]))
            else:
                cursor.execute("""
                    UPDATE users
                    SET full_name = ?, avatar = ?, saved_login_info = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (new_full_name, new_avatar, json.dumps(merged_saved_info), user["id"]))

            conn.commit()
            conn.close()

            user["fullName"] = new_full_name
            user["avatar"] = new_avatar
            user["savedLoginInfo"] = merged_saved_info

            self._set_headers(200)
            self.wfile.write(json.dumps({
                "success": True, "message": "User details and saved login info updated in SQL database!",
                "user": user
            }).encode())
            return

        # Logout
        elif path == "/api/auth/logout":
            token = self._get_auth_token()
            if token:
                conn = sqlite3.connect(DB_FILE)
                cursor = conn.cursor()
                cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
                conn.commit()
                conn.close()

            self._set_headers(200)
            self.wfile.write(json.dumps({"success": True, "message": "Logged out successfully from SQL session."}).encode())
            return

        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "Endpoint not found"}).encode())

# --- RUN SERVER ---
def run():
    init_db()
    server_address = ("", PORT)
    with socketserver.TCPServer(server_address, UnifiedLiveHandler) as httpd:
        print("=" * 70)
        print(" [LIVE WEBSITE] Stock Buyer is LIVE on http://localhost:5000")
        print(" [FEATURES] Unified Frontend + SQLite Database + Live Stocks API")
        print(" [URL] Open in browser: http://localhost:5000")
        print("=" * 70)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n [SERVER] Server stopped.")

if __name__ == "__main__":
    run()
