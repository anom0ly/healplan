# Healplan

Enter your healing team and a boss, and see when guilds with the same healing comp used their healing cooldowns. Timings come from Warcraft Logs and are weighted toward **guild first kills** and **recent kills**, so lax farm kills don't drown out the timings that actually mattered.

Mythic and Heroic are both supported.

**Live site:** <https://healplan-production.up.railway.app/>

## How it works

1. **Nightly crawl** (`npm run crawl`) walks two Warcraft Logs rankings for each boss: **progress** (each guild's first kill, the same data as the Progress tab on the site) and then **speed** (the fastest recent kills). For every new kill it:
   - for speed-ranked kills, works out whether it was the guild's 1st, 2nd, 3rd or later kill by scanning the guild's public reports once (cached in `guild_kill_history`)
   - stores the healer lineup, phase start times, and casts of every cooldown in [`src/data/cooldowns.ts`](src/data/cooldowns.ts)
2. **Planning** ([`src/lib/engine`](src/lib/engine)) runs per request from the database, never against the live API:
   - **Weighting:** first kill 1.0, kills 2 to 3 get 0.6, farm kills 0.25. Recency halves every 14 days. Kills far from the median length are halved. Comp similarity (multiset Jaccard) multiplies in, and kills under 0.6 are dropped.
   - **Clustering:** casts are measured from the start of their phase, grouped when within 8 seconds of each other, and kept when at least 40% of the weighted kills agree.
   - **Export:** MRT-style timer lines such as `{time:0:10,p2} Leafy Tranquility`.

## Local development

```sh
cp .env.example .env.local   # fill in WCL_CLIENT_ID, WCL_CLIENT_SECRET, DATABASE_URL
npm install
npm run migrate
npm run crawl -- --zone <zoneId> --difficulty mythic,heroic --pages 1
npm run dev                  # http://localhost:3000
```

The zone id is the number in the raid's Warcraft Logs URL (`warcraftlogs.com/zone/rankings/<zoneId>`). Every boss in the zone is crawled unless you pass `--encounter <id>,<id>`. Get API credentials at <https://www.warcraftlogs.com/api/clients>.

```sh
npm test                                              # unit tests
TEST_DATABASE_URL=postgres://... npm test             # also runs the database round-trip tests (truncates tables)
npm run lint                                          # type check
```

## Deploying on Railway

The app runs as two services in one Railway project, sharing one Postgres database.

1. **Create the project.** In Railway, choose **New Project → Deploy from GitHub repo** and pick `anom0ly/healplan`. Railway detects Next.js and uses `npm run build` and `npm start`.
2. **Add Postgres.** In the project, choose **+ New → Database → PostgreSQL**.
3. **Set variables on the web service** (Variables tab):
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (a reference to the database service)
   - `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET` from your Warcraft Logs API client
4. **Expose the site.** In the web service, open **Settings → Networking → Generate Domain**. Set the healthcheck path to `/api/health`.
5. **Add the nightly crawler.** Choose **+ New → GitHub Repo**, pick `anom0ly/healplan` again, and name the service `crawler`. In its settings:
   - **Custom Start Command:** `npm run crawl -- --zone <zoneId> --difficulty mythic,heroic --pages 2`. Each run first walks every boss's **progress** rankings (each guild's first kill, in the order guilds got them), carrying on from the page the last run reached until it has them all, once per region (US, EU, KR, TW, CN) because the API serves at most 20 pages (2,000 kills) of any ranking, then the first `--pages` pages of **speed** rankings for recent kills.
   - **Cron Schedule:** `0 10 * * *` (10:00 UTC daily, after NA raid nights end)
   - The same three variables as the web service
   - The crawl exits when done, which Railway's cron jobs require. Both services create the database tables on start if they're missing.
6. **Seed data.** Run the crawler once by hand from its service page. The site shows "No matching kills yet" until it has run.

When a new raid tier opens, change `--zone` in the crawler's start command to the new raid's zone id.

The free Warcraft Logs API tier allows 3,600 points an hour. The crawler checks its remaining points before every rankings page and every kill, ends the run with 300 left (`--reserve`), and logs the points it used. The next run continues where it left off, because kills already saved are skipped and the progress crawl remembers its page. Because each run stops at the hourly limit, an hourly schedule (`0 * * * *`) is safe and fills in a new raid much faster than a daily one.

## Status

- [x] Engine: weighting, comp matching, phase-relative clustering, note export
- [x] Crawler and Postgres schema
- [x] Basic page and `/api/plan` JSON endpoint
- [ ] Fix the 5 cooldown spell ids that don't appear in crawled kills (`/api/cooldowns` shows counts; `npm run spells -- --encounter <id>` lists what each healer spec actually casts, and needs the same variables as the crawler)
- [ ] Check the crawler against the live API
- [x] Boss picker (filled from crawled bosses, with kill counts)
- [ ] Spec picker polish, heatmap timeline, damage overlay
- [ ] Your pulls compared with the plan, auto-assign, share links

## License

[AGPL-3.0](LICENSE). You can use, change and host this code, but if you run a modified version as a public website you must publish your changes under the same license.
