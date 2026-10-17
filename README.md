# Healplan

Enter your healing team and a boss, and see when guilds with the same healing comp used their healing cooldowns. Timings come from Warcraft Logs and are weighted toward **guild first kills** and **recent kills**, so lax farm kills don't drown out the timings that actually mattered.

Mythic and Heroic are both supported.

**Live site:** <https://healplan-production.up.railway.app/>

## How it works

1. **Nightly crawl** (`npm run crawl`) walks Warcraft Logs speed rankings for each boss. For every new kill it:
   - works out whether it was the guild's 1st, 2nd, 3rd or later kill by scanning the guild's public reports once (cached in `guild_kill_history`)
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
   - **Custom Start Command:** `npm run crawl -- --zone <zoneId> --difficulty mythic,heroic --pages 2`
   - **Cron Schedule:** `0 10 * * *` (10:00 UTC daily, after NA raid nights end)
   - The same three variables as the web service
   - The crawl creates the tables on its first run and exits when done, which Railway's cron jobs require.
6. **Seed data.** Run the crawler once by hand from its service page. The site shows "No matching kills yet" until it has run.

When a new raid tier opens, change `--zone` in the crawler's start command to the new raid's zone id.

The free Warcraft Logs API tier allows 3,600 points an hour. The crawler checks its remaining points before every kill and stops with 300 left (`--reserve`). The next night's run continues where it left off, because kills already saved are skipped.

## Status

- [x] Engine: weighting, comp matching, phase-relative clustering, note export
- [x] Crawler and Postgres schema
- [x] Basic page and `/api/plan` JSON endpoint
- [ ] Check cooldown spell ids against current-tier logs (every entry is `verified: false`)
- [ ] Check the crawler against the live API
- [ ] Boss and spec pickers, heatmap timeline, damage overlay
- [ ] Your pulls compared with the plan, auto-assign, share links

## License

[AGPL-3.0](LICENSE). You can use, change and host this code, but if you run a modified version as a public website you must publish your changes under the same license.
