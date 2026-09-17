"""
Supply Line — fetch & summarize pipeline.

What this does, step by step:
  1. Reads a list of RSS feeds (FEEDS below) from real supply chain news sites.
  2. Skips any article already saved (matched by its URL).
  3. Sends new article titles/snippets to Claude, asking it to:
       - decide if it's really supply-chain relevant, and if not, skip it
       - rewrite it into a 60-100 word paragraph in Claude's own words
       - tag it with one of the 8 categories and a continent/country
  4. Saves everything to data/news.json, newest first, capped at MAX_ITEMS.

You should not need to edit this file to get started. The one thing you
WILL want to do over time is add more feeds to the FEEDS list below —
just copy the pattern of an existing line.

This version uses Google's Gemini API, which has a real, ongoing free tier
(no credit card, no trial that runs out) — see the README for how to get
a free key. If you'd rather use Anthropic's Claude API instead, the
call_llm() function below is the only thing you'd need to swap out.

Environment variable required: GEMINI_API_KEY
"""

import os
import re
import json
import time
import hashlib
from datetime import datetime, timezone
from pathlib import Path

import requests
import feedparser

# ---------------------------------------------------------------------------
# 1. CONFIG — feel free to add/remove feeds here. Each is (rss_url, display_name).
# Only add feeds you've confirmed are public RSS feeds meant for subscribing.
# ---------------------------------------------------------------------------
FEEDS = [
    ("https://www.supplychaindive.com/feeds/news/", "Supply Chain Dive"),
    ("https://www.freightwaves.com/feed", "FreightWaves"),
    ("https://www.aircargonews.net/feed", "Air Cargo News"),
    ("https://theloadstar.com/feed/", "The Loadstar"),
    ("https://www.scdigest.com/rss/scdigest_headlines.xml", "Supply Chain Digest"),
    ("https://www.imd.org/ibyimd/tag/manufacturing/feed/", "IMD Business School"),
]

MAX_NEW_PER_FEED_PER_RUN = 10   # keeps this comfortably inside the free daily quota
MAX_ITEMS_TOTAL = 300          # oldest stories drop off past this
DATA_PATH = Path(__file__).resolve().parent / "news.json" 

CATEGORIES = [
    "strategy", "procurement", "manufacturing", "logistics",
    "storage_distribution", "international_relations", "sustainability", "crm"
]

# Gemini 2.5 Flash-Lite is the most generous free-tier model as of when this
# was written (roughly 15 requests/minute, 1000/day, no billing required).
# If Google renames or retires it, check https://aistudio.google.com for the
# current free-tier model list and update the line below.
MODEL = "gemini-flash-lite-latest"
API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
API_KEY = os.environ.get("GEMINI_API_KEY")

SYSTEM_PROMPT = f"""You are helping build a supply chain news aggregator.
You will be given an article's title and a short snippet/description.

Decide first whether this article is genuinely about supply chain management —
topics like strategy, procurement/sourcing, manufacturing/lean, logistics/freight,
warehousing/distribution, international trade/tariffs/geopolitics affecting trade,
sustainability in supply chains, or customer-facing supply chain operations.
If it is NOT (e.g. it's a podcast recap, a generic company ad, an event listing,
a listicle with no news content, or off-topic), respond with exactly: {{"skip": true}}

If it IS relevant, respond with ONLY a JSON object, no markdown fences, no preamble:
{{
  "headline": "a clear, specific headline, rewritten in your own words, under 90 characters",
  "summary": "60 to 100 words, fully in your own words (never copy phrasing from the source), factual, neutral tone, no marketing language",
  "category": "one of: {', '.join(CATEGORIES)}",
  "continent": "one of: North America, South America, Europe, Asia, Middle East, Africa, Oceania, Global",
  "country": "the single most relevant country name, or 'Multiple' if it's not country-specific"
}}

Never quote the source text directly. Never fabricate facts not present in the input.
"""

def call_llm(title, snippet, retries=3):
    if not API_KEY:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set.")
    payload = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [
            {"parts": [{"text": f"Title: {title}\n\nSnippet: {snippet}"}]}
        ],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 500},
    }
    headers = {"content-type": "application/json"}

    for attempt in range(retries):
        resp = requests.post(
            API_URL, headers=headers, params={"key": API_KEY}, json=payload, timeout=60
        )
        if resp.status_code == 429:
            wait = 10 * (attempt + 1)
            print(f"  [rate limit] waiting {wait}s before retrying...")
            time.sleep(wait)
            continue
        resp.raise_for_status()
        data = resp.json()
        try:
            text = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
            print(f"  [warn] unexpected response shape, skipping: {data}")
            return {"skip": True}
        text = re.sub(r"^```json|```$", "", text.strip(), flags=re.MULTILINE).strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            print(f"  [warn] could not parse model output, skipping: {text[:200]}")
            return {"skip": True}

    print("  [warn] gave up after repeated rate limiting")
    return {"skip": True}


def load_existing():
    if DATA_PATH.exists():
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_items(items):
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=2, ensure_ascii=False)


def url_hash(url):
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def main():
    existing = load_existing()
    seen_urls = {i.get("sourceUrl") for i in existing}
    new_items = []

    for feed_url, source_name in FEEDS:
        print(f"Checking {source_name} ({feed_url})...")
        try:
            parsed = feedparser.parse(feed_url)
        except Exception as e:
            print(f"  [error] could not fetch feed: {e}")
            continue

        added_this_feed = 0
        for entry in parsed.entries:
            if added_this_feed >= MAX_NEW_PER_FEED_PER_RUN:
                break
            link = entry.get("link")
            if not link or link in seen_urls:
                continue

            title = entry.get("title", "").strip()
            snippet = entry.get("summary", entry.get("description", "")).strip()
            snippet = re.sub(r"<[^>]+>", " ", snippet)[:600]  # strip HTML, cap length

            if not title:
                continue

            try:
                result = call_llm(title, snippet)
            except Exception as e:
                print(f"  [error] Gemini call failed for '{title}': {e}")
                continue

            time.sleep(4.5)  # stay comfortably under the free tier's per-minute limit

            if result.get("skip"):
                continue
            if result.get("category") not in CATEGORIES:
                print(f"  [warn] unexpected category from model, skipping: {result}")
                continue

            pub_date = entry.get("published_parsed") or entry.get("updated_parsed")
            if pub_date:
                date_str = datetime(*pub_date[:6], tzinfo=timezone.utc).strftime("%Y-%m-%d")
            else:
                date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

            item = {
                "headline": result["headline"],
                "continent": result["continent"],
                "country": result["country"],
                "category": result["category"],
                "date": date_str,
                "summary": result["summary"],
                "sourceName": source_name,
                "sourceUrl": link,
            }
            new_items.append(item)
            seen_urls.add(link)
            added_this_feed += 1
            print(f"  + {item['headline']}")

    if not new_items:
        print("No new items this run.")
        return

    combined = new_items + existing
    combined.sort(key=lambda i: i["date"], reverse=True)
    combined = combined[:MAX_ITEMS_TOTAL]

    save_items(combined)
    print(f"Saved {len(new_items)} new items. Total items: {len(combined)}.")


if __name__ == "__main__":
    main()
