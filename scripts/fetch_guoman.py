"""
fetch_guoman.py  方案 C (v4)
Phase 1 - Bilibili timeline：本週更新的國漫（正確集數/星期）
Phase 2 - Bangumi 本年補援：air_date >= 今年1月1日的所有動畫（不分國籍）
           → 日漫已在 Bangumi calendar 裡，app.js 合併時自動去重
           → 只有 calendar 沒有的（主要是國漫）才會新增進週曆
           → weekday 直接從 date 欄位計算，不需額外 API 呼叫
"""

import json
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

BGM_UA = "NeoCast/1.0 (https://github.com/room1985/neocast)"
BILI_HEADERS = {
    "Referer":    "https://www.bilibili.com",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
}
PAGE_SIZE = 50
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
    """'2026-01-05' → 1 (週一)，解析失敗回傳 0"""
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


# ── Phase 2：Bangumi 多關鍵字搜尋中國動畫 ────────────────────────────────────
def fetch_bangumi_year_all():
    year = datetime.utcnow().year
    since = f"{year}-01-01"
    keywords = [
        "中国动画", "国产动画", "国漫", "中国大陆", "bilibili",
        "中国", "国产", "WEB", "修仙", "仙侠", "玄幻",
        "小说改", "战斗", "网文改", "国漫奇幻", "国创",
    ]
    print(f"[Bangumi補援] 多關鍵字搜尋本年（{since} 起）中國動畫...")

    seen = {}   # id → subject，去重用
    for kw in keywords:
        try:
            time.sleep(0.4)
            url = BANGUMI_SEARCH.format(kw=urllib.parse.quote(kw)) + "&max_results=25"
            data = fetch_json(url, {"User-Agent": BGM_UA})
            for subj in (data.get("list") or []):
                # 只保留本年以後開播的動畫
                air_date = subj.get("air_date") or subj.get("date") or ""
                if air_date and air_date < since:
                    continue
                sid = subj.get("id")
                if sid and sid not in seen:
                    seen[sid] = subj
            print(f"  '{kw}': {len(data.get('list') or [])} 筆，累計不重複 {len(seen)} 部")
        except Exception as e:
            print(f"  '{kw}' 失敗: {e}")

    print(f"[Bangumi補援] 共 {len(seen)} 部")
    return list(seen.values())


# ── 組 item ───────────────────────────────────────────────────────────────────
def make_item(bgm, weekday, season_id=0, pub_index="", pub_time="", title_fallback=""):
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
    }


# ── 主流程 ────────────────────────────────────────────────────────────────────
def build_guoman():
    print("=" * 52)

    # Phase 1：Timeline
    tl_items = fetch_timeline_items()
    print("=" * 52)

    calendar     = {}
    seen_bgm_ids = set()
    seen_fake_ids= set()

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
    bgm_year = fetch_bangumi_year_all()
    added = 0
    for subj in bgm_year:
        bgm_id = subj.get("id")
        if not bgm_id or bgm_id in seen_bgm_ids:
            continue

        date_str = subj.get("date") or subj.get("air_date") or ""
        wd = weekday_from_date(date_str) or 1

        item = make_item(subj, wd)
        seen_bgm_ids.add(bgm_id)
        calendar.setdefault(wd, []).append(item)
        added += 1

    print(f"[Bangumi補援] 新增 {added} 部（日漫會在 app.js 去重）")

    result = [
        {"weekday": {"id": wd}, "items": items}
        for wd, items in sorted(calendar.items())
    ]
    total = sum(len(d["items"]) for d in result)
    print("=" * 52)
    print(f"✅ 完成：{len(result)} 天，共 {total} 筆（含待去重的日漫）")
    return result


if __name__ == "__main__":
    data = build_guoman()
    out  = Path(__file__).parent.parent / "guoman.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"📄 已寫入 {out}")
