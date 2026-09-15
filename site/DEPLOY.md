# Deploying the Ginti site

Only `site/dist/` is deployed. The harness source is never part of the bundle:
`scripts/build-data.mjs` reads `results/`, `corpora/`, `configs/` and
`.tee/work/` at build time and emits `src/generated/data.json` plus the audio
the page plays.

## The two builds

| command | use | reads |
|---|---|---|
| `npm run build` | local | regenerates `data.json` and `public/audio/` from the repo, then builds |
| `npm run build:ci` | deploy | uses the committed `data.json` and `public/audio/`, builds only |

`.tee/work/` is scratch and is gitignored — it balloons once you run 40
utterances across nine conditions. The curated, content-hashed audio bundle in
`site/public/audio/` is committed instead, which is why CI does not run the data
step.

**Set Vercel's build command to `npm run build:ci`** (Root Directory: `site`).
Leaving it on `npm run build` will fail the deploy, by design: the data step
hard-errors when it cannot find audio that the results reference, rather than
shipping a listen section with silent gaps.

## Refreshing the data

On a machine that has `.tee/work/` (i.e. wherever you ran the harness):

```bash
cd site
npm run data        # rewrites src/generated/data.json + public/audio/
git add src/generated/data.json public/audio
git commit -m "Refresh site data from run <id>"
```

Environment overrides:

- `GINTI_LISTEN_LIMIT` (default 6) — utterances given audio players. Each costs
  roughly `conditions x 130 KB` of wav in the bundle.
- `GINTI_LOW_N` (default 10) — below this many observations a matrix cell shows
  its raw count with no rate and no success colour.
- `GINTI_ALLOW_MISSING_AUDIO=1` — build without audio. Development only.

Audio is copied as `.wav` and deliberately **not** transcoded to mp3 or opus:
re-encoding degraded audio through a second lossy codec would corrupt the exact
artefact the listen section exists to demonstrate.

## The deploy origin

Open Graph tags need absolute URLs, so `index.html` writes `%SITE_ORIGIN%` and
`vite.config.ts` substitutes it at build time, after Vite has finished
rewriting asset paths. Written as `/og-card.png` instead, `base: "./"` silently
turns it into `./og-card.png` in the built file, which some scrapers refuse to
resolve -- the source reads correctly and the deployed page is wrong.

Resolution order:

1. `SITE_ORIGIN` if set -- use this for a custom domain
2. `VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets and which **follows a
   project rename automatically**
3. the fallback in `vite.config.ts`

Not `VERCEL_URL`: that is the per-deployment host and changes every push.

**If you rename the Vercel project**, the tags should follow on the next
deploy with no code change. Confirm it in the build log, which prints
`site origin: ...`. If it still shows the old host, Vercel's system environment
variables are off for the project -- either re-enable them or set `SITE_ORIGIN`
in project settings.

`npm run check:meta` runs as part of the build and fails it if any social URL
is relative, still holds the token, points at a second origin, or names an
image that is not in `dist/`.

## The link preview card

`public/og-card.png` is the 1200x630 Open Graph image, rendered from
`card.html` -- a second Vite entry that reuses the page's own components,
tokens and fonts, so the card cannot drift from the site's design or show a
figure the run does not support.

```
npm run build && npm run card
```

It is committed rather than generated during deployment, because the build
machine has no browser. Re-run it whenever the results change: the card shows
the drop and the example value, and `scripts/card.mjs` fails if the rendered
figure no longer matches the `og:image:alt` text in `index.html`.

The generator also refuses to write a card whose content does not fit the
frame with at least 12px to spare. The frame is a fixed 630px with
`overflow: hidden`, so a card that is too tall renders perfectly and ships
silently cropped -- which is what happened on the first attempt.

Sizes are chosen for where previews actually render: Slack and WhatsApp show
the card around 360px wide, so everything on it is scaled for a ~3.3x
reduction and nothing is smaller than 27px.

## The access gate

`src/gateConfig.ts` holds everything the gate knows, which is no longer very
much. There are no credentials: the landing screen shows the project name, one
line of context and a single **Enter demo** button. Clicking it records the
entry and shows the page. `?key=sarvam` skips even the click — the parameter is
read on mount, the state is set, and the key is stripped from the address bar
before the page renders.

**This is a soft gate — a doorbell, not a lock, and now one anyone may ring.**
It stops a forwarded link opening straight onto the page. It stops nothing
else, and it never did: the old username and password shipped in the same
client bundle as the data they guarded, so anyone with the link and devtools
already had both. Removing them cost no security and saved every intended
visitor a trip to find the email.

Entry is remembered in `localStorage` (`ginti.gate`), so a refresh or a
reopened tab does not ask again.

### Who entered, and when

Each entry is logged with a timestamp, the referrer, and whether it came from
the button or the key parameter. The log lives in `localStorage` under
`ginti.entries`, capped at the last 50, and is readable from the console:

```js
__ginti.entries()
```

**That log stays in the visitor's browser and never reaches you.** The site is
static — no backend, no runtime requests — so there is nowhere for it to go.
Reporting entries centrally needs one of two things this deployment
deliberately does not have: a server endpoint to receive them, or a
third-party analytics script to send them to. Vercel's own Web Analytics is
the least invasive option if that changes, since it needs no code beyond
enabling it and reports visits without a cookie.

### The real gate: Vercel Deployment Protection

Password protection is enforced at the edge, before any of the bundle is served,
so the data is genuinely unreachable without it.

1. Vercel dashboard → the project → **Settings → Deployment Protection**
2. Under **Password Protection**, enable it and set a password
3. Choose the scope — **All Deployments** covers production as well as previews;
   **Preview Deployments only** leaves production public
4. Save. Visitors get Vercel's own password page before the site loads

Availability depends on your Vercel plan; Password Protection is a Pro/Enterprise
feature. The alternatives on the same settings page are Vercel Authentication
(any member of your Vercel team can view) and Protection Bypass for Automation
(a token so CI can still reach the deployment).

With Vercel protection on, the in-page gate is redundant. Leave it or remove it
— it is one click and it stops a link being opened casually if protection is
ever switched off.
