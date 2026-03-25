"""
fetch_guoman.py  方案 C (v3)
Phase 1 - Timeline：本週有更新的國漫（正確星期 + 集數）
Phase 2 - Bangumi補援：本季有但本週沒更新的中國動畫（用 legacy API 取星期）
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
BANGUMI_SEASON = "https://api.bgm.tv/v0/search/subjects"          # POST
BANGUMI_SUBJ   = "https://api.bgm.tv/subject/{id}?responseGroup=large"  # legacy，含 air_weekday

BGM_UA = "NeoCast/1.0 (https://github.com/room1985/neocast)"
BILI_HEADERS = {
    "Referer":    "https://www.bilibili.com",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
}
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


# ── Bangumi 搜尋（by title）──────────────────────────────────────────────────
def search_bangumi(title):
    for q in list(dict.fromkeys([title, to_simplified(title), _SEASON_RE.sub("", title).strip()])):
        if not q:
            continue
        try:
            time.sleep(0.4)
            data = fetch_json(BANGUMI_SEARCH.format(kw=urllib.parse.quote(q)), {"User-Agent": BGM_UA})
            for subj in (data.get("list") or []):
                if fuzzy_match(title, subj.get("name_cn", "")) or fuzzy_match(title, subj.get("name", "")):
                    return subj
        except Exception as e:
            print(f"  [Bangumi搜尋] '{q}' 失敗: {e}")
    return None


# ── Bangumi legacy subject（含 air_weekday）──────────────────────────────────
def fetch_bgm_subject(bgm_id):
    try:
        time.sleep(0.3)
        return fetch_json(BANGUMI_SUBJ.format(id=bgm_id), {"User-Agent": BGM_UA})
    except Exception as e:
        print(f"  [Bangumi subject] id={bgm_id} 失敗: {e}")
        return None


# ── Phase 1：Bilibili timeline（本週更新，星期正確）──────────────────────────
def fetch_timeline_items():
    """回傳 [{season_id, title, weekday, pub_index, pub_time}]"""
    try:
        raw = fetch_json(BILI_TIMELINE, BILI_HEADERS)
    except Exception as e:
        print(f"[Timeline] 失敗: {e}")
        return []
    if raw.get("code") != 0:
        print(f"[Timeline] API error: {raw.get('message')}")
        return []
    root  = raw.get("data") or raw.get("result") or {}
    items = []
    for day in (root.get("timeline") or []):
        wd = day.get("day_of_week") or day.get("dayOfWeek") or 0
        for ep in (day.get("episodes") or []):
            title = ep.get("title") or ep.get("season_title") or ""
            sid   = ep.get("season_id") or ep.get("seasonId") or 0
            if title:
                items.append({
                    "season_id": sid,
                    "title":     title,
                    "weekday":   wd,
                    "pub_index": ep.get("pub_index") or ep.get("pubIndex") or "",
                    "pub_time":  ep.get("pub_time")  or ep.get("pubTime")  or "",
                })
    print(f"[Timeline] {len(items)} 部有本週更新")
    return items


# ── Phase 2：Bangumi 本季中國動畫補援 ─────────────────────────────────────────
def fetch_bangumi_season_chinese():
    now   = datetime.utcnow()
    start_month = ((now.month - 1) // 3) * 3 + 1
    season_start = f"{now.year}-{start_month:02d}-01"
    print(f"[Bangumi補援] 搜尋本季（{season_start} 起）中國動畫...")
    try:
        time.sleep(0.5)
        data = post_json(BANGUMI_SEASON, {
            "keyword": "",
            "filter": {"type": [2], "air_date": [f">={season_start}"], "tag": ["中国"]},
            "sort": "heat"
        })
        subjects = data.get("data") or data.get("list") or []
        print(f"[Bangumi補援] 找到 {len(subjects)} 部")
        return subjects
    except Exception as e:
        print(f"[Bangumi補援] 失敗: {e}")
        return []


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

    # Phase 1：Timeline（本週更新）
    tl_items = fetch_timeline_items()
    print("=" * 52)

    calendar = {}
    seen_bgm_ids  = set()   # 已加入的 Bangumi ID
    seen_fake_ids = set()   # 已加入的合成 ID（無 Bangumi 匹配）

    for tl in tl_items:
        title = tl["title"]
        wd    = tl["weekday"] or 1
        print(f"▸ [P1] {title} (第{wd}天, {tl['pub_index']})")
        bgm = search_bangumi(title)
        item = make_item(bgm, wd, tl["season_id"], tl["pub_index"], tl["pub_time"], title)

        if bgm:
            if bgm["id"] in seen_bgm_ids:
                continue
            seen_bgm_ids.add(bgm["id"])
            print(f"  ✓ {bgm.get('name_cn') or bgm.get('name')} (★{item['rating']['score']})")
        else:
            fid = item["id"]
            if fid in seen_fake_ids:
                continue
            seen_fake_ids.add(fid)
            print(f"  ✗ 未匹配")

        calendar.setdefault(wd, []).append(item)

    print("=" * 52)

    # Phase 2：Bangumi 補援（本週沒更新的本季國漫）
    bgm_subjects = fetch_bangumi_season_chinese()
    print("=" * 52)

    for subj in bgm_subjects:
        bgm_id = subj.get("id")
        if not bgm_id or bgm_id in seen_bgm_ids:
            continue

        # 用 legacy API 取 air_weekday
        full = fetch_bgm_subject(bgm_id)
        wd   = (full.get("air_weekday") if full else None) or subj.get("air_weekday") or 1
        # 合併封面／評分（優先用 full）
        merged_bgm = full if full else subj

        title = merged_bgm.get("name_cn") or merged_bgm.get("name") or ""
        print(f"▸ [P2] {title} (id={bgm_id} wd={wd})")

        item = make_item(merged_bgm, wd, 0, "", "", title)
        seen_bgm_ids.add(bgm_id)
        calendar.setdefault(wd, []).append(item)

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
