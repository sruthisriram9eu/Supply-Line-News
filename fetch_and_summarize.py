"""
Supply Line - fetch & summarize pipeline (version 3).

What this does on every scheduled run:
  1. NEWS: reads supply chain news feeds (RSS), asks Gemini to judge relevance,
     rewrite each story in 60-100 words, and tag category / continent / country.
     Saved to news.json.
  2. FUTURE WATCH: reads technology and research feeds (including recent
     supply chain papers from arXiv) and saves short plain-language write-ups,
     each with a "why it matters" line. Saved to innovation.json.
  3. REMEMBERS articles it already rejected (rejected.json) so it does not
     spend free-tier quota re-judging the same off-topic articles every run.

To add a source, add one line to NEWS_FEEDS or INNOVATION_FEEDS below.
Each run prints a line per feed, so open the Actions log to see which feeds
work. A feed that prints "[warn] 0 entries" has a wrong address or is
blocking us.

Environment variable required: GEMINI_API_KEY
"""

import os
import re
import sys
import json
import time
import html
from datetime import datetime, timezone
from pathlib import Path

import requests
import feedparser

HERE = Path(__file__).resolve().parent
NEWS_PATH = HERE / "news.json"
INNOVATION_PATH = HERE / "innovation.json"
REJECTED_PATH = HERE / "rejected.json"

# "-latest" is a Google-maintained alias, so this keeps working when Google
# retires specific model versions.
MODEL = "gemini-flash-lite-latest"
API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
API_KEY = os.environ.get("GEMINI_API_KEY")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; SupplyLineBot/1.0; "
                  "+https://sruthisriram9eu.github.io/Supply-Line-News/)"
}

PAUSE_SECONDS = 4.5          # keeps us under the free tier's per-minute limit
MAX_NEWS_ITEMS = 400         # oldest stories drop off past this

# Regional balance: the newest stories from an over-represented region are
# kept and older ones are dropped, so one region cannot crowd out the others.
# Raise or lower these numbers any time. Regions not listed have no limit.
REGION_LIMITS = {
    "North America": 50,
    "Global": 60,
}
MAX_INNOVATION_ITEMS = 120
MAX_REJECTED_REMEMBERED = 4000

# ---------------------------------------------------------------------------
# NEWS FEEDS: (rss_address, display_name, max_new_stories_per_run)
# The per-run number is how Asia and Europe get more room than North America.
# ---------------------------------------------------------------------------
NEWS_FEEDS = [
    # Strong Asia coverage
    ("https://splash247.com/feed/", "Splash247", 12),
    ("https://container-news.com/feed/", "Container News", 12),
    ("https://www.hellenicshippingnews.com/feed/", "Hellenic Shipping News", 6),
    # Strong Europe coverage
    ("https://theloadstar.com/feed/", "The Loadstar", 12),
    ("https://www.porttechnology.org/feed/", "Port Technology International", 6),
    ("https://www.railfreight.com/feed/", "RailFreight.com", 6),
    ("https://www.imd.org/ibyimd/tag/manufacturing/feed/", "IMD Business School", 4),
    # Global / North America, kept smaller on purpose
    ("https://www.supplychaindive.com/feeds/news/", "Supply Chain Dive", 2),
    ("https://www.freightwaves.com/feed", "FreightWaves", 2),
    ("https://www.aircargonews.net/feed", "Air Cargo News", 4),
    ("https://www.scdigest.com/rss/scdigest_headlines.xml", "Supply Chain Digest", 2),
]

# ---------------------------------------------------------------------------
# FUTURE WATCH FEEDS: (address, display_name, status, max_new_per_run)
# status "preprint" = research paper not yet peer reviewed (shown as a badge).
# ---------------------------------------------------------------------------
INNOVATION_FEEDS = [
    ("https://export.arxiv.org/api/query?search_query=all:%22supply+chain%22"
     "&sortBy=submittedDate&sortOrder=descending&max_results=20",
     "arXiv", "preprint", 6),
    ("https://www.therobotreport.com/feed/", "The Robot Report", "news", 6),
    ("https://techcrunch.com/category/transportation/feed/", "TechCrunch", "news", 5),
    ("https://www.technologyreview.com/feed/", "MIT Technology Review", "news", 5),
]

CATEGORIES = [
    "strategy", "procurement", "manufacturing", "logistics",
    "storage_distribution", "international_relations", "sustainability", "crm",
]
CONTINENTS = [
    "North America", "South America", "Europe", "Asia",
    "Middle East", "Africa", "Oceania", "Global",
]
KINDS = ["research", "technology", "use_case"]

NEWS_PROMPT = """You are helping build a supply chain news aggregator.
You will be given an article's title and a short snippet.

First decide whether it is genuinely about supply chain management: strategy,
procurement and sourcing, manufacturing and lean, logistics and freight,
warehousing and distribution, international trade, tariffs or geopolitics
affecting trade, sustainability in supply chains, or customer-facing supply
chain operations. Respond with exactly {"skip": true} if it is NOT, including:
podcast recaps, event listings, ads, job moves with no strategic signal,
and stories that are only about local trucking enforcement, crime, arrests or
individual court cases.

If it IS relevant, respond with ONLY a JSON object (no markdown, no preamble):
{
  "headline": "clear specific headline in your own words, under 90 characters",
  "summary": "60 to 100 words in your own words (never copy phrasing), factual, neutral",
  "category": "one of: __CATEGORIES__",
  "continent": "one of: __CONTINENTS__ (where the news actually happens)",
  "country": "the single most relevant country, or 'Multiple' if not country-specific"
}
Never quote the source. Never invent facts that are not in the input."""

INNOVATION_PROMPT = """You write the "Future Watch" section of a supply chain
news site: new technology, inventions, new use cases and research that could
shape the future of supply chains, logistics, manufacturing, warehousing,
ports, procurement or trade.

You will be given a title and a snippet or abstract. If it is NOT clearly
relevant to supply chains, logistics, warehouses, ports, freight, manufacturing
or trade technology, respond with exactly {"skip": true}.

Otherwise respond with ONLY a JSON object (no markdown, no preamble):
{
  "headline": "plain-language headline under 90 characters, in your own words",
  "summary": "60 to 100 words in plain language for a non-specialist: what was built or found, and how. Your own words, no hype.",
  "why_it_matters": "ONE sentence, maximum 25 words, on what this could mean for supply chains. Be modest: say 'early-stage' or 'could' where the input is a research paper or a pilot.",
  "kind": "one of: research (a study or paper), technology (a new product, tool or invention), use_case (a real company or deployment applying technology)",
  "continent": "one of: __CONTINENTS__",
  "country": "single most relevant country, or 'Multiple'"
}
Never invent results, numbers or claims that are not in the input."""

NEWS_PROMPT = (NEWS_PROMPT
               .replace("__CATEGORIES__", ", ".join(CATEGORIES))
               .replace("__CONTINENTS__", ", ".join(CONTINENTS)))
INNOVATION_PROMPT = INNOVATION_PROMPT.replace("__CONTINENTS__", ", ".join(CONTINENTS))


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def load_json(path, default):
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError:
            print(f"[warn] {path.name} could not be read, starting it fresh")
    return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def clean(text, limit):
    text = html.unescape(text or "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def entry_date(entry):
    stamp = entry.get("published_parsed") or entry.get("updated_parsed")
    if stamp:
        return datetime(*stamp[:6], tzinfo=timezone.utc).strftime("%Y-%m-%d")
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def fetch_entries(url):
    """Download a feed with a normal browser-style header, then parse it."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f"  [error] could not download this feed: {e}")
        return []
    entries = feedparser.parse(resp.content).entries
    if not entries:
        print("  [warn] 0 entries - wrong address, or the site is blocking us")
    return entries


def call_llm(system_prompt, user_text, retries=3):
    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"parts": [{"text": user_text}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 700},
    }
    for attempt in range(retries):
        resp = requests.post(API_URL, headers={"content-type": "application/json"},
                             params={"key": API_KEY}, json=payload, timeout=60)
        if resp.status_code == 429:
            wait = 15 * (attempt + 1)
            print(f"  [rate limit] waiting {wait}s before retrying...")
            time.sleep(wait)
            continue
        resp.raise_for_status()
        data = resp.json()
        try:
            text = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
            print(f"  [warn] unexpected response shape, skipping: {str(data)[:200]}")
            return {"skip": True}
        text = re.sub(r"^```json|```$", "", text.strip(), flags=re.MULTILINE).strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            print(f"  [warn] could not parse model output, skipping: {text[:150]}")
            return {"skip": True}
    raise RuntimeError("rate limited repeatedly")


def good_text(value, min_words=1):
    return isinstance(value, str) and len(value.split()) >= min_words


def run_feeds(feeds, existing, rejected, prompt, build_item, label):
    """Shared loop for both pipelines. Returns the list of newly built items."""
    seen = {i.get("sourceUrl") for i in existing} | rejected
    new_items = []
    for feed in feeds:
        url, name, cap = feed[0], feed[1], feed[-1]
        print(f"[{label}] Checking {name} ...")
        added = 0
        attempts = 0
        for entry in fetch_entries(url):
            if added >= cap or attempts >= cap * 3:
                break
            link = entry.get("link")
            title = clean(entry.get("title"), 300)
            if not link or not title or link in seen:
                continue
            snippet = clean(entry.get("summary") or entry.get("description"), 1200)
            attempts += 1
            try:
                result = call_llm(prompt, f"Title: {title}\n\nSnippet: {snippet}")
            except Exception as e:
                print(f"  [error] model call failed for '{title[:60]}': {e}")
                time.sleep(PAUSE_SECONDS)
                continue
            time.sleep(PAUSE_SECONDS)
            seen.add(link)
            item = None if result.get("skip") else build_item(result, entry, feed, link)
            if item is None:
                rejected.add(link)
                continue
            new_items.append(item)
            added += 1
            print(f"  + {item['headline']}")
    return new_items


def build_news_item(result, entry, feed, link):
    if result.get("category") not in CATEGORIES:
        return None
    if not (good_text(result.get("headline")) and good_text(result.get("summary"), 25)):
        return None
    continent = result.get("continent")
    return {
        "headline": result["headline"].strip(),
        "continent": continent if continent in CONTINENTS else "Global",
        "country": str(result.get("country") or "Multiple"),
        "category": result["category"],
        "date": entry_date(entry),
        "summary": result["summary"].strip(),
        "sourceName": feed[1],
        "sourceUrl": link,
    }


def build_innovation_item(result, entry, feed, link):
    if result.get("kind") not in KINDS:
        return None
    if not (good_text(result.get("headline")) and good_text(result.get("summary"), 25)
            and good_text(result.get("why_it_matters"), 4)):
        return None
    continent = result.get("continent")
    return {
        "headline": result["headline"].strip(),
        "continent": continent if continent in CONTINENTS else "Global",
        "country": str(result.get("country") or "Multiple"),
        "kind": result["kind"],
        "status": feed[2],
        "date": entry_date(entry),
        "summary": result["summary"].strip(),
        "whyItMatters": result["why_it_matters"].strip(),
        "sourceName": feed[1],
        "sourceUrl": link,
    }


def apply_region_limits(items, rejected):
    """Keep the newest stories per region up to REGION_LIMITS; drop the rest."""
    counts, kept = {}, []
    for item in sorted(items, key=lambda i: i["date"], reverse=True):
        region = item.get("continent")
        limit = REGION_LIMITS.get(region)
        if limit is not None and counts.get(region, 0) >= limit:
            rejected.add(item.get("sourceUrl"))   # don't fetch it again later
            continue
        counts[region] = counts.get(region, 0) + 1
        kept.append(item)
    return kept


def merge(existing, new_items, limit):
    combined = new_items + existing
    combined.sort(key=lambda i: i["date"], reverse=True)
    return combined[:limit]


def main():
    if not API_KEY:
        print("ERROR: GEMINI_API_KEY is not set. Add it under Settings > Secrets and variables > Actions.")
        sys.exit(1)

    news = load_json(NEWS_PATH, [])
    innovation = load_json(INNOVATION_PATH, [])
    rejected = set(load_json(REJECTED_PATH, []))

    new_news = run_feeds(NEWS_FEEDS, news, rejected, NEWS_PROMPT, build_news_item, "news")
    new_innovation = run_feeds(INNOVATION_FEEDS, innovation, rejected,
                               INNOVATION_PROMPT, build_innovation_item, "future")

    before = len(news)
    news = apply_region_limits(merge(news, new_news, MAX_NEWS_ITEMS), rejected)
    if new_news or len(news) != before:
        save_json(NEWS_PATH, news)
    if new_innovation or not INNOVATION_PATH.exists():
        innovation = merge(innovation, new_innovation, MAX_INNOVATION_ITEMS)
        save_json(INNOVATION_PATH, innovation)
    save_json(REJECTED_PATH, sorted(u for u in rejected if u)[-MAX_REJECTED_REMEMBERED:])

    print(f"Done. New news: {len(new_news)} (total {len(news)}). "
          f"New Future Watch: {len(new_innovation)} (total {len(innovation)}).")


if __name__ == "__main__":
    main()
