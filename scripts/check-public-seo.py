#!/usr/bin/env python3
"""Smoke-test the anonymous public SEO switch at one gateway (Python 3.9+)."""

import argparse
import http.client
import re
import signal
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from html.parser import HTMLParser
from urllib.parse import urlsplit


CATALOG = "/ru/cars/"
FILTERED = CATALOG + "?make=toyota"
LANGUAGES = {"ru": "ru", "en": "en", "zh-hans": "zh", "x-default": "ru"}
CRAWLERS = ("*", "googlebot", "bingbot", "yandex", "yandexbot")
ROBOTS_NAMES = {"robots", *CRAWLERS[1:]}
XML = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
MIB = 1024 * 1024
PUBLIC_PAGE = re.compile(r"/(?:zh|en|ru)/(?:cars/(?:[\w-]+/)?|buy/|about/|calculator/[\w-]+/)?", re.ASCII)


def require(ok, message):
    if not ok:
        raise ValueError(message)


def origin(value):
    url = urlsplit(value)
    if (url.scheme not in ("http", "https") or not url.hostname or url.username is not None
            or url.password is not None or url.path not in ("", "/") or url.query or url.fragment):
        raise argparse.ArgumentTypeError("expected an HTTP(S) origin without a path or credentials")
    return f"{url.scheme}://{url.netloc}"


def fetch(base, path, limit):
    # Direct connections keep each GET on the operator's gateway, including shard samples.
    url = urlsplit(base)
    connection = http.client.HTTPSConnection if url.scheme == "https" else http.client.HTTPConnection
    client = connection(url.hostname, url.port, timeout=12)
    try:
        client.request("GET", path, headers={"User-Agent": "HDAutoSeoCheck/1.0", "Accept-Encoding": "identity"})
        response = client.getresponse()
        require(response.status == 200, f"{path} returned HTTP {response.status}")
        body = response.read(limit + 1)
        require(len(body) <= limit, f"{path} exceeded {limit} bytes")
        return body, response.headers
    finally:
        client.close()


def robots_groups(body):
    groups = defaultdict(list)
    agents = []
    started_rules = False
    for line in body.decode("utf-8-sig").splitlines():
        key, _, value = line.partition("#")[0].partition(":")
        key, value = key.strip().lower(), value.strip()
        if key == "user-agent" and value:
            if started_rules:
                agents = []
                started_rules = False
            agents.append(value.lower())
            groups.setdefault(value.lower(), [])
        elif key in ("allow", "disallow"):
            started_rules = True
            for agent in agents:
                if value:
                    groups[agent].append((key, value))
    require("*" in groups, "robots.txt has no wildcard user-agent group")
    return groups


def crawlable(rules, path):
    matches = []
    for action, pattern in rules:
        expr = re.escape(pattern.removesuffix("$")).replace(r"\*", ".*")
        if re.match(expr + ("$" if pattern.endswith("$") else ""), path):
            matches.append((len(pattern.rstrip("$").replace("*", "").encode()), action == "allow"))
    return max(matches, default=(0, True))[1]


def check_crawlable(groups, path):
    for agent in CRAWLERS:
        group = max((key for key in groups if key != "*" and key in agent), key=len, default="*")
        require(crawlable(groups[group], path), f"robots.txt blocks {agent} on {path}")


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_head = False
        self.blocked = set()
        self.canonical = []
        self.alternates = defaultdict(list)

    def directives(self, agent, value):
        if agent in ROBOTS_NAMES and {"none", "noindex"}.intersection(re.split(r"[,\s]+", value.lower())):
            self.blocked.add(agent)

    def handle_starttag(self, tag, attrs):
        if tag == "head":
            self.in_head = True
        if not self.in_head:
            return
        values = {k: v or "" for k, v in attrs}
        if tag == "meta":
            self.directives(values.get("name", "").lower(), values.get("content", ""))
        if tag == "link":
            rel = values.get("rel", "").lower().split()
            if "canonical" in rel:
                self.canonical.append(values.get("href", ""))
            if "alternate" in rel and "hreflang" in values:
                self.alternates[values["hreflang"].lower()].append(values.get("href", ""))

    def handle_endtag(self, tag):
        if tag == "head":
            self.in_head = False


def page(base, path, closed):
    body, headers = fetch(base, path, 8 * MIB)
    require(headers.get_content_type() == "text/html", f"{path} did not serve HTML")
    metadata = Metadata()
    metadata.feed(body.decode("utf-8"))
    metadata.close()
    for header in headers.get_all("X-Robots-Tag", []):
        agent = "robots"
        for item in header.lower().split(","):
            prefix, colon, directive = item.strip().partition(":")
            if colon:
                if prefix in ("max-snippet", "max-image-preview", "max-video-preview", "unavailable_after"):
                    continue
                agent, item = prefix, directive
            metadata.directives(agent.strip(), item)
    if closed:
        require("robots" in metadata.blocked, f"{path} missing generic noindex in HTML or HTTP headers")
    else:
        require(not metadata.blocked, f"{path} has a noindex directive for {', '.join(sorted(metadata.blocked))}")
    return metadata


def locations(base, path, public, root_tag):
    body, _ = fetch(base, path, 50 * MIB)
    require(b"<!DOCTYPE" not in body, f"{path} contains an unexpected XML doctype")
    root = ET.fromstring(body)
    require(root.tag == XML + root_tag, f"{path} expected {root_tag}, found {root.tag}")
    entry = XML + ("sitemap" if root_tag == "sitemapindex" else "url")
    paths = []
    for element in root:
        require(element.tag == entry, f"{path} contains an unexpected element")
        loc = element.findall(XML + "loc")
        require(len(loc) == 1, f"{path} entry needs one loc")
        url = urlsplit((loc[0].text or "").strip())
        require(f"{url.scheme}://{url.netloc}" == public and url.path.startswith("/")
                and not url.path.startswith("//") and not url.query and not url.fragment,
                f"{path} has a noncanonical or off-origin loc")
        paths.append(url.path)
    return paths


def check(base, public, closed, require_vehicle=False):
    body, _ = fetch(base, "/robots.txt", 512 * 1024)
    groups = robots_groups(body)
    if closed:
        for agent, rules in groups.items():
            require(any(action == "disallow" and p in ("/", "/*") for action, p in rules)
                    and not any(action == "allow" for action, _ in rules),
                    f"robots.txt group {agent!r} lacks blanket exclusion or contains an exception")
    else:
        check_crawlable(groups, CATALOG)

    catalog = page(base, CATALOG, closed)
    page(base, FILTERED, True)
    if closed:
        require(not locations(base, "/sitemap.xml", public, "urlset"), "closed sitemap has entries")
        print("Closed verified: restrictive robots groups, catalog and filter noindex, empty sitemap.")
        return

    require(catalog.canonical == [public + CATALOG], f"{CATALOG} has an incorrect or duplicate canonical")
    for language, locale in LANGUAGES.items():
        require(catalog.alternates[language] == [f"{public}/{locale}/cars/"],
                f"{CATALOG} has an incorrect or duplicate {language} alternate")
    shards = locations(base, "/sitemap.xml", public, "sitemapindex")
    require(0 < len(shards) <= 50000 and len(set(shards)) == len(shards), "invalid shard count or duplicate loc")
    # Sample the first and last shard. A production catalog can contain hundreds of thousands of vehicles.
    sampled = list(dict.fromkeys([shards[0], shards[-1]]))
    sample = None
    vehicle_sample = None
    for shard in sampled:
        paths = locations(base, shard, public, "urlset")
        require(0 < len(paths) <= 10000, f"{shard} contains {len(paths)} URLs (expected 1–10,000)")
        require(all(PUBLIC_PAGE.fullmatch(p) for p in paths), f"{shard} contains a non-release page URL")
        if sample is None:
            sample = paths[0]
        if vehicle_sample is None:
            vehicle_sample = next((p for p in paths if re.fullmatch(r"/(?:zh|en|ru)/cars/[\w-]+/", p)), None)
    if require_vehicle:
        require(vehicle_sample is not None, "no eligible vehicle detail found in sampled sitemap shards")
    sample = vehicle_sample or sample
    check_crawlable(groups, sample)
    metadata = catalog if sample == CATALOG else page(base, sample, False)
    require(metadata.canonical == [public + sample], f"sampled URL {sample} has an incorrect canonical")
    print(f"Open verified: catalog and alternates, filter noindex, {len(shards)} shard(s) listed, "
          f"{len(sampled)} sampled, indexed-page candidate {sample} served with its own canonical.")


def timeout(signum, frame):
    raise TimeoutError("90-second total check deadline exceeded")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=origin, required=True, help="gateway to fetch, e.g. http://127.0.0.1:3363")
    parser.add_argument("--public-origin", type=origin, required=True, help="origin expected in canonical and sitemap URLs")
    parser.add_argument("--phase", choices=("open", "closed"), required=True)
    parser.add_argument("--require-vehicle", action="store_true", help="require the open sitemap sample to include a vehicle detail")
    args = parser.parse_args()
    if args.require_vehicle and args.phase != "open":
        parser.error("--require-vehicle needs --phase open")
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(90)
    try:
        check(args.base, args.public_origin, args.phase == "closed", args.require_vehicle)
    except (ValueError, OSError, http.client.HTTPException, ET.ParseError) as error:
        sys.exit(f"SEO {args.phase} check failed: {error}")
