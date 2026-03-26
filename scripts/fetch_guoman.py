"""
fetch_guoman.py  方案 C (v5)
Phase 1 - Bilibili timeline：本週更新的國漫（正確集數/星期）
Phase 2 - Bangumi 多 tag 補援：本年中國動畫，app.js 合併時去重日漫
Phase 3 - Bangumi NSFW（需 OAuth token）：成人動畫，標記 is_nsfw=true
"""

import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

# ── Endpoints ────────────────────────────────────────────────────────────────
BILI_TIMELINE  = "https://api.bilibili.com/pgc/web/timeline/v2?season_type=4"
BANGUMI_SEARCH = "https://api.bgm.tv/search/subject/{kw}?type=2&responseGroup=large&max_results=5"
BANGUMI_V0     = "https://api.bgm.tv/v0/search/subjects"
BGM_TOKEN_URL  = "https://bgm.tv/oauth/access_token"

BGM_UA = "NeoCast/1.0 (https://github.com/room1985/neocast)"
BILI_HEADERS = {
    "Referer":    "https://www.bilibili.com",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
}
BGM_APP_ID = os.environ.get("BGM_APP_ID", "bgm582369c530b5dcaf9")
# ─────────────────────────────────────────────────────────────────────────────


def fetch_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def post_json(url, body, headers=None):
    data = json.dumps(body).encode("utf-8")
    h = {"Content-Type": "application/json", "User-Agent": BGM_UA, **(headers or {})}
    req = urllib.request.Request(url, data=data, headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


# ── OAuth：用 refresh_token 換新的 access_token，並更新 bgm_token.json ────────
TOKEN_FILE = Path(__file__).parent.parent / "bgm_token.json"

def get_access_token():
    app_secret = os.environ.get("BGM_APP_SECRET", "")
    if not app_secret:
        print("[Auth] 無 BGM_APP_SECRET，跳過 Phase 3")
        return None

    # 讀 token 檔
    if not TOKEN_FILE.exists():
        print("[Auth] bgm_token.json 不存在，跳過 Phase 3")
        return None
    try:
        tokens = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[Auth] 讀取 bgm_token.json 失敗: {e}")
        return None

    refresh_token = tokens.get("refresh_token", "")
    if not refresh_token:
        print("[Auth] bgm_token.json 無 refresh_token")
        return None

    # 用 refresh_token 換新 token
    try:
        body = urllib.parse.urlencode({
            "grant_type":    "refresh_token",
            "client_id":     BGM_APP_ID,
            "client_secret": app_secret,
            "refresh_token": refresh_token,
            "redirect_uri":  "https://room1985.github.io/neocast/",
        }).encode("utf-8")
        req = urllib.request.Request(
            BGM_TOKEN_URL, data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            result = json.loads(r.read().decode("utf-8"))

        new_access  = result.get("access_token")
        new_refresh = result.get("refresh_token")
        if not new_access:
            print(f"[Auth] 回應異常: {result}")
            return None

        # 把新 token 存回檔案（workflow 會一起 commit）
        TOKEN_FILE.write_text(json.dumps({
            "access_token":  new_access,
            "refresh_token": new_refresh or refresh_token,
            "updated_at":    datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S"),
        }, ensure_ascii=False, indent=2), encoding="utf-8")

        print("[Auth] access_token 取得成功，bgm_token.json 已更新")
        return new_access

    except Exception as e:
        print(f"[Auth] 失敗: {e}")
    return None


# ── 標題工具 ──────────────────────────────────────────────────────────────────
_SEASON_RE = re.compile(r"第[一二三四五六七八九十百\d]+季|Season\s*\d+", re.IGNORECASE)
_NOISE_RE  = re.compile(r"[（()）【】\[\]\s·・♪★：:：]")
_TC2SC = str.maketrans(
    "傳龍鳳劍們還這來時國動畫發點歲過類開關當實體場師學問對東",
    "传龙凤剑们还这来时国动画发点岁过类开关当实体场师学问对东"
)

def normalize(s):
    return _NOISE_RE.sub("", _SEASON_RE.sub("", s)).lower().strip()

def fuzzy_match(a, b):
    na, nb = normalize(a), normalize(b)
    return na == nb or (len(na) > 1 and na in nb) or (len(nb) > 1 and nb in na)

def to_simplified(s):
    return s.translate(_TC2SC)


# ── 從 air_date 推算星期（1=週一 ~ 7=週日）────────────────────────────────────
def weekday_from_date(date_str):
    try:
        return datetime.strptime(date_str[:10], "%Y-%m-%d").isoweekday()
    except Exception:
        return 0


# ── Bangumi title 搜尋（for Phase 1 timeline 匹配）───────────────────────────
def search_bangumi(title):
    for q in list(dict.fromkeys([title, to_simplified(title), _SEASON_RE.sub("", title).strip()])):
        if not q:
            continue
        try:
            time.sleep(0.35)
            data = fetch_json(BANGUMI_SEARCH.format(kw=urllib.parse.quote(q)), {"User-Agent": BGM_UA})
            for subj in (data.get("list") or []):
                if fuzzy_match(title, subj.get("name_cn", "")) or fuzzy_match(title, subj.get("name", "")):
                    return subj
        except Exception as e:
            print(f"  [Bangumi搜尋] '{q}' 失敗: {e}")
    return None


# ── Phase 1：Bilibili timeline ────────────────────────────────────────────────
def fetch_timeline_items():
    try:
        raw = fetch_json(BILI_TIMELINE, BILI_HEADERS)
    except Exception as e:
        print(f"[Timeline] 失敗: {e}"); return []
    if raw.get("code") != 0:
        print(f"[Timeline] API error: {raw.get('message')}"); return []
    root = raw.get("data") or raw.get("result") or {}
    items = []
    for day in (root.get("timeline") or []):
        wd = day.get("day_of_week") or day.get("dayOfWeek") or 0
        for ep in (day.get("episodes") or []):
            title = ep.get("title") or ep.get("season_title") or ""
            sid   = ep.get("season_id") or ep.get("seasonId") or 0
            if title:
                items.append({
                    "season_id": sid, "title": title,
                    "weekday":   wd,
                    "pub_index": ep.get("pub_index") or ep.get("pubIndex") or "",
                    "pub_time":  ep.get("pub_time")  or ep.get("pubTime")  or "",
                })
    print(f"[Timeline] {len(items)} 部有本週更新")
    return items


# ── Phase 2：Bangumi 多 tag 搜尋中國動畫 ──────────────────────────────────────
def fetch_bangumi_year_all(since):
    tag_groups = [
        ["中国"], ["中国大陆"], ["国产动画"], ["国漫"],
        ["WEB", "中国"], ["修仙"], ["玄幻", "中国"],
        ["战斗", "中国"], ["小说改", "中国"], ["网文改"],
        ["国创"], ["热血", "中国"], ["奇幻", "中国"],
    ]
    print(f"[Bangumi補援] 多 tag 搜尋本年（{since} 起）中國動畫...")
    seen = {}
    for tags in tag_groups:
        try:
            time.sleep(0.4)
            resp = post_json(BANGUMI_V0, {
                "keyword": "",
                "filter": {"type": [2], "air_date": [f">={since}"], "tag": tags},
                "sort": "heat", "limit": 50, "offset": 0
            })
            for subj in (resp.get("data") or []):
                sid = subj.get("id")
                if sid and sid not in seen:
                    seen[sid] = subj
            print(f"  tag={tags}: {len(resp.get('data') or [])} 筆，累計不重複 {len(seen)} 部")
        except Exception as e:
            print(f"  tag={tags} 失敗: {e}")
    print(f"[Bangumi補援] 共 {len(seen)} 部")
    return list(seen.values())


# ── Phase 3：Bangumi NSFW（需 OAuth token）────────────────────────────────────
def fetch_bangumi_nsfw(access_token, since):
    if not access_token:
        return []
    auth_headers = {"Authorization": f"Bearer {access_token}"}
    tag_groups = [["成人"], ["18禁"], ["H动画"], ["R18"], ["成人动画"], ["里番"], ["OVA", "成人"]]
    print(f"[Phase 3 NSFW] 搜尋成人動畫（{since} 起）...")
    seen = {}
    for tags in tag_groups:
        try:
            time.sleep(0.4)
            resp = post_json(BANGUMI_V0, {
                "keyword": "",
                "filter": {"type": [2], "air_date": [f">={since}"], "tag": tags, "nsfw": True},
                "sort": "heat", "limit": 50, "offset": 0
            }, auth_headers)
            for subj in (resp.get("data") or []):
                sid = subj.get("id")
                if sid and sid not in seen:
                    seen[sid] = subj
            print(f"  tag={tags}: {len(resp.get('data') or [])} 筆，累計 {len(seen)} 部")
        except Exception as e:
            print(f"  tag={tags} 失敗: {e}")
    print(f"[Phase 3] 共 {len(seen)} 部成人動畫")
    return list(seen.values())


# ── 組 item ───────────────────────────────────────────────────────────────────
def make_item(bgm, weekday, season_id=0, pub_index="", pub_time="", title_fallback="", is_nsfw=False):
    imgs   = (bgm.get("images") or {}) if bgm else {}
    rating = (bgm.get("rating") or {}) if bgm else {}
    return {
        "id":       bgm["id"] if bgm else 9_000_000 + season_id,
        "name":     (bgm.get("name")    if bgm else None) or title_fallback,
        "name_cn":  (bgm.get("name_cn") if bgm else None) or title_fallback,
        "images": {
            "large":  imgs.get("large")  or imgs.get("common") or "",
            "common": imgs.get("common") or imgs.get("large")  or "",
        },
        "rating":      {"score": rating.get("score") or 0},
        "eps":         (bgm.get("eps_count") or bgm.get("eps") or 0) if bgm else 0,
        "air_weekday": weekday,
        "source":      "bilibili",
        "bgm_matched": bgm is not None,
        "pub_index":   pub_index,
        "pub_time":    pub_time,
        "bilibili_season_id": season_id,
        "is_nsfw":     is_nsfw,
    }


# ── 主流程 ────────────────────────────────────────────────────────────────────
def build_guoman():
    year  = datetime.utcnow().year
    since = f"{year}-01-01"
    print("=" * 52)

    # Phase 1：Timeline
    tl_items = fetch_timeline_items()
    print("=" * 52)

    calendar      = {}
    seen_bgm_ids  = set()
    seen_fake_ids = set()

    for tl in tl_items:
        title = tl["title"]
        wd    = tl["weekday"] or 1
        bgm   = search_bangumi(title)
        item  = make_item(bgm, wd, tl["season_id"], tl["pub_index"], tl["pub_time"], title)

        if bgm:
            if bgm["id"] in seen_bgm_ids:
                continue
            seen_bgm_ids.add(bgm["id"])
            print(f"[P1] {bgm.get('name_cn') or bgm.get('name')} ★{item['rating']['score']} wd={wd} {tl['pub_index']}")
        else:
            fid = item["id"]
            if fid in seen_fake_ids:
                continue
            seen_fake_ids.add(fid)
            print(f"[P1] {title} (未匹配) wd={wd} {tl['pub_index']}")

        calendar.setdefault(wd, []).append(item)

    print("=" * 52)

    # Phase 2：Bangumi 本年補援
    bgm_year = fetch_bangumi_year_all(since)
    p2_added = 0
    for subj in bgm_year:
        bgm_id = subj.get("id")
        if not bgm_id or bgm_id in seen_bgm_ids:
            continue
        wd   = weekday_from_date(subj.get("date") or "") or 1
        item = make_item(subj, wd)
        seen_bgm_ids.add(bgm_id)
        calendar.setdefault(wd, []).append(item)
        p2_added += 1
    print(f"[Bangumi補援] 新增 {p2_added} 部（日漫會在 app.js 去重）")

    print("=" * 52)

    # Phase 3：NSFW（需 OAuth）
    access_token = get_access_token()
    nsfw_items   = fetch_bangumi_nsfw(access_token, since)
    p3_added = 0
    for subj in nsfw_items:
        bgm_id = subj.get("id")
        if not bgm_id or bgm_id in seen_bgm_ids:
            continue
        wd   = weekday_from_date(subj.get("date") or "") or 1
        item = make_item(subj, wd, is_nsfw=True)
        seen_bgm_ids.add(bgm_id)
        calendar.setdefault(wd, []).append(item)
        p3_added += 1
    print(f"[Phase 3] 新增 {p3_added} 部成人動畫")

    result = [
        {"weekday": {"id": wd}, "items": items}
        for wd, items in sorted(calendar.items())
    ]
    total = sum(len(d["items"]) for d in result)
    print("=" * 52)
    print(f"✅ 完成：{len(result)} 天，共 {total} 筆")
    return result


if __name__ == "__main__":
    data = build_guoman()
    out  = Path(__file__).parent.parent / "guoman.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"📄 已寫入 {out}")
