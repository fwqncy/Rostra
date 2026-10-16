# Rostra

**Staff rostering and shift-swap app for multi-site restaurants.**

Staff swap shifts from their phone, managers approve in one tap, and labour cost is shown live.
It was built to cut weekly rostering from about 3 hours to under 1.

**Stack:** C# · ASP.NET Core 8 (Minimal APIs) · Entity Framework Core 8 · SQL Server / Azure SQL · Azure App Service · Three.js · React Three Fiber · GSAP

The look is an overgrown forest at golden hour (dark greens, bark browns, burnt orange, condensed weathered lettering), with a low-poly cherry blossom tree on Home that grows the longer you use the app.

---

## Run it

Requires the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0). Nothing else is needed: in Development the app uses a local SQLite file (`rostra.dev.db`), so it runs without installing SQL Server.

```bash
dotnet run --project src/Rostra.Api
```

Open **http://localhost:5292**. The database is created and seeded on first start.

### Demo logins

Every account uses the password **`rostra-demo`**. Each company opens in its own default colour scheme, and the login page has one-click buttons for every account.

| Company | Default scheme | Manager | Staff |
| --- | --- | --- | --- |
| **Ember & Oak** (wood-fired grill, SE Queensland: Ipswich, Springfield, Toowong) | Overgrowth (the app default) | `sam@emberandoak.test` | `priya@emberandoak.test` |
| **Saltbush Kitchen** (native produce, WA: Fremantle, Perth CBD) | Company Brand (`#0F9D7A` teal) | `maya@saltbush.test` | `matilda@saltbush.test` |
| **Juniper & Co.** (wine bars, Melbourne: Fitzroy, Richmond, Southbank) | Burgundy & Navy | `alex@juniperco.test` | `elena@juniperco.test` |

The demo logins start with different amounts of time on the clock, so their trees are at different stages: Alex's is ancient, Sam's mature, Priya's just fruiting, and Matilda's still a sapling.

Ember & Oak's Ipswich roster recreates the concept shot: Aroha, Jordan, Priya, Liam and Mei, with a pending swap where *Priya asked Jordan to cover Wed 9–5*.

### Things to try

1. Sign in as **Sam (Manager)** and look at **Your Grove** on Home: drag to turn the tree, hover an apple to see its roster week.
2. Open **Schedule → next week** at Springfield. It's a **draft**: review the roster checks, then **Publish Week…** to notify everyone. Next week at Ipswich shows a roster check (Tama closes Saturday and opens Sunday with 8 hours' rest).
3. Go forward four weeks to an empty week and press **Copy Last Week**.
4. In **Settings**, try each colour scheme, or pick **Custom** and drag the colour wheel. The whole app recolours as you drag.
5. Press **⌘ K** (Ctrl K on Windows) to jump anywhere or run an action.
6. In a second browser, sign in as **Priya (Staff)**. Ask for an open shift on Home, send someone kudos, or ask for cover from **My Shifts**. Sam's bell and dashboard update instantly.
7. Check **Timesheets** for last week: fix a missing punch, approve, and **Export CSV** for payroll.

### Use real SQL Server locally (optional)

```bash
docker compose -f docker-compose.sqlserver.yml up -d
dotnet run --project src/Rostra.Api --launch-profile sqlserver
```

### Deploy to Azure

Uses the [Azure Developer CLI](https://aka.ms/azd). It provisions App Service (Linux, .NET 8), Azure SQL Database (Basic), Application Insights and Log Analytics from [infra/](infra/).

```bash
azd auth login
azd env new rostra-dev
azd env set AZURE_SQL_PASSWORD '<a strong password>'
azd up
```

### Look & feel

- **Colour schemes** (Settings → Appearance, saved to your account):
  - **Overgrowth** (default): forest green, bark brown and burnt orange.
  - **Burgundy & Navy**: deep navy with burgundy and brass.
  - **Company Brand**: the company's own colour on quiet greys.
  - **Custom**: any colour from a colour wheel. Surfaces tint toward its hue (OKLCH), and button text stays at 4.6:1 contrast or better.
- **Company default:** managers set what everyone sees until people pick their own.
- **Mode:** Dark (default), Light or System. **Motion:** Match my device, Reduced or Full.
- **Type:** headings are tall condensed capitals (Oswald) in weathered tan, after *The Last of Us* poster lettering. Big titles get an SVG "weathered" filter.
- **Texture:** a film-grain overlay and low-sun glows sit behind everything.
- **Sign-in:** a Three.js forest with fog, light shafts and drifting spores, coloured from the active scheme.
- **Art:** everything is generated in code (Three.js, SVG and CSS). The reference images aren't bundled.

### The Grove

Your low-poly cherry blossom tree on Home grows with the time you actively spend in Rostra. The app counts a minute only while the tab is visible and you've interacted in the last two minutes, and the server caps each count to the real time elapsed.

- **Growth:** `1 − e^(−hours/5)`, through Seedling → Sapling → Young Tree → Mature Tree → Ancient Tree. Each person's tree has its own shape (seeded from their id), and the trunk thickens as it ages.
- **Apples** appear once it's a Young Tree (~1.8 h):
  - **Managers:** one apple per site-week roster. **Red** = published, **green** = still a draft.
  - **Staff:** one apple per week they're rostered. **Red** = worked, **green** = coming up.
- **Fireflies** are kudos you've received in the last 30 days.
- **Petals** drift off the pink canopy, settle on the lawn, fade, and fall again. The fuller the tree, the more petals.
- **Look:** flat-shaded icosahedron puffs on a faceted, tapering trunk, on a round of sunlit lawn you can turn.
- **Scenery:** a clearing in low-poly woods. Pines and broadleaves frame it, with a few young cherries in the trees, a far tree line and hills fading into golden haze, and bushes, rocks and flowers on the meadow. It's one merged mesh (a single draw call) that sways in the breeze. The haze, fog and grass take their colours from your scheme.

### Features

| Area | What's there |
| --- | --- |
| Rostering | Week grid per site, click any cell to add a shift, an open-shifts row, copy last week, CSV export and print, live labour cost vs budget with weekend penalty rates |
| Publishing | Draft → Published per site-week. Staff only see published weeks; publishing (and later edits) notify the people affected |
| Compliance checks | Under 10 h rest between shifts, over 38 h a week, shifts over 10 h, no meal break past 5 h, 7 days straight, and rostering someone unavailable, on leave or untrained. Warnings, not blocks |
| Open shifts | Unfilled shifts anyone suitable can ask for; managers approve. Deactivating someone turns their future shifts into open shifts |
| Swaps | Ask a teammate to cover; eligibility checks (availability, leave, training, clashes); one-tap approve with cost impact |
| Time clock | Clock in/out from My Shifts, manual punches, live feed, late/over notes |
| Timesheets | Clocked vs rostered per person, fix punches, approve (locks the week), payroll CSV with award multipliers |
| Leave & availability | Leave types (annual, sick, personal, unpaid), approvals on the dashboard, available days per person |
| Team | Add, edit, deactivate and reactivate people; stations, rates, certifications; one-time temporary passwords |
| Communication | Announcements with read receipts and "Got It", the notification bell, kudos between teammates |
| Calendar sync | A personal webcal/iCal feed of published shifts for Google, Outlook or Apple Calendar (resettable link) |
| Navigation | Command palette (⌘ K / Ctrl K), which is also the phone Menu |
| Dashboard | Tasks, who's in, live time clock, live wage tracker, weekly planner with revenue upload |

### Home

Everyone lands on **Home** (`/app/home`). The header shows the rostra logo with the company name beneath it. Below that:

- **Next Shift**: date, time, station and site, with its status (Confirmed, Clocked in or Swap pending) and a link to all shifts.
- **This week's pay**: the number of shifts, plus hours and estimated pay split into *Pending* (not yet worked) and *Completed* (finished, using clocked hours), with a progress ring showing completed pay out of the week's total.
- **Notifications**: pending swaps that involve you (or, for managers, swaps waiting for approval). Shows "Nothing yet" when there are none.
- **Your Grove**, **Open Shifts** (ask for one in a tap), **Announcements** and **Kudos**.
- **Availability & Leave**: choose the days you can work, and request leave by type. Approved leave and unavailable days stop you being rostered or offered as cover. Managers' own leave is approved immediately; staff requests go to the dashboard for approval.

Managers are on the roster too: each works Monday, Thursday and Saturday, 9–5, at their home site, appears as the top row of that site's schedule, counts towards labour cost, and can be offered as swap cover.

Staff no longer see the full roster: the Schedule page and `/schedule` API are manager-only. Staff use Home, My Shifts and Swaps.

### The dashboard

Managers get `/app/dashboard`, which has five widgets. Each one can be hidden (eye icon), and each one's filters live in the URL.

| Widget | What it shows |
| --- | --- |
| **What Should I Work On?** | Time-off requests to approve inline, rosters still in draft, open shifts needing someone, swaps waiting, people late to clock in, next week's sites over budget or still unrostered, and certifications (RSA, Food Safety) expiring within 30 days |
| **Who's In Today?** | A timeline per site: coming up (late flagged), at work, finished with hours worked, didn't clock in, and on leave |
| **Live Time Clock Feed** | Every punch as it happens, with search, an In/Out filter, a site filter, late/over notes, and manual punches |
| **Live Wage Tracker** | Staff on shift vs rostered across the day (step chart with hover, keyboard and table view), plus wage cost and worked hours so far against the roster. Filters for site, station and day; can go full screen |
| **Weekly Planner** | Roster vs actual labour, variance, revenue vs forecast, and wage % of revenue (or sales per labour hour) for any week, with CSV revenue upload |

**Demo crew.** While `Demo:Enabled` is on, a background service clocks the seeded staff in and out around their shifts (a few minutes early or late, with the odd no-show), so the feed and tracker move on their own. The six demo logins are left alone from today on, so you can use **Clock In** in *My Shifts* yourself.

**Time zones.** Each company has an IANA time zone (Ember & Oak is Brisbane, Saltbush is Perth, Juniper is Melbourne). "Now", lateness and "day so far" are worked out in the venue's zone, so the results are correct on a UTC server like Azure App Service.

---

## How it's built

```
src/Rostra.Api/
├── Program.cs                  auth (cookies + "Staff"/"Manager" policies), rate limiting, CSP, DB provider switch
├── Domain/                     Company, Site, Staff (CanWork rules), Shift, RosterWeek, Compliance, Labour, and more
├── Data/RostraDb.cs            EF Core context; tenant isolation via global query filters
├── Data/SeedData.cs            3 demo companies, 8 sites, ~60 staff; rolls rosters forward weekly
├── Shifts/SwapEndpoints.cs     POST /shifts/{id}/swap  (the endpoint from the concept shot)
├── Shifts/RosterEndpoints.cs   schedule (+ compliance checks), shift CRUD, cover options, approve/decline, SSE /events
├── Shifts/PublishingEndpoints.cs  publish/unpublish, copy last week, open shifts and claims
├── Home/HomeEndpoints.cs       Home: next shift, weekly pay, availability, leave requests
├── Features/                   notifications, announcements, kudos, team, timesheets, appearance, calendar feed, the Grove
├── Dashboard/                  tasks, who's in, clock feed & punches, wage tracker, weekly planner, revenue upload
├── Data/DemoCrew.cs            simulated time-clock punches for the demo
├── Auth/                       sign-in, demo accounts, claims → tenant
├── Infrastructure/             EventHub (company or per-person push), Inbox (bell notifications), Idempotency-Key middleware
└── wwwroot/                    no-build SPA
    ├── js/core.js              templating, formatting, API, appearance (schemes/mode/motion), dialogs, actions
    ├── js/app.js               router, shell, sign-in, schedule, swaps, my shifts
    ├── js/home.js · dashboard.js · settings.js · team.js · timesheets.js
    ├── js/notifications.js · palette.js · motion.js (GSAP) · growth.js
    ├── js/scenes/grove.js      the cherry tree, built from client/grove (don't edit by hand), loaded only on Home
    ├── js/scenes/forest.js     the sign-in forest (Three.js)
    └── vendor/                 three.js r169 (MIT) and GSAP 3.12.5 (standard no-charge licence), served locally

client/grove/                   source for the Grove: React Three Fiber 8 + React 18, bundled by esbuild
├── src/index.jsx               mountGrove(canvas, …) → { growTo, update, destroy }, the API Home calls
└── src/Grove.jsx               trunk, canopy, apples, petals, fireflies, scenery, drag-to-turn
```

- **The swap endpoint** in `Shifts/SwapEndpoints.cs` is the code from the concept image. The only change is one added line, `.AddEndpointFilter<OwnShiftFilter>()`, so staff can only offer up their own shifts.
- **`Staff.CanWork(shift)`** checks availability days, station training and clashes with the cover's other shifts. `WhyCannotWork` returns the reason shown in the cover picker, e.g. "Already working 4–11".
- **Multi-tenancy:** every `Site`, `Staff` and `Shift` query is filtered to the signed-in company by an EF global query filter. Another company's IDs return 404.
- **Live updates:** `INotifier.ManagerAsync` publishes to an in-process `EventHub`, which streams to open browsers as Server-Sent Events. To run on more than one App Service instance, swap it for Azure SignalR or Web PubSub.
- **Pay rates and budgets are manager-only.** They're stripped from responses for staff.
- **The Grove bundle** is committed, so `dotnet run` never needs Node. To change the tree, edit `client/grove/src` and rebuild (Node 16+):
  ```bash
  npm --prefix client/grove install && npm --prefix client/grove run build
  ```
  The bundle imports three.js from `/vendor` and `growth.js` from the app rather than including them, so the page loads one copy of each.
- **Colour schemes:** each scheme defines every token for dark and light. For Company Brand and Custom, the client derives `--accent-solid` (darkened until white text reaches 4.6:1) and `--accent-bright` (adjusted to be readable as text in the current mode). `theme-init.js` applies the saved scheme before first paint, so nothing flashes.

### Vercel Web Interface Guidelines

| Guideline | Where |
| --- | --- |
| Keyboard everywhere, `:focus-visible` rings, focus management | native `<dialog>` with focus return; arrow-key navigation across roster cells; skip link |
| Hit targets ≥24 px (≥44 px on mobile), inputs ≥16 px on mobile, zoom never disabled | `@media (max-width: 860px)` sizing; viewport meta has no `maximum-scale` |
| URL as state, deep links, Back/Forward restores scroll | `/app/schedule?site=…&week=…`; `history.state.y` |
| Optimistic updates with rollback and Undo | approve/decline/delete; Undo on delete and decline |
| Loading buttons keep their label; minimum spinner/skeleton time | `withLoading` (120 ms delay, 420 ms minimum); `withSkeleton` (150 ms / 400 ms) |
| Submit stays enabled, errors next to fields, first error focused, Idempotency-Key | `showErrors`; `IdempotencyMiddleware` |
| Ellipsis for follow-up input, curly quotes, Title Case buttons, tabular numbers | "Add Shift…", "Ask for Cover…"; `tabular-nums` throughout |
| Locale-aware dates, times and currency from language settings | `Intl.*` with `navigator.languages`; 12/24-hour follows locale |
| Status never conveyed by colour alone | station labels, "Swap → Jordan", "Over budget by $312" |
| `prefers-reduced-motion`, no `transition: all`, compositor-only animation | `app.css` |
| `color-scheme`, `theme-color` matching the background, explicit `<select>` colours | theme tokens; `applyTheme()` |
| Layered shadows, semi-transparent borders, nested radii | design tokens in `app.css` |
| Safe areas, `overscroll-behavior`, `touch-action: manipulation` | mobile bar, tab bar, dialogs |
| `translate="no"` on brand names & emails; brand assets on logo right-click | sidebar & sign-in |
| Unsaved-changes warning | shift editor (`beforeunload` + confirm on close); unsaved custom colours revert when you leave Settings |
| Locale-aware keyboard shortcuts | ⌘ K / Ctrl K shown per platform, matched on the typed key so non-QWERTY layouts work; hidden on touch screens |
| Animations are input-driven and interruptible; reduced motion respected | GSAP page reveals and the tree's growth are skipped under Reduced motion; the 3D scenes render a single still frame |
| Gestures have alternatives | dragging the tree is optional; every apple is also listed under "Show All Apples" |
| Accessible charts and colour | colour-blind-validated chart series per scheme; apples and stations always carry text labels |

### Notes

- The schema is created with `EnsureCreated()` to keep the demo simple. Each local SQLite database records its schema version (`PRAGMA user_version`), so one from an older version of Rostra is rebuilt automatically. Before taking this to production, switch to EF Core migrations.
- Chart colours were checked with a colour-vision-deficiency validator. The rostered line (Okabe–Ito blue `#0072B2`) stays distinguishable next to every company accent in light and dark mode. It's also dashed and labelled, so colour is never the only cue.
- Demo data rolls forward: on each start, any site with an empty week (last week through three weeks out) is filled from each person's usual pattern. Weeks you've edited are left alone. Delete `src/Rostra.Api/rostra.dev.db` to reset.
