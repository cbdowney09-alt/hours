# Hours standalone setup

Hours now runs on your own free setup: the app lives on GitHub Pages, and a Cloudflare Worker handles the AI (chat and reading photos of notes) and saves your data. About 20 minutes, one time.

## What's in this repo

- `app/` holds the app: `index.html`, `manifest.json`, and two icons. These go on GitHub Pages.
- `worker/worker.js` is the backend. It goes in a Cloudflare Worker.
- `worker/wrangler.toml` is only needed if you deploy with the command line instead of the dashboard.
- `.github/workflows/pages.yml` publishes `app/` to GitHub Pages automatically.

## Part 1: Cloudflare Worker

1. Go to dash.cloudflare.com. Under **Storage & Databases → KV**, create a namespace called `hours-data`.
2. Under **Workers & Pages**, click **Create**, choose **Start with Hello World**, name it `hours`, and deploy it.
3. Click **Edit code**, delete everything, paste in all of `worker/worker.js`, and click **Deploy**.
4. Open the Worker's **Settings → Bindings** and add two bindings:
   - **Workers AI**, variable name `AI`
   - **KV namespace**, variable name `KV`, and pick `hours-data`
5. In **Settings → Variables and Secrets**, add:
   - `APP_PASSWORD` as a **Secret**. Make up a password; the app asks for it once per device.
   - `ALLOWED_ORIGIN` as **Text**: `https://YOUR-GITHUB-NAME.github.io` (no trailing slash, no repo name).
6. Copy the Worker's address, something like `https://hours.yourname.workers.dev`.

## Part 2: GitHub Pages

A workflow in the repo publishes `app/` for you. It needs Pages switched on once:

1. Go to **Settings → Pages** and set the source to **GitHub Actions**. Not "Deploy from a branch" — the app lives in `app/`, and the workflow handles it.
2. Open the **Actions** tab, pick *Deploy app to Pages*, and click **Run workflow** on the `main` branch. It takes under a minute.
3. Your app is at `https://YOUR-GITHUB-NAME.github.io/hours/`.

From then on, any push that touches `app/` republishes the site on its own.

If the run fails with a permissions error, check **Settings → Actions → General → Workflow permissions** and make sure it is set to **Read and write permissions**.

The repo can be public. It contains no passwords or keys; your data stays in Cloudflare behind your password.

## Part 3: On your iPhone

1. Open your GitHub Pages address in Safari.
2. Enter the Worker address and your password, then tap **Connect**.
3. Tap **Share → Add to Home Screen**.

To change the connection later, tap the small status line under "Hours."

## Optional: better handwriting reading

The free Cloudflare model reads printed text and neat handwriting well, but messy handwriting can come back with `[unclear]` spots. For much better reading, add a Claude API key:

1. Get a key at console.anthropic.com (prepaid, usually $1–3 a month for personal use).
2. Add it to the Worker as a **Secret** named `ANTHROPIC_API_KEY`.

The Worker switches to Claude automatically. Remove the secret to switch back to free.

## If something goes wrong

- **"Can't reach that address"**: check the Worker URL, and make sure `ALLOWED_ORIGIN` exactly matches your GitHub Pages address.
- **"Wrong password"**: the password must match `APP_PASSWORD` exactly.
- **An error ending in `[rate_limited]`**: you've used the day's free AI allowance. It resets at midnight UTC.
- **An error ending in `[ai_error]`**: try a clearer photo or fewer photos at once. Up to 4 photos per scan.

## Good to know

- Events and notes from the claude.ai version don't carry over automatically.
- Reminders still only fire while the app is open. Background notifications are the next upgrade.
