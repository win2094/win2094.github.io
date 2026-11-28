# win2094.github.io

Personal game portfolio for **HSU Tsui** (Will Hsu / win2094).

## Site map

| Path | Page |
|------|------|
| `/` | Homepage (Fly embed + game list) |
| `/games/happy-polygon/` | Happy Polygon detail |
| `/games/soso-sleep/` | SoSo Sleep / SoSoSheep detail |
| `/games/fly/` | FLY ACE detail (links to playable build) |
| `/games/hunt/` | Hunt / 鬥技場狩龍 detail |
| `/fly/` | Playable FLY ACE game (do not break) |
| `/hunt/` | Playable Hunt / 鬥技場狩龍 (do not break) |
| `/app-ads.txt` | AdSense / ads.txt |

## GitHub Pages

This is a **user site** (`win2094.github.io`). Pages is already enabled on the repo (`has_pages: true`).

1. Repo **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **`main`** / folder **`/` (root)**
4. Site URL: <https://win2094.github.io/>

`.nojekyll` is present so GitHub does not process the site with Jekyll.

**Important:** The live URL always serves **`main`**. Review feature work on a PR (or Try Live) before merging.

## Design

Black-and-white **pixel** UI (Press Start 2P / DotGothic16), bilingual EN / 繁中. App icons may use real color. Fly is playable on the homepage; Hunt plays at `/hunt/`.

## Local preview

```bash
python3 -m http.server 8080 --bind 127.0.0.1
# open http://127.0.0.1:8080/
```
