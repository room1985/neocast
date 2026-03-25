"""
fetch_guoman.py  方案 C
1. Bilibili season index  → 本季所有在播國漫（完整清單）
2. Bilibili timeline      → 本週各集更新資訊（集數/時間）
3. Bangumi search         → 評分 / 封面 / 星期
合併後輸出與 Bangumi /calendar 相同格式的 guoman.json
"""

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

# ── Endpoints ────────────────────────────────────────────────────────────────
BILI_TIMELINE = "https://api.bilibili.com/pgc/web/timeline/v2?season_type=4"
# index_type=4 = 本季在播；order=2 = 追番人數排序（較熱門的排前面）
BILI_INDEX    = ("https://api.bilibili.com/pgc/season/index/result"
                 "?season_type=4&index_type=4&order=2&sort=0&pagesize=50&page={page}")
BANGUMI_SEARCH = "https://api.bgm.tv/search/subject/{kw}?type=2&responseGroup=large&max_results=5"

BGM_UA = "NeoCast/1.0 (https://github.com/room1985/neocast)"
BILI_HEADERS = {
    "Referer":    "https://www.bilibili.com",
    "User-Agent": "Mozilla/5.0 (compatible; NeoCast-Bot/1.0)",
}
# ─────────────────────────────────────────────────────────────────────────────


def fetch_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
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
    s = _SEASON_RE.sub("", s)
    s = _NOISE_RE.sub("", s)
    return s.lower().strip()

def fuzzy_match(a, b):
    na, nb = normalize(a), normalize(b)
    return na == nb or (len(na) > 1 and na in nb) or (len(nb) > 1 and nb in na)

def to_simplified(s):
    return s.translate(_TC2SC)


# ── Bangumi 搜尋 ──────────────────────────────────────────────────────────────
def search_bangumi(title):
    queries = list(dict.fromkeys([
        title,
        to_simplified(title),
        _SEASON_RE.sub("", title).strip(),
    ]))
    for q in queries:
        if not q:
            continue
        url = BANGUMI_SEARCH.format(kw=urllib.parse.quote(q))
        try:
            time.sleep(0.4)
            data = fetch_json(url, {"User-Agent": BGM_UA})
            for subj in (data.get("list") or []):
                if fuzzy_match(title, subj.get("name_cn", "")) or \
                   fuzzy_match(title, subj.get("name", "")):
                    return subj
        except Exception as e:
            print(f"  [Bangumi] '{q}' 搜尋失敗: {e}")
    return None


# ── Step 1：抓 Bilibili timeline（本週更新資訊）──────────────────────────────
def fetch_timeline():
    """回傳 {season_id: {weekday, pub_index, pub_time}}"""
    result = {}
    try:
        raw = fetch_json(BILI_TIMELINE, BILI_HEADERS)
    except Exception as e:
        print(f"[Timeline] 抓取失敗: {e}")
        return result
    if raw.get("code") != 0:
        print(f"[Timeline] API error: {raw.get('message')}")
        return result

    root = raw.get("data") or raw.get("result") or {}
    for day in (root.get("timeline") or []):
        wd = day.get("day_of_week") or day.get("dayOfWeek") or 0
        for ep in (day.get("episodes") or []):
            sid = ep.get("season_id") or ep.get("seasonId")
            if sid:
                result[sid] = {
                    "weekday":   wd,
                    "pub_index": ep.get("pub_index") or ep.get("pubIndex") or "",
                    "pub_time":  ep.get("pub_time")  or ep.get("pubTime")  or "",
                }
    print(f"[Timeline] {len(result)} 部有本週更新")
    return result


# ── Step 2：抓 Bilibili season index（本季全部在播）─────────────────────────
def fetch_season_index():
    """回傳所有在播國漫的清單 [{season_id, title, cover, score, ...}]"""
    all_items = []
    page = 1
    while True:
        try:
            raw = fetch_json(BILI_INDEX.format(page=page), BILI_HEADERS)
        except Exception as e:
            print(f"[Index] page {page} 失敗: {e}")
            break
        if raw.get("code") != 0:
            print(f"[Index] API error: {raw.get('message')}")
            break

        root  = raw.get("data") or raw.get("result") or {}
        items = root.get("list") or root.get("result") or []
        if not items:
            break

        all_items.extend(items)
        total = int(root.get("total") or 0)
        print(f"[Index] page {page}: {len(items)} 部（累計 {len(all_items)}/{total}）")

        if total and len(all_items) >= total:
            break
        page += 1
        time.sleep(0.5)

    return all_items


# ── Step 3：合併 + Bangumi 補資料 ─────────────────────────────────────────────
def build_guoman():
    print("=" * 50)
    timeline = fetch_timeline()
    print("=" * 50)
    index    = fetch_season_index()
    print(f"[Index] 共 {len(index)} 部本季國漫")
    print("=" * 50)

    calendar  = {}   # weekday_id(1~7) → [item, ...]
    seen_ids  = set()

    for entry in index:
        # 欄位名稱相容性處理
        season_id = entry.get("season_id") or entry.get("seasonId") or 0
        title     = (entry.get("title") or entry.get("season_title")
                     or entry.get("seasonTitle") or "")
        cover_bili = entry.get("cover") or entry.get("squareCover") or ""

        if not title:
            continue

        # 從 timeline 取本週更新資訊
        tl = timeline.get(season_id, {})
        pub_index = tl.get("pub_index", "")
        pub_time  = tl.get("pub_time",  "")
        tl_wd     = tl.get("weekday",   0)

        print(f"▸ {title}  (sid={season_id}){' 本週更新' if pub_index else ''}")

        # Bangumi 搜尋
        bgm = search_bangumi(title)

        if bgm:
            item_id = bgm["id"]
            imgs    = bgm.get("images") or {}
            rating  = bgm.get("rating") or {}
            bgm_wd  = bgm.get("air_weekday") or tl_wd or 0
            item = {
                "id":       item_id,
                "name":     bgm.get("name") or title,
                "name_cn":  bgm.get("name_cn") or title,
                "images": {
                    "large":  imgs.get("large")  or imgs.get("common") or "",
                    "common": imgs.get("common") or imgs.get("large")  or "",
                },
                "rating":      {"score": rating.get("score") or 0},
                "eps":         bgm.get("eps_count") or bgm.get("eps") or 0,
                "air_weekday": bgm_wd,
                "source":      "bilibili",
                "bgm_matched": True,
                "pub_index":   pub_index,
                "pub_time":    pub_time,
                "bilibili_season_id": season_id,
            }
            print(f"  ✓ Bangumi: {bgm.get('name_cn') or bgm.get('name')} "
                  f"(id={item_id} ★{rating.get('score',0)} wd={bgm_wd})")
        else:
            item_id = 9_000_000 + season_id
            bgm_wd  = tl_wd or 0
            item = {
                "id":       item_id,
                "name":     title,
                "name_cn":  title,
                # B 站圖片有防盜鏈，PWA 無法直接顯示
                "images":   {"large": "", "common": ""},
                "rating":      {"score": 0},
                "eps":         0,
                "air_weekday": bgm_wd,
                "source":      "bilibili",
                "bgm_matched": False,
                "pub_index":   pub_index,
                "pub_time":    pub_time,
                "bilibili_season_id": season_id,
            }
            print(f"  ✗ 未匹配 Bangumi，合成 ID={item_id} wd={bgm_wd}")

        # 沒有星期資訊的放到 weekday=1 避免遺失
        if not bgm_wd:
            bgm_wd = 1
            item["air_weekday"] = 1

        if item_id in seen_ids:
            continue
        seen_ids.add(item_id)
        calendar.setdefault(bgm_wd, []).append(item)

    # 組成 Bangumi /calendar 格式
    result = [
        {"weekday": {"id": wd}, "items": items}
        for wd, items in sorted(calendar.items())
    ]
    total = sum(len(d["items"]) for d in result)
    print("=" * 50)
    print(f"✅ 完成：{len(result)} 天，共 {total} 部國漫")
    return result


if __name__ == "__main__":
    data = build_guoman()
    out  = Path(__file__).parent.parent / "guoman.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"📄 已寫入 {out}")
