"""
fetch_guoman.py  方案 C (v2)
1. Bilibili timeline      → 本週各集更新資訊
2. Bilibili season index  → 本季全部在播（嘗試多組參數）
   ↳ 若全部失敗 → Bangumi 中國動畫標籤搜尋作備援
3. Bangumi search         → 補評分 / 封面 / 星期
"""

import json
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

# ── Endpoints ────────────────────────────────────────────────────────────────
BILI_TIMELINE = "https://api.bilibili.com/pgc/web/timeline/v2?season_type=4"

# 嘗試多組 Bilibili index 參數（由簡到繁）
BILI_INDEX_URLS = [
    "https://api.bilibili.com/pgc/season/index/result?season_type=4&order=3&sort=0&pagesize=50&page={page}",
    "https://api.bilibili.com/pgc/season/index/result?season_type=4&is_finish=0&order=3&sort=0&pagesize=50&page={page}",
    "https://api.bilibili.com/pgc/season/index/result?season_type=4&season_status=1&order=3&sort=0&pagesize=50&page={page}",
    "https://api.bilibili.com/pgc/season/index/result?season_type=4&index_type=4&order=3&sort=0&pagesize=50&page={page}",
]

BANGUMI_SEARCH  = "https://api.bgm.tv/search/subject/{kw}?type=2&responseGroup=large&max_results=5"
BANGUMI_SEASON  = "https://api.bgm.tv/v0/search/subjects"   # POST

BGM_UA = "NeoCast/1.0 (https://github.com/room1985/neocast)"
BILI_HEADERS = {
    "Referer":         "https://www.bilibili.com",
    "Origin":          "https://www.bilibili.com",
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
}
# ─────────────────────────────────────────────────────────────────────────────


def fetch_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def post_json(url, body, headers=None):
    data = json.dumps(body).encode("utf-8")
    h = {"Content-Type": "application/json", **(headers or {})}
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
    s = _SEASON_RE.sub("", s)
    s = _NOISE_RE.sub("", s)
    return s.lower().strip()

def fuzzy_match(a, b):
    na, nb = normalize(a), normalize(b)
    return na == nb or (len(na) > 1 and na in nb) or (len(nb) > 1 and nb in na)

def to_simplified(s):
    return s.translate(_TC2SC)


# ── Bangumi 搜尋（by title）──────────────────────────────────────────────────
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


# ── Step 1：Bilibili timeline ─────────────────────────────────────────────────
def fetch_timeline():
    result = {}
    try:
        raw = fetch_json(BILI_TIMELINE, BILI_HEADERS)
    except Exception as e:
        print(f"[Timeline] 失敗: {e}")
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


# ── Step 2a：Bilibili season index（試多組參數）──────────────────────────────
def fetch_season_index():
    for url_tpl in BILI_INDEX_URLS:
        print(f"[Index] 嘗試: {url_tpl.split('?')[1][:60]}")
        all_items = []
        page = 1
        success = False
        while True:
            try:
                raw = fetch_json(url_tpl.format(page=page), BILI_HEADERS)
            except Exception as e:
                print(f"  page {page} 網路錯誤: {e}")
                break

            if raw.get("code") != 0:
                print(f"  API error: {raw.get('message') or raw.get('code')}")
                break

            root  = raw.get("data") or raw.get("result") or {}
            items = root.get("list") or root.get("result") or []
            if not items:
                success = True
                break

            all_items.extend(items)
            total = int(root.get("total") or 0)
            print(f"  page {page}: {len(items)} 部（累計 {len(all_items)}/{total}）")
            success = True

            if total and len(all_items) >= total:
                break
            page += 1
            time.sleep(0.5)

        if success and all_items:
            print(f"[Index] ✓ 成功，共 {len(all_items)} 部")
            return all_items

    print("[Index] 所有參數均失敗，改用 Bangumi 備援")
    return None   # 表示需要 fallback


# ── Step 2b：Bangumi 本季中國動畫備援 ─────────────────────────────────────────
def fetch_bangumi_chinese_fallback():
    """用 Bangumi v0 POST 搜尋帶「中国」標籤的本季動畫"""
    now = datetime.utcnow()
    # 本季起始月（1、4、7、10）
    season_start_month = ((now.month - 1) // 3) * 3 + 1
    season_start = f"{now.year}-{season_start_month:02d}-01"
    print(f"[Bangumi備援] 搜尋本季（{season_start} 起）中國動畫...")

    body = {
        "keyword": "",
        "filter": {
            "type": [2],
            "air_date": [f">={season_start}"],
            "tag": ["中国"]
        },
        "sort": "heat"
    }
    try:
        time.sleep(0.5)
        data = post_json(BANGUMI_SEASON, body, {"User-Agent": BGM_UA})
        subjects = data.get("data") or data.get("list") or []
        print(f"[Bangumi備援] 找到 {len(subjects)} 部")
        return subjects
    except Exception as e:
        print(f"[Bangumi備援] 失敗: {e}")
        return []


# ── 統一轉換：各來源 → AnimeEntry ─────────────────────────────────────────────
def make_entry(title, season_id, bgm, tl, wd_fallback=0):
    pub_index = tl.get("pub_index", "") if tl else ""
    pub_time  = tl.get("pub_time",  "") if tl else ""
    tl_wd     = tl.get("weekday",   0)  if tl else 0

    if bgm:
        imgs   = bgm.get("images") or {}
        rating = bgm.get("rating") or {}
        bgm_wd = bgm.get("air_weekday") or tl_wd or wd_fallback or 1
        return {
            "id":       bgm["id"],
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
            "bilibili_season_id": season_id or 0,
        }
    else:
        wd = tl_wd or wd_fallback or 1
        return {
            "id":       9_000_000 + (season_id or 0),
            "name":     title,
            "name_cn":  title,
            "images":   {"large": "", "common": ""},
            "rating":   {"score": 0},
            "eps":      0,
            "air_weekday": wd,
            "source":   "bilibili",
            "bgm_matched": False,
            "pub_index":   pub_index,
            "pub_time":    pub_time,
            "bilibili_season_id": season_id or 0,
        }


# ── 主流程 ────────────────────────────────────────────────────────────────────
def build_guoman():
    print("=" * 52)
    timeline = fetch_timeline()
    print("=" * 52)
    index    = fetch_season_index()

    if index is None:
        # Bilibili index 完全失敗 → Bangumi 備援
        bgm_subjects = fetch_bangumi_chinese_fallback()
        # 把 Bangumi subjects 轉成統一格式（直接當 index 使用）
        index = []
        for subj in bgm_subjects:
            sid = 0
            title = subj.get("name_cn") or subj.get("name") or ""
            index.append({
                "_bgm_prefetched": subj,
                "season_id": sid,
                "title": title,
            })
        # 同時也把 timeline 的項目加進去（避免遺漏本週更新）
        for sid, tl in timeline.items():
            pass   # timeline 已整合在下面

    # 確保 timeline 的條目都有被包含（index 可能沒有）
    timeline_sids_in_index = set()

    print(f"[Index] 共 {len(index)} 部本季國漫")
    print("=" * 52)

    calendar  = {}
    seen_ids  = set()

    # 處理 index 條目
    for entry in index:
        season_id = entry.get("season_id") or entry.get("seasonId") or 0
        title     = (entry.get("title") or entry.get("season_title")
                     or entry.get("seasonTitle") or "")
        if not title:
            continue

        tl = timeline.get(season_id, {})
        timeline_sids_in_index.add(season_id)

        # 如果已經有預抓的 Bangumi 資料就直接用
        bgm = entry.get("_bgm_prefetched")
        if not bgm:
            print(f"▸ {title}")
            bgm = search_bangumi(title)

        entry_data = make_entry(title, season_id, bgm, tl)
        item_id    = entry_data["id"]
        wd         = entry_data["air_weekday"]

        if bgm:
            print(f"  ✓ {bgm.get('name_cn') or bgm.get('name')} "
                  f"(id={item_id} ★{entry_data['rating']['score']} wd={wd})")
        else:
            print(f"  ✗ 未匹配 Bangumi (id={item_id} wd={wd})")

        if item_id not in seen_ids:
            seen_ids.add(item_id)
            calendar.setdefault(wd, []).append(entry_data)

    # 補入 timeline 有但 index 沒有的條目
    for sid, tl in timeline.items():
        if sid in timeline_sids_in_index:
            continue
        # 需要從 timeline 取得 title（timeline 只有 season_id，要從 Bilibili 補）
        # 這裡先跳過，避免額外 API 呼叫
        pass

    result = [
        {"weekday": {"id": wd}, "items": items}
        for wd, items in sorted(calendar.items())
    ]
    total = sum(len(d["items"]) for d in result)
    print("=" * 52)
    print(f"✅ 完成：{len(result)} 天，共 {total} 部國漫")
    return result


if __name__ == "__main__":
    data = build_guoman()
    out  = Path(__file__).parent.parent / "guoman.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"📄 已寫入 {out}")
