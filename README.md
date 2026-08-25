# Steinbach — haukesteinbach.de

Studio site for Hauke Steinbach: mixing, mastering and production in Hamburg,
plus the plugins and tools that come out of the studio.

Plain HTML, CSS and JavaScript with no build step, and an Express backend for
the file handoff. Both are bundled into one Docker image.

## Pages

### Services and work
| | |
|---|---|
| `index.html` | landing page |
| `mixing.html` · `mastering.html` | A/B comparisons, built by `portfolio.js` |
| `productions.html` | released work |
| `recordings.html` | the studio itself |

### Products
| | |
|---|---|
| `steinbach-eq.html` | EQ, saturator, transient shaper, clipper — AU/VST3 |
| `steinbach-head-tracker.html` | head tracking for binaural mixing |
| `reclight.html` | studio status light, pre-order |
| `orgel.html` | sampled Röver pipe organ, with a playable console |
| `ir-maker.html` | impulse response generator, runs in the browser |
| `scores-archive.html` | non-exclusive score archive |

### File handoff
| | |
|---|---|
| `upload.html` | clients send their files in |
| `admin.html` | the studio's project list — password protected |
| `/d/<token>` | rendered per delivery: downloads and the revision form |

### Internal
| | |
|---|---|
| `werbung.html` | ad campaigns, shared with Steinbach Instruments |
| `uistudio.html` | the UI Studio — plug-in interfaces, edited by two people at once |

Both sign in with a team account at Supabase, not with the admin password.
That separation is on purpose: the admin password opens the customer projects,
and the designer has no business there.

Set up on the server with `./setup.sh` — one command, it asks for what it
needs and deploys at the end. If someone else operates the server, run
`./prepare.sh` on your own machine first; it writes a single file to hand over.
`backend/README.md` describes the whole flow.

## Structure

```
index.html, mixing.html, …      one file per page, no templating
admin.html                      project list (fetches /api/v1/admin)
assets/
  css/steinbach.css             the entire stylesheet, in numbered sections
  fonts/                        Archivo Black, Poppins, JetBrains Mono
  js/
    steinbach-ui.js             navigation, sticky bar, tick rail — every page
    portfolio.js                builds the cards on mixing/mastering/productions
    audio-comparison.js         the A/B player
    scores-archive.js           waveform player for the archive
    ir-maker.js                 the IR tool
    orgel.js                    the organ sample engine
    admin.js                    the project list
    cookie-consent.js           consent gate for YouTube embeds
  audio/, images/, Video/       media
backend/
  src/                          Express: routes, storage, projects, mail
  scripts/                      setup helpers and the flow test
tools/uistudio/                 source of the UI Studio, published separately
setup.sh, prepare.sh            configure and deploy
Dockerfile                      frontend and backend in one image
```

## Running it locally

### Pages only

```bash
python3 -m http.server 8391
```

Everything renders. The API routes answer 404, so the upload page, the admin
area and delivery links do not work — for those you need the backend.

### With the backend

```bash
cd backend && npm install && npm run dev
```

Without R2 credentials the file routes return 503 and say why. To exercise the
whole handoff without a Cloudflare account:

```bash
cd backend && npm run dev-seeded     # :8392, two projects already in it
cd backend && npm run flow-test      # walks the whole flow, 29 checks
```

Both run against an S3 server held in memory. `dev-seeded` signs in with
`dev-password-1234`.

## The A/B comparison

Both versions are fetched and decoded up front, started on the same sample,
and left running in parallel. Switching only crossfades two gain nodes over
20 ms — nothing reloads and nothing drifts. Touch devices fall back to two
`<audio>` elements kept in step by a timer.

All sixteen files sit at −18 LUFS so the comparison is decided by the sound
rather than by level. Re-exporting any of them means matching that, and
keeping true peak under −1 dBTP.

## The UI Studio

`uistudio.html` is only the door. The tool itself is one large HTML file that
lives in private Supabase storage and is delivered by the `cockpit-content`
edge function to accounts on the `UISTUDIO_AUDIO_ALLOWED` list. A deploy of
this site does not change it — publishing a new build is:

```bash
./tools-publish-uistudio.sh
```

The source is `tools/uistudio/uistudio-audio.html`, kept in this repository so
there is a history and a diff. It is deliberately outside the part that gets
copied into the image, so it never becomes reachable without signing in.

Rolling the whole thing out the first time — migration, access list, edge
functions, publish, deploy — is one guided script that explains each step and
asks before it changes anything:

```bash
./tools/uistudio-ausrollen.command
```

Projects live in the team store, in a scope of their own (`_uistudio-audio/`,
separate from the Kontakt instruments on the other site). Two people can work
on the same project at the same time: `assets/js/uistudio-live.js` speaks the
Supabase Realtime protocol directly, cursors and selections show up as
coloured markers, and edits travel as per-field differences so two people on
the same element but different fields do not overwrite each other.

Graphics are the exception — embedded as base64, they are larger than a
Realtime message may be, so adding one prompts everybody else to reload from
the team store instead of travelling live.

Undo is personal: it merges its snapshot back in while leaving the fields the
other person touched alone. Alone in a project it behaves exactly as before.

```bash
node tools/uistudio/live-sync-test.mjs     # 16 checks on the sync and undo rules
```

## The stylesheet

One file, `assets/css/steinbach.css`, in numbered sections with a table of
contents at the top. Page-specific rules go into a section there rather than
into a `<style>` block, so nothing is defined twice.

The design: pure black ground, Archivo Black at poster scale, one flat accent
(`--accent`, `#E94560`) used as a solid block, hard-cut greyscale photography,
an amplitude tick rail down the right edge. Colours come from tokens under
`:root`; the accent and `--on-accent` always change together.

Fonts are self-hosted under `assets/fonts/`. Loading them from Google would
send every visitor's IP address to Google on every page view.

## Deployment

Pushing to `main` builds a multi-arch image and publishes it to
`ghcr.io/haukesteinbach/haukesteinbach`, tagged `latest` and with the commit
SHA. The server pins a SHA in `.env` and pulls it:

```bash
./setup.sh            # configures what is missing, then deploys
```

Secrets live in `backend/.env.runtime` on the server and never in this
repository. `backend/.env.example` lists what goes there.

`GET /health` reports whether storage and the admin password are actually
configured, not just that the process is alive.

## Contact forms

The contact forms post to Formspree (`https://formspree.io/f/xgopedgb`) over
`fetch`, so they work from the static preview as well as from the container.
This is separate from the file handoff, which sends its own mail over SMTP.

## Troubleshooting

**API routes answer 404 locally** — `python3 -m http.server` only serves files.
Start the backend, or use `npm run dev-seeded`.

**File routes answer 503** — no bucket configured. `GET /health` names the
reason. Run `./setup.sh`.

**The admin area will not open** — `"admin":"not_configured"` in `/health`
means `ADMIN_PASSWORD_HASH` or `SESSION_SECRET` is missing on the server.

**A delivery was created but no mail went out** — no SMTP configured. The admin
area shows the link to send by hand. Add SMTP with `./setup.sh`.

**Audio does not play** — check the paths in `assets/js/portfolio.js` against
`assets/audio/`, and serve over http rather than `file://`.

**Styling looks stale** — the stylesheet is served without a cache-busting
name; a hard reload picks up changes.

## License

All rights reserved. Audio, images and text are the property of
Hauke Steinbach.
