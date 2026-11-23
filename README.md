# win2094.github.io

Personal game portfolio for **HSU Tsui** (Will Hsu / win2094).

## Site map

| Path | Page |
|------|------|
| `/` | Homepage (game list) |
| `/games/happy-polygon/` | Happy Polygon detail |
| `/games/soso-sleep/` | SoSo Sleep / SoSoSheep detail |
| `/games/fly/` | FLY ACE detail (links to playable build) |
| `/fly/` | Playable FLY ACE game (do not break) |
| `/app-ads.txt` | AdSense / ads.txt |

## GitHub Pages

This is a **user site** (`win2094.github.io`). Pages is already enabled on the repo (`has_pages: true`).

1. Repo **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **`main`** / folder **`/` (root)**
4. Site URL: <https://win2094.github.io/>

`.nojekyll` is present so GitHub does not process the site with Jekyll.

**Important:** The live URL always serves **`main`**. The black-and-white pixel portfolio lives on PR branch `cursor/game-portfolio-site-bb47` until that PR is merged. Opening https://win2094.github.io/ before merge will still show the old plain-text page.

## Design

Black-and-white **pixel** UI (Press Start 2P / DotGothic16), bilingual EN / 繁中 toggle.

## Local preview

```bash
python3 -m http.server 8080 --bind 127.0.0.1
# open http://127.0.0.1:8080/
```
