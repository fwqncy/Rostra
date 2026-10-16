using Microsoft.EntityFrameworkCore;
using Rostra.Api.Domain;
using Rostra.Api.Infrastructure;

namespace Rostra.Api.Data;

/// <summary>
/// Stands in for real staff tapping the time clock, so the demo's live feed and wage tracker move.
/// Punch times are derived from the shift id, so they're stable across restarts. The demo staff
/// logins (managers and staff) are skipped from today on: clock them in yourself from My Shifts.
/// </summary>
public static class DemoCrew
{
    static readonly HashSet<string> DemoStaff =
        SeedData.DemoAccounts.SelectMany(a => new[] { a.StaffEmail, a.ManagerEmail }).ToHashSet(StringComparer.OrdinalIgnoreCase);

    public static async Task TickAsync(RostraDb db, EventHub? hub)
    {
        var zones = await db.Companies.Select(c => new { c.Id, c.TimeZone }).ToListAsync();
        var changed = new HashSet<(int Company, int Site)>();
        foreach (var company in zones)
            await TickCompanyAsync(db, company.Id, VenueClock.Now(company.TimeZone), changed);

        if (changed.Count == 0) return;
        await db.SaveChangesAsync();
        foreach (var (company, site) in changed) hub?.Publish(company, "clock", new { siteId = site });
    }

    static async Task TickCompanyAsync(RostraDb db, int companyId, DateTime now, HashSet<(int Company, int Site)> changed)
    {
        var since = now.AddDays(-15); // covers all of last week, for timesheets
        var shifts = await db.Shifts.IgnoreQueryFilters()
            .Where(s => s.CompanyId == companyId && s.StaffId != null && s.Start >= since && s.Start <= now.AddMinutes(15)
                        && db.RosterWeeks.IgnoreQueryFilters().Any(w => w.SiteId == s.SiteId && w.Status == RosterStatus.Published && w.Start <= s.Start && s.Start < w.End))
            .Select(s => new { s.Id, s.CompanyId, s.SiteId, s.StaffId, s.Start, s.End, s.Staff!.Email })
            .ToListAsync();
        if (shifts.Count == 0) return;

        var ids = shifts.Select(s => s.Id).ToList();
        var punched = await db.ClockEvents.IgnoreQueryFilters()
            .Where(e => e.ShiftId != null && ids.Contains(e.ShiftId.Value))
            .Select(e => new { ShiftId = e.ShiftId!.Value, e.Kind })
            .ToListAsync();
        var hasIn = punched.Where(p => p.Kind == ClockKind.In).Select(p => p.ShiftId).ToHashSet();
        var hasOut = punched.Where(p => p.Kind == ClockKind.Out).Select(p => p.ShiftId).ToHashSet();

        foreach (var s in shifts)
        {
            if (DemoStaff.Contains(s.Email) && s.Start.Date >= now.Date) continue;
            var h = Hash(s.Id);
            if (h % 23 == 0) continue; // the occasional no-show, so "late" has something to show

            var clockIn = s.Start.AddMinutes((int)(h % 21) - 9);          // 9 min early … 11 min late
            var clockOut = s.End.AddMinutes((int)(h / 21 % 21) - 6);      // 6 min early … 14 min over
            var isIn = hasIn.Contains(s.Id);
            if (!isIn && clockIn <= now)
            {
                db.ClockEvents.Add(new ClockEvent { CompanyId = s.CompanyId, SiteId = s.SiteId, StaffId = s.StaffId!.Value, ShiftId = s.Id, At = clockIn, Kind = ClockKind.In });
                isIn = true;
                changed.Add((s.CompanyId, s.SiteId));
            }
            if (isIn && !hasOut.Contains(s.Id) && clockOut <= now)
            {
                db.ClockEvents.Add(new ClockEvent { CompanyId = s.CompanyId, SiteId = s.SiteId, StaffId = s.StaffId!.Value, ShiftId = s.Id, At = clockOut, Kind = ClockKind.Out });
                changed.Add((s.CompanyId, s.SiteId));
            }
        }
    }

    static uint Hash(int id)
    {
        var h = (uint)id * 2654435761u;
        h ^= h >> 16;
        return h;
    }
}

public sealed class DemoCrewService(IServiceScopeFactory scopes, EventHub hub, ILogger<DemoCrewService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var scope = scopes.CreateScope();
                await DemoCrew.TickAsync(scope.ServiceProvider.GetRequiredService<RostraDb>(), hub);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogWarning(e, "Demo crew tick failed");
            }
        }
    }
}
