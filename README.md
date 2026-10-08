# Rostra

**Staff rostering and shift-swap app for multi-site restaurants.**

Staff swap shifts from their phone, managers approve in one tap, and labour cost is shown live.
It was built to cut weekly rostering from about 3 hours to under 1.

**Stack:** C# · ASP.NET Core 8 (Minimal APIs) · Entity Framework Core 8 · SQL Server / Azure SQL · Azure App Service

---

## Run it

Requires the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0). Nothing else is needed: in Development the app uses a local SQLite file (`rostra.dev.db`), so it runs without installing SQL Server.

```bash
dotnet run --project src/Rostra.Api
```

Open **http://localhost:5292**. The database is created and seeded on first start.

### Demo logins

Every account uses the password **`rostra-demo`**. Each company has its own brand accent, and the whole UI switches to it when you sign in. The login page also has one-click buttons for every account.

| Company | Accent | Manager | Staff |
| --- | --- | --- | --- |
| **Ember & Oak** (wood-fired grill, SE Queensland: Ipswich, Springfield, Toowong) | `#E8590C` orange | `sam@emberandoak.test` | `priya@emberandoak.test` |
| **Saltbush Kitchen** (native produce, WA: Fremantle, Perth CBD) | `#0F9D7A` green | `maya@saltbush.test` | `matilda@saltbush.test` |
| **Juniper & Co.** (wine bars, Melbourne: Fitzroy, Richmond, Southbank) | `#7C5CFF` violet | `alex@juniperco.test` | `elena@juniperco.test` |

Ember & Oak's Ipswich roster recreates the concept shot: Aroha, Jordan, Priya, Liam and Mei, with a pending swap where *Priya asked Jordan to cover Wed 9–5*.

### Things to try

1. Sign in as **Sam (Manager)**. The app turns orange. Hit **Approve** on the swap bar and watch labour cost change.
2. In a second browser (or a private window), sign in as **Priya (Staff)**. Open **My Shifts → Ask for Cover…** and pick a teammate. Sam's dashboard shows the request instantly over Server-Sent Events.
3. Use the **Theme** dropdown (System / Light / Dark), in the sidebar or at the top of the sign-in page. It's remembered per device.
4. Click an empty cell to add a shift. Cost and hours preview as you type, overlaps are rejected, and weekend penalty rates (Sat ×1.25, Sun ×1.5) apply.

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

---

## How it's built

```
src/Rostra.Api/
├── Program.cs                  auth (cookies + "Staff"/"Manager" policies), rate limiting, CSP, DB provider switch
├── Domain/                     Company, Site, Staff (CanWork rules), Shift, Week helpers
├── Data/RostraDb.cs            EF Core context; tenant isolation via global query filters
├── Data/SeedData.cs            3 demo companies, 8 sites, ~60 staff; rolls rosters forward weekly
├── Shifts/SwapEndpoints.cs     POST /shifts/{id}/swap  (the endpoint from the concept shot)
├── Shifts/RosterEndpoints.cs   schedule, shift CRUD, cover options, approve/decline, SSE /events
├── Auth/                       sign-in, demo accounts, claims → tenant
├── Infrastructure/             EventHub + INotifier (live push), Idempotency-Key middleware
└── wwwroot/                    no-build SPA: index.html, css/app.css, js/app.js
```

- **The swap endpoint** in `Shifts/SwapEndpoints.cs` is the code from the concept image. The only change is one added line, `.AddEndpointFilter<OwnShiftFilter>()`, so staff can only offer up their own shifts.
- **`Staff.CanWork(shift)`** checks availability days, station training and clashes with the cover's other shifts. `WhyCannotWork` returns the reason shown in the cover picker, e.g. "Already working 4–11".
- **Multi-tenancy:** every `Site`, `Staff` and `Shift` query is filtered to the signed-in company by an EF global query filter. Another company's IDs return 404.
- **Live updates:** `INotifier.ManagerAsync` publishes to an in-process `EventHub`, which streams to open browsers as Server-Sent Events. To run on more than one App Service instance, swap it for Azure SignalR or Web PubSub.
- **Pay rates and budgets are manager-only.** They're stripped from responses for staff.
- **Company accents:** the brand hex is stored per company. The client derives `--accent-solid` (darkened until white text reaches 4.6:1) and `--accent-bright` (lightened for dark surfaces). All accent tints come from those via `color-mix()`.

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
| Unsaved-changes warning | shift editor (`beforeunload` + confirm on close) |

### Notes

- The schema is created with `EnsureCreated()` to keep the demo simple. Before taking this to production, switch to EF Core migrations.
- Demo data rolls forward: on each start, any site with an empty week (last week through three weeks out) is filled from each person's usual pattern. Weeks you've edited are left alone. Delete `src/Rostra.Api/rostra.dev.db` to reset.
