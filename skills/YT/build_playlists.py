#!/usr/bin/env python3
"""
Build YouTube playlist specs from scraped catalog.
Combines watch-history + subscriptions + watch-later into seed corpus,
applies channel/keyword-based theme rules, and emits playlist specs.
"""
import json, re, collections, os
from pathlib import Path

OUT = Path(__file__).parent

# === Load corpus ===
history = json.load(open(OUT/'scrape_history.json'))
subs = json.load(open(OUT/'scrape_subscriptions.json'))
watch_later = json.load(open(OUT/'scrape_watch_later.json'))

# Normalize all videos into a unified record list with source labels
def unify():
    out = []
    seen = set()
    for r in history:
        key = ('h', r['v'])
        out.append({
            'source': 'history',
            'vid': r['v'],
            'title': r['t'],
            'channel': r['c'],
            'views': r.get('w'),
            'duration': r.get('d'),
            'when': r.get('s'),  # section label
        })
    for r in watch_later:
        out.append({
            'source': 'watch_later',
            'vid': r['v'],
            'title': r['t'],
            'channel': r['c'],
            'views': r.get('views'),
            'channel_handle': r.get('ch'),
            'age': r.get('age'),
        })
    return out

videos = unify()

# === Theme rules ===
# Each rule: {name, theme, description, channels (exact match), keywords (regex on title), exclude_keywords}
# Channels are matched on substring (case-insensitive) against the channel field; this catches "and 2 more"
# variants like "Big Think Clips and 2 more".

RULES = [
  {
    'id': 'agentic-ai',
    'name': 'Agentic AI Lab Notes',
    'theme': 'AI coding agents, agentic OS, LLM tooling, AI research talks',
    'description': 'New videos about AI coding agents (Claude Code, Codex, Cursor, Hermes), agentic frameworks, AI research talks, and applied LLM tooling. Optimized for "build with AI" practitioners.',
    'channels': [
      'David Ondrej','Jack Roberts','Chase AI','Paul J Lipsky','Two Minute Papers',
      'Sequoia Capital','Y Combinator','Bloomberg Television','Bloomberg Live',
      'Julian Goldie SEO','James Blue','Ai Verdict','Emergent Garden',
      'David Di Franco','Christian Selig',
    ],
    'keywords': [
      r'\b(claude|codex|cursor|hermes|agentic|agent[\s-]?os|llm|gpt|chatgpt|notebooklm|karpathy|hassabis|anthropic|openai|kimi|deepseek|gemini|copilot|vibe[\s-]?coding|coding agent|ai (coder|civil war|hysteria)|macrohard|microsoft agent)\b',
      r'\bAI\s+(news|coder|hysteria|civil|era)\b',
    ],
    'exclude_keywords': [r'\bcocomelon\b|\bms rachel\b|\bbluey\b'],
    'target_length': 30,
  },
  {
    'id': 'ukraine-frontline',
    'name': 'Frontline: Ukraine',
    'theme': 'Ukraine war coverage, trench/combat footage, geopolitical analysis',
    'description': 'Ukraine war footage and analysis: combat footage, assault breakdowns, counter-offensive coverage, and high-level geopolitical takes on the conflict.',
    'channels': [
      'UaWarrior','Cappy Army','Preston Stewart','The Military Show','Max Afterburner',
      'Predictive History','The Telegraph and Ukraine','The Infographics Show',
    ],
    'keywords': [
      r'\b(ukrain\w+|russia\w*|moscow|crimea|kremlin|trench|assault|counter[\s-]?offensive|geo[\s-]?strategy|iran)\b',
    ],
    'exclude_keywords': [r'\b(commercial|nostalgia|2000s)\b'],
    'target_length': 25,
  },
  {
    'id': 'trip-reports-consciousness',
    'name': 'Trip Reports & Consciousness',
    'theme': 'Psychedelics, altered states, consciousness research, philosophy of mind',
    'description': 'Long-form psychedelic trip reports plus serious consciousness/psychedelics research and philosophy-of-mind content. Pairs trip-report storytelling channels with academic/Sam-Harris-style discussions.',
    'channels': [
      'Vivec','Chayse','fern','Psyphoria','Sam Harris','Big Think','Dr Ben Miles',
    ],
    'keywords': [
      r'\b(psychedelic|lsd|salvia|datura|dmt|mushroom|cannabis|trip[\s-]?report|consciousness|altered state|matthew johnson|ego[\s-]?death|hallucinogen)\b',
    ],
    'exclude_keywords': [],
    'target_length': 30,
  },
  {
    'id': 'crime-bodycam',
    'name': 'Bodycam & Crime Storytime',
    'theme': 'Police bodycam, true-crime narratives, dashcam compilations',
    'description': 'Police bodycam breakdowns, true-crime storytime channels, and dashcam-style compilations. Optimized for "background-watching while doing something else."',
    'channels': [
      'Code Blue Cam','EWU Bodycam','EWU Crime Storytime','Midwest Safety',
      'Police Insider','Unpopular','Beyond Evil','John Lang',
      'Humiliated Reacts & Commentary','Sgt. Pepperspray','Scammer Payback',
    ],
    'keywords': [
      r'\b(police|cop|sheriff|bodycam|dashcam|predator|arrested|gunman|standoff|chase|fleeing|crime|cartel|killer|hostage|home invasion)\b',
    ],
    'exclude_keywords': [r'\bukrain|russia|crimea\b'],
    'target_length': 35,
  },
  {
    'id': 'homelab-selfhost',
    'name': 'Homelab & Self-Hosting',
    'theme': 'Self-hosting, homelab, networking, Linux, containers, NAS',
    'description': 'Homelab builds, self-hosted services, networking deep-dives (Unifi, Mikrotik, OPNsense), Kubernetes/OpenShift, ESP32, Raspberry Pi, and Linux/container plumbing.',
    'channels': [
      'NetworkChuck','KTZ Systems','Noted','jakkuh','Craft Computing','Crosstalk Solutions',
      'OpenShift','Andreas Spiess','Britec09','Geerling Engineering','Virtual Bytes',
      'Toasty Answers','TripleWho?','Red Hat','Smart Home Solver','SingularityComputers',
    ],
    'keywords': [
      r'\b(homelab|self[\s-]?host|self[-]?hosted|nas|truenas|proxmox|kubernet\w+|openshift|docker|container|unifi|opnsense|pfsense|mikrotik|esp32|raspberry[\s-]?pi|home automation|home assistant|vlan|smart home|cni|ovn)\b',
    ],
    'exclude_keywords': [],
    'target_length': 25,
  },
  {
    'id': 'tech-gear',
    'name': 'Tech Gear & Gadget Reviews',
    'theme': 'Consumer tech reviews, gadgets, phones, laptops, peripherals',
    'description': 'Mainstream consumer-tech reviews and gadget content. The "fresh tech" stream — phones, laptops, peripherals, audio, keyboards, weird tech curios.',
    'channels': [
      'Linus Tech Tips','Marques Brownlee','Mac Address','Austin Evans','randomfrankp',
      'MarzBar','Jonathan Morrison','Unbox Therapy','Digital Trends','ShortCircuit',
      'TechLinked','Techquickie','The WAN Show','NCIX Tech Tips',"Tom's Hardware",
      'Tech Uploaded','TweitenTech','Hipyo Tech','Jason Vong','UrAvgConsumer','Wonk',
      'Auto Focus','Christian Selig','Austin Nwachukwu','Adam Savage','Taeha Types',
    ],
    'keywords': [
      r'\b(iphone|android|laptop|keyboard|monitor|gpu|cpu|ssd|nvme|router|wifi|bluetooth|usb-?c|thunderbolt|airpod|review|unbox|setup|tech kit|backpack|gadget|peakdo|hdmi|ecc memory|cooler|case fan|cyberdeck)\b',
    ],
    'exclude_keywords': [r'\b(claude|codex|agent|llm|gpt|kubernet|openshift|homelab)\b'],
    'target_length': 30,
  },
  {
    'id': 'strategy-citybuilder',
    'name': 'Strategy & City-Builder Gaming',
    'theme': 'Civilization, Total War, city builders, grand strategy',
    'description': 'Civ, Total War, city-builder, and grand-strategy game content. Long-form sessions, tutorials, and "let\'s play" runs.',
    'channels': [
      'HeirofCarthage','PotatoMcWhiskey','City Planner Plays','GrayStillPlays','Chaza',
    ],
    'keywords': [
      r'\b(civ\s?\d|civilization|total war|warhammer|city skylines|cities[\s:]+skylines|minecraft|grand strategy|paradox|hoi4|stellaris|crusader kings|ck3)\b',
    ],
    'exclude_keywords': [],
    'target_length': 20,
  },
  {
    'id': 'ttrpg-fantasy',
    'name': 'Dungeons & Lore (TTRPG)',
    'theme': 'D&D, Critical Role, Pathfinder, TTRPG advice, miniature painting',
    'description': 'TTRPG content: Critical Role and other actual-play shows, DM/player advice, character building, miniature painting, terrain building.',
    'channels': [
      'Critical Role','Dungeon Dudes','Ginny Di','Dicey','JoCat',
      'Black Magic Craft','Squidmar Miniatures','Wyrmwood Vlogs',
    ],
    'keywords': [
      r'\b(d&d|dnd|dungeons.{0,4}dragons|ttrpg|pathfinder|frostgrave|kill team|miniature|paint(ing)?|warhammer|crit(ical)?[\s-]?role|game master|dm|dungeon master)\b',
    ],
    'exclude_keywords': [],
    'target_length': 25,
  },
  {
    'id': 'car-hour',
    'name': 'Car Hour',
    'theme': 'Car reviews, auctions, automotive deep-dives',
    'description': 'Car reviews, auction picks, automotive deep-dives. Mix of mainstream (Doug DeMuro, Cars & Bids) and obscure modified-car/historic deep-dives.',
    'channels': [
      'Doug DeMuro','Cars & Bids','MotoManTV','Saabkyle04','TheStraightPipes','Tavarish',
      'Auto Focus','GommeBlog - Car & Performance','Internal Combustion','Krispy Media',
      'LomaPrietaPCA',
    ],
    'keywords': [
      r'\b(porsche|ferrari|lamborghini|car review|track car|supercar|sports car|drift|engine swap|ls swap|widebody|tuner|cars & bids|nakai|rwb)\b',
    ],
    'exclude_keywords': [],
    'target_length': 20,
  },
  {
    'id': 'maker-bench',
    'name': 'Maker Bench: Fab & 3D Printing',
    'theme': '3D printing, woodworking, electronics, CNC, fabrication',
    'description': 'Fabrication content: 3D printing, woodworking, CNC, electronics, prop-making, designing parts. The "long-watch while in the shop" feed.',
    'channels': [
      "Adam Savage's Tested",'Project Farm','Michael Alm (ALM FAB)','JohnGrimsmo',
      'Shaun Boyd Made This','MandicReally','GreatScott!','ElectroBOOM',
      'Small Batch Factory','Black Magic Craft','Squidmar Miniatures','Engineer Bo',
      'Visual Thinker','FLIGHTORY','Patrick Sullivan',
    ],
    'keywords': [
      r'\b(3d[\s-]?print|cnc|woodworking|router table|knife making|fabrication|electronics|soldering|laser cut|workshop|maker|fixed-wing drone|terrain|prop)\b',
    ],
    'exclude_keywords': [],
    'target_length': 25,
  },
  {
    'id': 'story-decoded',
    'name': 'Story Decoded (Film & Lore)',
    'theme': 'Film analysis, lore theories — Harry Potter, Star Wars, Disney, MCU',
    'description': 'Film/show analysis and lore deep-dives: SuperCarlinBrothers, theory channels, breakdowns of single shots/scenes, Harry Potter/Star Wars/MCU/Disney explainers.',
    'channels': [
      'SuperCarlinBrothers','SUPER FRAME','InCinematic','ScreenPuff',
      'A Matter of Film and Tongal','Order 77','Harry Potter Theory','boonanaman',
      'WatchMojo.com',
    ],
    'keywords': [
      r'\b(harry potter|voldemort|horcrux|hogwarts|star wars|jedi|sith|obi-?wan|marvel|mcu|dune|prince of egypt|cinema|film|movie|scene|audition|director\b)\b',
    ],
    'exclude_keywords': [],
    'target_length': 25,
  },
  {
    'id': 'big-ideas-science',
    'name': 'Emergence & Big Ideas',
    'theme': 'Emergence, complexity, physics, neural networks, big-picture science',
    'description': 'Long-form science: emergence, complexity, AI/neural-net research, physics deep-dives, astronomy. Pairs Emergent Garden / Two Minute Papers / Veritasium with documentary-length space and physics content.',
    'channels': [
      'Emergent Garden','Two Minute Papers','Veritasium','Hank Green',
      'Cosmic Atoms and Late Science','Megaprojects','Sideprojects','Half as Interesting',
      'Dr Ben Miles','NullSpace','Simplify Dude','Undecided with Matt Ferrell',
      'Domain of Science','Wendover Productions','TED',
    ],
    'keywords': [
      r'\b(emergent|emergence|complexity|neural network|gradient descent|evolution|quantum|black hole|telescope|james webb|graphene|magellan|big bang|cosmology|relativity|space documentary|tidal|map of)\b',
    ],
    'exclude_keywords': [],
    'target_length': 25,
  },
  {
    'id': 'mind-self',
    'name': 'Mind & Self',
    'theme': 'Therapy, autism/ADHD, philosophy of self, cognitive psychology',
    'description': 'Therapy frameworks (ACT, CBT), autism/AuDHD content, cognitive distortions, dopamine/attention, Sam-Harris-style philosophy-of-self. For the "actively working on it" mode.',
    'channels': [
      'Therapy in a Nutshell','Auticate with Chris & Debby','Sam Harris',
      'Pattern Weaver Mind','Big Think','Philosophical Calm With Rici','Psychic Yoo',
    ],
    'keywords': [
      r'\b(therapy|anxiety|autism|au[\s-]?dhd|adhd|cognitive distortion|dopamine|mindful|meditation|attention|psychology|self-?talk|emotional|intrusive thoughts|self-?improvement)\b',
    ],
    'exclude_keywords': [r'\bpsychedelic|lsd|dmt|mushroom|trip[\s-]?report\b'],
    'target_length': 20,
  },
  {
    'id': 'y2k-time-machine',
    'name': 'Y2K Time Machine',
    'theme': 'Retro TV commercials, 90s/2000s nostalgia, vintage media',
    'description': '90s and 2000s TV commercials, vintage broadcast archives, era-specific nostalgia. Long compilation videos for background watching.',
    'channels': [
      'arwuns','90s Nostalgia',"Dave's Archives",'Armando Barron Gaming & Films',
    ],
    'keywords': [
      r'\b(\d{2,4}s? (tv )?commercial|nostalgi\w+|y2k|90s|2000s|vintage|retro tv|broadcast|throwback|remembering television)\b',
    ],
    'exclude_keywords': [],
    'target_length': 20,
  },
  {
    'id': 'toddler-rotation',
    'name': 'Toddler Rotation',
    'theme': 'Toddler-safe content: Ms Rachel, Cocomelon, Bluey',
    'description': 'Curated toddler content — known-safe channels only. Explicitly excludes anything from the parental playlists so this can be played on a kid-facing device.',
    'channels': [
      'Ms Rachel - Toddler Learning Videos','Cocomelon - Nursery Rhymes','Bluey - Official Channel',
    ],
    'keywords': [
      r'\b(ms rachel|cocomelon|bluey|toddler|nursery rhyme|preschool)\b',
    ],
    'exclude_keywords': [],
    'target_length': 30,
  },
  {
    'id': 'outdoors-adventure',
    'name': 'Outdoors & Adventure',
    'theme': 'Outdoor projects, travel, off-grid, family adventures',
    'description': 'Outdoor and travel content: family camping/forging/cooking, full-time travel vlogs, off-grid builds. Pairs durable interests (Outdoor Boys, Kara and Nate) with one-off road trip and outdoor-hobby finds.',
    'channels': [
      'Outdoor Boys','Kara and Nate','Wyrmwood Vlogs',"Rick's Creations",
    ],
    'keywords': [
      r'\b(camping|forging|fossil hunting|magnet fish|off[\s-]?grid|outdoor|wilderness|road trip|hike|hiking|travel vlog|adventure)\b',
    ],
    'exclude_keywords': [r'\bukrain|trench|russia|cop\b'],
    'target_length': 20,
  },
  {
    'id': 'music-piano-vocals',
    'name': 'Music: Piano & Vocals',
    'theme': 'Piano covers, vocal coach reactions, music performance breakdowns',
    'description': 'Long-form music content: piano covers with reactive visuals (Rousseau-style), vocal coach reactions and breakdowns of singer technique, sheet-music-style performances.',
    'channels': [
      'Rousseau','The Charismatic Voice','Birds Piano Academy',
    ],
    'keywords': [
      r'\b(piano cover|piano|vocal coach|reaction|singer|opera|operatic|sheet music|sing(s|ing)|jazz|orchestral)\b',
    ],
    'exclude_keywords': [r'\bcop\b'],
    'target_length': 15,
  },
  {
    'id': 'storm-watch',
    'name': 'Storm Watch',
    'theme': 'Live severe weather, storm chasing, meteorology',
    'description': 'Severe-weather livestreams and storm-chase recap content. Small but distinctive interest — pulls from a tight set of meteorology channels.',
    'channels': [
      "Ryan Hall, Y'all",'TwisterChasers',
    ],
    'keywords': [
      r'\b(tornado|hurricane|storm chas\w+|severe weather|meteorolog|supercell|funnel cloud|tropical storm)\b',
    ],
    'exclude_keywords': [],
    'target_length': 15,
  },
  {
    'id': 'wealth-lifestyle',
    'name': 'Wealth, Mansions & Business',
    'theme': 'Luxury home tours, business strategy breakdowns, ultra-wealth profiles',
    'description': 'Luxury mansion tours, business-strategy explainers (WSJ Economics style), profiles of the ultra-wealthy, lifestyle aspirational content.',
    'channels': [
      'Enes Yilmazer','The Enes Yılmazer Podcast','MagnatesMedia',
      'The Wall Street Journal',
    ],
    'keywords': [
      r'\b(mansion|luxury|wealth|billionaire|ultra-?rich|economics of|business strateg|inside.+(home|mansion|estate)|net worth)\b',
    ],
    'exclude_keywords': [],
    'target_length': 15,
  },
  {
    'id': 'comedy-wildcards',
    'name': 'Comedy & Wildcards',
    'theme': 'Sketch comedy, internet humor, scam-baiting, dev humor',
    'description': 'Sketch comedy, comedic challenges/stunts, scam-baiting content, and internet-niche humor (e.g. KRAZAM dev satire). The "I just want a laugh" feed.',
    'channels': [
      "that's a bad idea",'Channel Super Fun','PewDiePie','MrGreenGuy',
      'Scammer Payback','JoCat','KRAZAM',
    ],
    'keywords': [
      r'\b(scammer|sketch|comedy|prank|microservices|skit|funniest|best fails)\b',
    ],
    'exclude_keywords': [],
    'target_length': 20,
  },
  {
    'id': 'disney-parks',
    'name': 'Disney Parks Day',
    'theme': 'Disney World/Disneyland food, attractions, parades',
    'description': 'Disney parks content: food guides (DFBGuide), parades, attraction breakdowns. For trip planning or armchair Disney watching.',
    'channels': [
      'DFBGuide','The DIS',
    ],
    'keywords': [
      r'\b(disney|magic kingdom|epcot|disneyland|walt disney world|main street|electrical parade|disney cruise)\b',
    ],
    'exclude_keywords': [],
    'target_length': 15,
  },
]

# === Matcher ===
def channel_matches(rule_channels, ch):
    if not ch: return False
    ch_l = ch.lower()
    return any(rc.lower() in ch_l for rc in rule_channels)

def title_matches(patterns, title):
    if not title: return False
    return any(re.search(p, title, re.IGNORECASE) for p in patterns)

def assign_videos(rule, vids):
    inc_kw = rule['keywords']
    exc_kw = rule.get('exclude_keywords') or []
    matches = []
    for v in vids:
        ch_hit = channel_matches(rule['channels'], v['channel'])
        kw_hit = title_matches(inc_kw, v['title'])
        if not (ch_hit or kw_hit):
            continue
        if exc_kw and title_matches(exc_kw, v['title']):
            continue
        score = 0
        score += 2 if ch_hit else 0
        score += 1 if kw_hit else 0
        score += 1 if v['source'] == 'watch_later' else 0   # WL = explicit intent
        matches.append((score, v))
    matches.sort(key=lambda x: (-x[0], (x[1].get('title') or '').lower()))
    # Dedupe by videoId, keeping the highest-scored / earliest occurrence
    seen = set()
    dedup = []
    for score, v in matches:
        if v['vid'] in seen: continue
        seen.add(v['vid'])
        dedup.append(v)
    return dedup

# === Build specs ===
specs = []
for rule in RULES:
    seeds = assign_videos(rule, videos)
    matching_subs = [s for s in subs if any(rc.lower() in (s.get('name') or '').lower() for rc in rule['channels'])]
    spec = {
        'id': rule['id'],
        'name': rule['name'],
        'theme': rule['theme'],
        'description': rule['description'],
        'inclusion_rules': {
            'channels': rule['channels'],
            'title_keywords_regex': rule['keywords'],
        },
        'exclusion_rules': {
            'title_keywords_regex': rule.get('exclude_keywords', []),
        },
        'target_length': rule['target_length'],
        'subscribed_channels_in_scope': [s.get('name') for s in matching_subs],
        'seed_videos_from_corpus': [
            {
                'videoId': v['vid'],
                'url': f'https://www.youtube.com/watch?v={v["vid"]}',
                'title': v['title'],
                'channel': v['channel'],
                'source': v['source'],
            }
            for v in seeds[:20]
        ],
        'seed_count': len(seeds),
    }
    specs.append(spec)

# === Write outputs ===
with open(OUT/'playlist_specs.json', 'w') as f:
    json.dump(specs, f, indent=2, ensure_ascii=False)

# Markdown summary
lines = ['# YouTube Playlist Specs', '', f'Generated from {len(history)} watch-history records, {len(subs)} subscriptions, {len(watch_later)} watch-later videos.', '', '## Index', '']
for s in specs:
    lines.append(f"- **[{s['name']}](#{s['id']})** — {s['theme']}  · target {s['target_length']} · {s['seed_count']} seed matches in corpus")
lines.append('')
for s in specs:
    lines += [
        f"## {s['name']} {{#{s['id']}}}",
        '',
        f"**ID:** `{s['id']}`",
        '',
        f"**Theme.** {s['theme']}",
        '',
        f"**Description.** {s['description']}",
        '',
        f"**Target length:** ~{s['target_length']} videos · **Corpus matches:** {s['seed_count']}",
        '',
        '### Inclusion rules',
        '',
        f"- **Channels:** {', '.join(s['inclusion_rules']['channels'])}",
        f"- **Title keyword regex:** {' · '.join('`'+k+'`' for k in s['inclusion_rules']['title_keywords_regex'])}",
        '',
    ]
    if s['exclusion_rules']['title_keywords_regex']:
        lines += [
            '### Exclusion rules',
            '',
            f"- **Title keyword regex:** {' · '.join('`'+k+'`' for k in s['exclusion_rules']['title_keywords_regex'])}",
            '',
        ]
    if s['subscribed_channels_in_scope']:
        lines += [
            '### Subscribed channels matched',
            '',
            ', '.join(s['subscribed_channels_in_scope']),
            '',
        ]
    lines += [
        '### Seed videos from your corpus',
        '',
    ]
    if not s['seed_videos_from_corpus']:
        lines.append('_(no matches in current scrape corpus — Takeout history may add more)_')
    else:
        for v in s['seed_videos_from_corpus']:
            lines.append(f"- [{v['title']}]({v['url']}) — *{v['channel']}* ({v['source']})")
    lines.append('')

with open(OUT/'playlist_specs.md', 'w') as f:
    f.write('\n'.join(lines))

# Coverage report
covered = set()
for s in specs:
    for v in s['seed_videos_from_corpus']:
        covered.add(v['videoId'])
uncovered_history = [r for r in history if r['v'] not in covered]
uncovered_wl = [r for r in watch_later if r['v'] not in covered]
total_unique = len({r['v'] for r in history} | {r['v'] for r in watch_later})
covered_count = len(covered & ({r['v'] for r in history} | {r['v'] for r in watch_later}))
print(f"Corpus coverage: {covered_count}/{total_unique} unique videos appear in at least one playlist's seed list (top 20 per playlist).")
print(f"Uncovered watch-later (need a new bucket or are one-offs): {len(uncovered_wl)}")
for r in uncovered_wl[:15]:
    print(f"  - [{r['c']}] {r['t']}")
print()
print('=== Playlist sizes (corpus matches) ===')
for s in specs:
    print(f"  {s['seed_count']:>4}  {s['name']}")
