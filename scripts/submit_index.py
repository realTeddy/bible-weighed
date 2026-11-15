#!/usr/bin/env python3
"""Submit every URL in site/sitemap.xml to IndexNow (Bing, Yandex, Seznam, Naver...). Run after deploying."""
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = "bible.tewodros.me"
key = (ROOT / "data" / "indexnow.key").read_text().strip()
urls = re.findall(r"<loc>([^<]+)</loc>", (ROOT / "site" / "sitemap.xml").read_text())
body = json.dumps({"host": HOST, "key": key, "keyLocation": f"https://{HOST}/{key}.txt", "urlList": urls}).encode()
req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body, headers={"Content-Type": "application/json; charset=utf-8"})
with urllib.request.urlopen(req, timeout=30) as r:
    print(f"IndexNow: HTTP {r.status}, {len(urls)} URLs submitted")
