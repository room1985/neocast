"""
fetch_guoman.py
每次執行：從 Bilibili 國創時間線抓資料，用 Bangumi 補評分/封面，輸出 guoman.json
輸出格式與 Bangumi /calendar 完全相同，可直接 merge 進 NeoCast 週曆。
"""

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

# ──────────────────────────────────────────
BILIBILI_URL = "https://api.bilibili.com/pgc/web/timeline/v2?season_type=4"
BANGUMI_SEARCH = "https://api.bgm.tv/search/subject/{kw}?type=2&responseGroup=large&max_results=5"
BGM_UA = "NeoCast/1.0 (https://github.com/room1985/neocast)"
BILI_HEADERS = {
    "Referer": "https://www.bilibili.com",
    "User-Agent": "Mozilla/5.0 (compatible; NeoCast-Bot/1.0)",
}
# B 站圖片有防盜鏈，瀏覽器端無法直接載入；當 Bangumi 沒有封面時留空
BILI_IMG_NOTE = ""
# ──────────────────────────────────────────


def fetch_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


# ── 標題正規化 ──────────────────────────────
_SEASON_RE = re.compile(r"第[一二三四五六七八九十百\d]+季|Season\s*\d+", re.IGNORECASE)
_NOISE_RE  = re.compile(r"[（()）【】\[\]\s·・♪★]")

def normalize(s):
    s = _SEASON_RE.sub("", s)
    s = _NOISE_RE.sub("", s)
    return s.lower().strip()

def fuzzy_match(a, b):
    na, nb = normalize(a), normalize(b)
    return na == nb or (len(na) > 1 and na in nb) or (len(nb) > 1 and nb in na)

# ── 繁體→簡體（常見字，正式建議改用 opencc-python-reimplemented）──
_TC2SC = str.maketrans(
    "傳龍鳳劍們還這來時國動畫發點歲過類開關當實體場師學問對東",
    "传龙凤剑们还这来时国动画发点岁过类开关当实体场师学问对东"
)

def to_simplified(s):
    return s.translate(_TC2SC)


# ── Bangumi 搜尋 ────────────────────────────
def search_bangumi(title):
    """回傳第一個模糊匹配的 Bangumi 條目，找不到回傳 None"""
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
            time.sleep(0.4)   # 避免被 Bangumi 限速
            data = fetch_json(url, {"User-Agent": BGM_UA})
            for subj in (data.get("list") or []):
                if fuzzy_match(title, subj.get("name_cn", "")) or \
                   fuzzy_match(title, subj.get("name", "")):
                    return subj
        except Exception as e:
            print(f"  [Bangumi] 搜尋失敗 '{q}': {e}")
    return None


# ── 主流程 ──────────────────────────────────
def build_guoman():
    print("▶ 抓取 Bilibili 國創時間線...")
    try:
        raw = fetch_json(BILIBILI_URL, BILI_HEADERS)
    except Exception as e:
        print(f"[錯誤] Bilibili 抓取失敗: {e}")
        return []

    if raw.get("code") != 0:
        print(f"[錯誤] Bilibili 回應 code={raw.get('code')}: {raw.get('message')}")
        return []

    # 相容 data / result 兩種 key
    root  = raw.get("data") or raw.get("result") or {}
    days  = root.get("timeline") or root.get("result") or []
    print(f"  取得 {len(days)} 天資料")

    calendar = {}   # weekday_id(1~7) → [item, ...]
    seen_ids  = set()

    for day in days:
        wd = day.get("day_of_week") or day.get("dayOfWeek") or 0
        if not wd:
            continue

        for ep in (day.get("episodes") or []):
            title     = ep.get("title") or ep.get("season_title") or ""
            season_id = ep.get("season_id") or ep.get("seasonId") or 0
            cover     = ep.get("cover") or ep.get("square_cover") or ""
            pub_index = ep.get("pub_index") or ep.get("pubIndex") or ""
            pub_time  = ep.get("pub_time")  or ep.get("pubTime")  or ""

            if not title:
                continue

            print(f"  ▸ [{wd}] {title} ({pub_index})")
            bgm = search_bangumi(title)

            if bgm:
                item_id = bgm["id"]
                imgs    = bgm.get("images") or {}
                rating  = bgm.get("rating") or {}
                item = {
                    "id":       item_id,
                    "name":     bgm.get("name") or title,
                    "name_cn":  bgm.get("name_cn") or title,
                    "images": {
                        "large":  imgs.get("large")  or imgs.get("common") or BILI_IMG_NOTE,
                        "common": imgs.get("common") or imgs.get("large")  or BILI_IMG_NOTE,
                    },
                    "rating":       {"score": rating.get("score") or 0},
                    "eps":          bgm.get("eps_count") or bgm.get("eps") or 0,
                    "air_weekday":  wd,
                    "source":       "bilibili",
                    "bgm_matched":  True,
                    "pub_index":    pub_index,
                    "pub_time":     pub_time,
                    "bilibili_season_id": season_id,
                }
                print(f"    ✓ Bangumi 匹配: {bgm.get('name_cn') or bgm.get('name')} (id={item_id}, ★{rating.get('score',0)})")
            else:
                # 沒匹配到 Bangumi：使用合成 ID 避免與 Bangumi ID 衝突
                item_id = 9_000_000 + season_id
                item = {
                    "id":       item_id,
                    "name":     title,
                    "name_cn":  title,
                    "images": {
                        # B 站圖片防盜鏈，PWA 前端無法直接顯示，留空
                        "large":  BILI_IMG_NOTE,
                        "common": BILI_IMG_NOTE,
                    },
                    "rating":       {"score": 0},
                    "eps":          0,
                    "air_weekday":  wd,
                    "source":       "bilibili",
                    "bgm_matched":  False,
                    "pub_index":    pub_index,
                    "pub_time":     pub_time,
                    "bilibili_season_id": season_id,
                }
                print(f"    ✗ 未匹配 Bangumi，使用合成 ID={item_id}")

            # 同一 ID 不重複加入
            if item_id in seen_ids:
                continue
            seen_ids.add(item_id)
            calendar.setdefault(wd, []).append(item)

    # 組成與 Bangumi /calendar 相同的格式
    result = [
        {"weekday": {"id": wd}, "items": items}
        for wd, items in sorted(calendar.items())
    ]
    total = sum(len(d["items"]) for d in result)
    print(f"\n✅ 完成：{len(result)} 天，共 {total} 部國漫")
    return result


if __name__ == "__main__":
    data = build_guoman()
    out  = Path(__file__).parent.parent / "guoman.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"📄 已寫入 {out}")
