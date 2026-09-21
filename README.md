# Hours

A small personal planner that runs entirely on your own free infrastructure: a
single-page app on GitHub Pages, and a Cloudflare Worker that handles the AI and
stores your data.

Four views — **Chat**, **Calendar**, **Week**, and **Notes**. You can talk to it
in plain language, and photograph handwritten notes to have them read and turned
into events.

## Layout

| Path | What it is |
| --- | --- |
| `app/` | The whole front end: `index.html`, `manifest.json`, and two icons. Published to GitHub Pages. |
| `worker/worker.js` | The backend. Runs as a Cloudflare Worker. |
| `worker/wrangler.toml` | Only needed if you deploy the Worker from the command line. |
| `.github/workflows/pages.yml` | Publishes `app/` whenever it changes on `main`. |

## Setup

See **[SETUP.md](SETUP.md)** — roughly 20 minutes, one time.

The short version: create a Cloudflare Worker with a KV namespace and the
Workers AI binding, set a password on it, then point the app at the Worker's
address the first time you open it.

## Privacy and cost

This repo holds no passwords or keys. Your events and notes live in your own
Cloudflare KV namespace, behind a password you choose; the app keeps the Worker
address and password in `localStorage` on each device you set it up on.

Cloudflare's free tier covers normal personal use. Adding an Anthropic API key
to the Worker is optional and improves handwriting recognition — see the end of
SETUP.md.
