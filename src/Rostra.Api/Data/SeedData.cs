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
        string Name, string Slug, string Domain, string Accent, string Tagline,
        string Manager, string ManagerTitle, string? PreferredCover, SiteSeed[] Sites);

    public record DemoAccount(
        string Company, string Accent, string Tagline,
        string ManagerName, string ManagerEmail, string StaffName, string StaffEmail);

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
        new("Ember & Oak", "ember-oak", "emberandoak.test", "#E8590C",
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
        new("Saltbush Kitchen", "saltbush", "saltbush.test", "#0F9D7A",
            "Native produce dining · Western Australia",
            "Maya Collins", "Group Manager", PreferredCover: null,
            [
                new("Fremantle", 8200m, Rotate(0, "Matilda", "Jack", "Anika", "Tom", "Yuki", "Sienna", "Darcy", "Farah")),
                new("Perth CBD", 8800m, Rotate(2, "Lachlan", "Ruby", "Arjun", "Georgia", "Hamish", "Imogen", "Kiri", "Sam")),
            ]),
        new("Juniper & Co.", "juniper", "juniperco.test", "#7C5CFF",
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
        await EnsureRosterAsync(db, today);
    }

    static async Task SeedCompaniesAsync(RostraDb db)
    {
        // One hash for every demo login keeps start-up fast. Demo data only.
        var hash = new PasswordHasher<Staff>().HashPassword(null!, DemoPassword);

        foreach (var c in Companies)
        {
            var company = new Company { Name = c.Name, Slug = c.Slug, Accent = c.Accent };
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
            .Where(s => s.Role == StaffRole.Staff && s.IsActive && s.UsualPattern != null)
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

                if (w is 0 or 1) AddPendingSwap(week, team, companies.First(c => c.Id == site.CompanyId), site, sites, w);
                db.Shifts.AddRange(week);
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
