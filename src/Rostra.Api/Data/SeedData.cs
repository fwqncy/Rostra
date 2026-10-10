using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Rostra.Api.Domain;

namespace Rostra.Api.Data;

/// <summary>
/// Three demo restaurant groups, each with its own brand accent, so sign-in visibly re-themes the app.
/// </summary>
public static class SeedData
{
    public const string DemoPassword = "rostra-demo";

    record Crew(string Name, Station Stations, string Pattern);
    record SiteSeed(string Name, decimal Budget, Crew[] Crew);
    record CompanySeed(
        string Name, string Slug, string Domain, string Accent, string TimeZone, string Tagline,
        string Manager, string ManagerTitle, string? PreferredCover, SiteSeed[] Sites);

    public record DemoAccount(
        string Company, string Accent, string Tagline,
        string ManagerName, string ManagerEmail, string StaffName, string StaffEmail);

    /// <summary>Managers work the floor too: Monday, Thursday and Saturday, 9–5.</summary>
    const string ManagerPattern = "D..D.D.";

    // Template codes for a usual week, Mon–Sun. '.' = day off, 'x' = unavailable.
    static readonly string[] Patterns = ["DD.DD..", ".DDD.D.", "OOO.O..", "..CCCC.", "...CCCC", "EE...EE", ".x..MMM", "M.MM.M."];
    static readonly Station[] Skills =
    [
        Station.Floor, Station.Floor | Station.Bar, Station.Kitchen, Station.Kitchen | Station.Floor,
        Station.Bar, Station.Barista | Station.Floor, Station.Floor, Station.Kitchen,
    ];
    static readonly decimal[] Rates = [27.40m, 28.90m, 31.20m, 29.75m, 33.10m, 26.80m, 30.40m, 35.60m];

    static Crew[] Rotate(int offset, params string[] names) =>
        names.Select((n, i) => new Crew(n, Skills[(i + offset) % 8], Patterns[(i + offset) % 8])).ToArray();

    static readonly CompanySeed[] Companies =
    [
        new("Ember & Oak", "ember-oak", "emberandoak.test", "#E8590C", "Australia/Brisbane",
            "Wood-fired grill · South East Queensland",
            "Sam Whitlock", "Operations Manager", PreferredCover: "Jordan",
            [
                // Ipswich mirrors the original concept shot: Aroha, Jordan, Priya, Liam, Mei.
                new("Ipswich", 8600m,
                [
                    new("Aroha", Station.Floor, "DD.DD.x"),
                    new("Jordan", Station.Floor | Station.Bar, ".D.DC.."),
                    new("Priya", Station.Floor, "D.D.D.."),
                    new("Liam", Station.Kitchen, "OOO.O.."),
                    new("Mei", Station.Kitchen | Station.Floor, ".DDDD.."),
                    new("Tama", Station.Kitchen, "..CCCC."),
                    new("Grace", Station.Bar, "...CCCC"),
                    new("Noah", Station.Barista | Station.Floor, "EE...EE"),
                    new("Isla", Station.Floor, ".x..MMM"),
                ]),
                new("Springfield", 7900m, Rotate(1, "Hannah", "Riley", "Wiremu", "Sofia", "Ethan", "Leilani", "Marcus", "Chloe")),
                new("Toowong", 6900m, Rotate(3, "Ava", "Kai", "Zara", "Oliver", "Ngaio", "Ben", "Lucia", "Ravi")),
            ]),
        new("Saltbush Kitchen", "saltbush", "saltbush.test", "#0F9D7A", "Australia/Perth",
            "Native produce dining · Western Australia",
            "Maya Collins", "Group Manager", PreferredCover: null,
            [
                new("Fremantle", 8200m, Rotate(0, "Matilda", "Jack", "Anika", "Tom", "Yuki", "Sienna", "Darcy", "Farah")),
                new("Perth CBD", 8800m, Rotate(2, "Lachlan", "Ruby", "Arjun", "Georgia", "Hamish", "Imogen", "Kiri", "Sam")),
            ]),
        new("Juniper & Co.", "juniper", "juniperco.test", "#7C5CFF", "Australia/Melbourne",
            "Wine bars & small plates · Melbourne",
            "Alex Romano", "Venue Director", PreferredCover: null,
            [
                new("Fitzroy", 8000m, Rotate(0, "Elena", "Felix", "Amara", "Hugo", "Nina", "Oscar", "Priyanka", "Theo")),
                new("Richmond", 7600m, Rotate(4, "Bella", "Callum", "Dev", "Esme", "Finn", "Gemma", "Harvey", "Ines")),
                new("Southbank", 9100m, Rotate(6, "Jasper", "Kaia", "Leo", "Maeve", "Niko", "Olive", "Pita", "Quinn")),
            ]),
    ];

    public static IReadOnlyList<DemoAccount> DemoAccounts { get; } = Companies.Select(c =>
    {
        var staff = c.Sites[0].Crew[c.Slug == "ember-oak" ? 2 : 0].Name; // Priya for Ember & Oak
        return new DemoAccount(c.Name, c.Accent, c.Tagline,
            c.Manager, Email(c.Manager, c.Domain), staff, Email(staff, c.Domain));
    }).ToList();

    static string Email(string name, string domain) => $"{name.Split(' ')[0].ToLowerInvariant()}@{domain}";

    public static async Task SeedAsync(RostraDb db, DateOnly today)
    {
        if (!await db.Companies.AnyAsync())
            await SeedCompaniesAsync(db);
        await EnsureManagersRosteredAsync(db, today);
        await EnsureRosterAsync(db, today);
        await EnsureCertificationsAsync(db, today);
        await EnsureTimeOffAsync(db, today);
        await EnsureRevenueAsync(db, today);
    }

    static async Task SeedCompaniesAsync(RostraDb db)
    {
        // One hash for every demo login keeps start-up fast. Demo data only.
        var hash = new PasswordHasher<Staff>().HashPassword(null!, DemoPassword);

        foreach (var c in Companies)
        {
            var company = new Company { Name = c.Name, Slug = c.Slug, Accent = c.Accent, TimeZone = c.TimeZone };
            db.Companies.Add(company);
            await db.SaveChangesAsync();

            var sites = c.Sites.Select(s => new Site { CompanyId = company.Id, Name = s.Name, WeeklyBudget = s.Budget }).ToList();
            db.Sites.AddRange(sites);
            await db.SaveChangesAsync();

            db.Staff.Add(new Staff
            {
                CompanyId = company.Id, HomeSiteId = sites[0].Id, Name = c.Manager, Title = c.ManagerTitle,
                Email = Email(c.Manager, c.Domain), PasswordHash = hash, Role = StaffRole.Manager,
                HourlyRate = 46.50m, Stations = Station.Floor | Station.Bar, PrimaryStation = Station.Floor,
                UsualPattern = ManagerPattern,
            });

            for (var s = 0; s < sites.Count; s++)
            {
                var crew = c.Sites[s].Crew;
                for (var i = 0; i < crew.Length; i++)
                {
                    var m = crew[i];
                    db.Staff.Add(new Staff
                    {
                        CompanyId = company.Id, HomeSiteId = sites[s].Id, Name = m.Name,
                        Email = Email(m.Name, c.Domain), PasswordHash = hash, Role = StaffRole.Staff,
                        Title = TitleFor(m.Stations), HourlyRate = Rates[(i + s) % Rates.Length],
                        Stations = m.Stations, PrimaryStation = Primary(m.Stations),
                        AvailableDays = Availability(m.Pattern), UsualPattern = m.Pattern,
                    });
                }
            }
            await db.SaveChangesAsync();
        }
    }

    /// <summary>
    /// Fills last week through three weeks out from each person's usual pattern, so the demo is never empty.
    /// Weeks that already have shifts at a site are left alone, so edits survive restarts.
    /// </summary>
    static async Task EnsureRosterAsync(RostraDb db, DateOnly today)
    {
        var monday = Week.StartOf(today);
        var companies = await db.Companies.ToListAsync();
        var sites = await db.Sites.IgnoreQueryFilters().ToListAsync();
        var crew = await db.Staff.IgnoreQueryFilters()
            .Where(s => s.IsActive && s.UsualPattern != null)
            .OrderBy(s => s.Id).ToListAsync();

        for (var w = -1; w <= 3; w++)
        {
            var from = monday.AddDays(7 * w).ToDateTime(TimeOnly.MinValue);
            var to = from.AddDays(7);
            var rostered = await db.Shifts.IgnoreQueryFilters()
                .Where(s => s.Start >= from && s.Start < to)
                .Select(s => s.SiteId).Distinct().ToListAsync();

            foreach (var site in sites.Where(s => !rostered.Contains(s.Id)))
            {
                var team = crew.Where(s => s.HomeSiteId == site.Id).ToList();
                var swapTeam = team.Where(s => s.Role == StaffRole.Staff).ToList();
                var week = new List<Shift>();
                for (var i = 0; i < team.Count; i++)
                {
                    var member = team[i];
                    var days = member.UsualPattern!;
                    // Drop one usual shift every so often so weeks don't look copy-pasted.
                    var skip = (i + w + 5) % 5 == 0 ? days.LastIndexOfAny("OEDMCL".ToCharArray()) : -1;
                    for (var d = 0; d < 7; d++)
                    {
                        if (d == skip || Template(days[d]) is not { } t) continue;
                        var day = from.AddDays(d);
                        week.Add(new Shift
                        {
                            CompanyId = site.CompanyId, SiteId = site.Id, StaffId = member.Id,
                            Start = day.AddMinutes(t.Start), End = day.AddMinutes(t.End), BreakMinutes = t.Break,
                            Station = member.PrimaryStation,
                        });
                    }
                }

                if (w is 0 or 1) AddPendingSwap(week, swapTeam, companies.First(c => c.Id == site.CompanyId), site, sites, w);
                db.Shifts.AddRange(week);
            }
        }
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Databases seeded before managers were on the roster: give each manager a usual week and
    /// slot their shifts into weeks that already exist. Runs once (the pattern marks it done).
    /// </summary>
    static async Task EnsureManagersRosteredAsync(RostraDb db, DateOnly today)
    {
        var managers = await db.Staff.IgnoreQueryFilters()
            .Where(s => s.Role == StaffRole.Manager && s.IsActive && s.UsualPattern == null)
            .ToListAsync();
        if (managers.Count == 0) return;

        var monday = Week.StartOf(today);
        foreach (var m in managers)
        {
            m.UsualPattern = ManagerPattern;
            var mine = await db.Shifts.IgnoreQueryFilters().Where(s => s.StaffId == m.Id).ToListAsync();
            for (var w = -1; w <= 3; w++)
            {
                var weekStart = monday.AddDays(7 * w).ToDateTime(TimeOnly.MinValue);
                // Only weeks the roster generator has already filled; empty weeks get the pattern later.
                if (!await db.Shifts.IgnoreQueryFilters().AnyAsync(s => s.SiteId == m.HomeSiteId && s.Start >= weekStart && s.Start < weekStart.AddDays(7)))
                    continue;
                for (var d = 0; d < 7; d++)
                {
                    if (Template(ManagerPattern[d]) is not { } t) continue;
                    var start = weekStart.AddDays(d).AddMinutes(t.Start);
                    var end = weekStart.AddDays(d).AddMinutes(t.End);
                    if (mine.Any(s => s.Start < end && start < s.End)) continue;
                    db.Shifts.Add(new Shift
                    {
                        CompanyId = m.CompanyId, SiteId = m.HomeSiteId, StaffId = m.Id,
                        Start = start, End = end, BreakMinutes = t.Break, Station = m.PrimaryStation,
                    });
                }
            }
        }
        await db.SaveChangesAsync();
    }

    /// <summary>One open swap request per company's flagship site, like "Priya asked Jordan to cover Wed 9–5".</summary>
    static void AddPendingSwap(List<Shift> week, List<Staff> team, Company company, Site site, List<Site> sites, int w)
    {
        if (sites.First(s => s.CompanyId == company.Id).Id != site.Id || team.Count == 0) return;

        var seed = Companies.First(c => c.Slug == company.Slug);
        var asker = team[seed.Slug == "ember-oak" ? Math.Min(2, team.Count - 1) : w % team.Count];
        var mine = week.Where(s => s.StaffId == asker.Id).OrderBy(s => s.Start).ToList();
        var shift = mine.FirstOrDefault(s => s.Start.DayOfWeek == DayOfWeek.Wednesday) ?? mine.FirstOrDefault();
        if (shift is null) return;

        bool Free(Staff s) =>
            s.Id != asker.Id
            && s.AvailableDays.HasFlag(Week.DayFlag(shift.Start.DayOfWeek))
            && s.Stations.HasFlag(shift.Station)
            && !week.Any(o => o.StaffId == s.Id && o.Start < shift.End && shift.Start < o.End);

        var cover = team.FirstOrDefault(s => s.Name == seed.PreferredCover && Free(s)) ?? team.FirstOrDefault(Free);
        if (cover is not null) shift.PendingCoverId = cover.Id;
    }

    static (int Start, int End, int Break)? Template(char code) => code switch
    {
        'E' => (6 * 60 + 30, 14 * 60 + 30, 30), // early, 6:30–2:30
        'O' => (7 * 60, 15 * 60, 30),           // open, 7–3
        'D' => (9 * 60, 17 * 60, 30),           // day, 9–5
        'M' => (11 * 60, 19 * 60, 30),          // mid, 11–7
        'C' => (16 * 60, 23 * 60, 30),          // close, 4–11
        'L' => (17 * 60, 22 * 60, 0),           // late, 5–10
        _ => null,
    };

    static string CertificationFor(Station primary) => primary switch
    {
        Station.Kitchen => "Food Safety Supervisor",
        Station.Barista => "Food Handler",
        _ => "RSA",
    };

    /// <summary>Most tickets are years out; a couple per company lapse within the month so there's something to chase.</summary>
    static async Task EnsureCertificationsAsync(RostraDb db, DateOnly today)
    {
        var crew = await db.Staff.IgnoreQueryFilters().Where(s => s.Role == StaffRole.Staff).OrderBy(s => s.Id).ToListAsync();
        if (crew.Any(s => s.CertificationExpires >= today)) return;
        for (var i = 0; i < crew.Count; i++)
        {
            crew[i].Certification = CertificationFor(crew[i].PrimaryStation);
            crew[i].CertificationExpires = i % 13 == 4
                ? today.AddDays(9 + i % 17)
                : today.AddDays(120 + (i * 37) % 600);
        }
        await db.SaveChangesAsync();
    }

    static readonly string[] Reasons = ["Uni exams", "Family wedding", "Medical appointment", "Moving house", "Sister’s graduation", "Weekend away"];

    /// <summary>Keeps a few pending time-off requests in the near future, and someone on leave today.</summary>
    static async Task EnsureTimeOffAsync(RostraDb db, DateOnly today)
    {
        if (await db.TimeOff.IgnoreQueryFilters().AnyAsync(t => t.To >= today)) return;

        var dayStart = today.ToDateTime(TimeOnly.MinValue);
        var busyToday = await db.Shifts.IgnoreQueryFilters()
            .Where(s => s.Start >= dayStart && s.Start < dayStart.AddDays(1)).Select(s => s.StaffId).ToListAsync();
        var crew = await db.Staff.IgnoreQueryFilters()
            .Where(s => s.Role == StaffRole.Staff).OrderBy(s => s.Id).ToListAsync();

        foreach (var team in crew.GroupBy(s => s.CompanyId))
        {
            var people = team.ToList();
            for (var i = 0; i < 3 && i * 5 + 1 < people.Count; i++)
            {
                var from = today.AddDays(3 + i * 4);
                db.TimeOff.Add(new TimeOffRequest
                {
                    CompanyId = team.Key, StaffId = people[i * 5 + 1].Id, From = from, To = from.AddDays(i % 2),
                    Reason = Reasons[(team.Key + i) % Reasons.Length], Status = RequestStatus.Pending,
                    CreatedAt = DateTime.Now.AddHours(-6 - i * 9),
                });
            }

            var away = people.FirstOrDefault(p => !busyToday.Contains(p.Id) && p.HomeSiteId == people[0].HomeSiteId);
            if (away is not null)
                db.TimeOff.Add(new TimeOffRequest
                {
                    CompanyId = team.Key, StaffId = away.Id, From = today, To = today.AddDays(1),
                    Reason = "Annual leave", Status = RequestStatus.Approved, CreatedAt = DateTime.Now.AddDays(-12),
                });
        }
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Daily takings: a forecast for every day in the roster window, and an "actual" for days that
    /// have finished, the way a POS integration would fill it in overnight.
    /// </summary>
    static async Task EnsureRevenueAsync(RostraDb db, DateOnly today)
    {
        var monday = Week.StartOf(today);
        var from = monday.AddDays(-7);
        var to = monday.AddDays(28);
        var sites = await db.Sites.IgnoreQueryFilters().ToListAsync();
        var existing = await db.SiteDays.IgnoreQueryFilters().Where(d => d.Date >= from && d.Date < to).ToListAsync();

        foreach (var site in sites)
        {
            // Budget is ~28% of expected weekly sales, so revenue scales with the site.
            var weekly = site.WeeklyBudget / 0.28m;
            for (var date = from; date < to; date = date.AddDays(1))
            {
                var row = existing.FirstOrDefault(d => d.SiteId == site.Id && d.Date == date);
                if (row is null)
                {
                    var share = date.DayOfWeek switch
                    {
                        DayOfWeek.Friday => 0.19m, DayOfWeek.Saturday => 0.22m, DayOfWeek.Sunday => 0.16m,
                        DayOfWeek.Monday => 0.09m, _ => 0.113m,
                    };
                    var wobble = 0.94m + Noise(site.Id, date, 1) * 0.12m;
                    row = new SiteDay { CompanyId = site.CompanyId, SiteId = site.Id, Date = date, ForecastRevenue = Math.Round(weekly * share * wobble, 2) };
                    db.SiteDays.Add(row);
                }
                if (row.ActualRevenue is null && date < today)
                    row.ActualRevenue = Math.Round(row.ForecastRevenue * (0.86m + Noise(site.Id, date, 2) * 0.26m), 2);
            }
        }
        await db.SaveChangesAsync();
    }

    /// <summary>Deterministic 0–1 noise so demo numbers are stable across restarts.</summary>
    static decimal Noise(int siteId, DateOnly date, int salt)
    {
        var h = (uint)(siteId * 73856093 ^ date.DayNumber * 19349663 ^ salt * 83492791);
        h ^= h >> 13; h *= 0x5bd1e995; h ^= h >> 15;
        return (h % 1000) / 1000m;
    }

    static Days Availability(string pattern)
    {
        var days = Days.All;
        for (var d = 0; d < 7; d++)
            if (pattern[d] == 'x') days &= ~(Days)(1 << d);
        return days;
    }

    // Most specialised skill wins: a chef who can run food is still rostered as a chef.
    static Station Primary(Station s) =>
        new[] { Station.Kitchen, Station.Barista, Station.Floor, Station.Bar }.First(p => s.HasFlag(p));

    static string TitleFor(Station s) => Primary(s) switch
    {
        Station.Kitchen => "Chef",
        Station.Barista => "Barista",
        Station.Bar => "Bartender",
        _ => "Floor Staff",
    };
}
