using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Rostra.Api.Auth;
using Rostra.Api.Data;
using Rostra.Api.Domain;
using Rostra.Api.Infrastructure;

namespace Rostra.Api.Dashboard;

public record ManualClockInput(int StaffId, ClockKind Kind, DateTime? At);
public record RevenueRow(DateOnly Date, decimal? Forecast, decimal? Actual);
public record RevenueUpload(int SiteId, RevenueRow[] Rows);

public static class DashboardEndpoints
{
    public static void MapDashboard(this WebApplication app)
    {
        var manager = app.MapGroup("").RequireAuthorization("Manager");
        manager.MapGet("/dashboard/tasks", GetTasks);
        manager.MapGet("/dashboard/today", GetToday);
        manager.MapGet("/dashboard/wages", GetWages);
        manager.MapGet("/dashboard/week", GetWeek);
        manager.MapGet("/clock/feed", GetFeed);
        manager.MapPost("/clock/manual", ManualClock);
        manager.MapPost("/time-off/{id:int}/approve", (int id, RostraDb db, EventHub hub, Inbox inbox) => ResolveTimeOff(id, RequestStatus.Approved, db, hub, inbox));
        manager.MapPost("/time-off/{id:int}/decline", (int id, RostraDb db, EventHub hub, Inbox inbox) => ResolveTimeOff(id, RequestStatus.Declined, db, hub, inbox));
        manager.MapPost("/revenue", UploadRevenue);

        app.MapPost("/clock", ClockMe).RequireAuthorization("Staff");
    }

    /* ---------------------------------------------------------------------
       Shared: shifts with who's on them, their rate, and their punches
       --------------------------------------------------------------------- */
    sealed record Row(Shift Shift, string Name, string Title, decimal Rate, DateTime? In, DateTime? Out);

    /// <summary>Open shifts have no rate yet; plan with the team's average.</summary>
    static async Task<decimal> AverageRateAsync(RostraDb db)
    {
        // SQLite can't average decimals, so average in memory (it's one small column).
        var rates = await db.Staff.Where(s => s.IsActive && s.Role == StaffRole.Staff).Select(s => s.HourlyRate).ToListAsync();
        return rates.Count > 0 ? rates.Average() : 30m;
    }

    static async Task<List<Row>> LoadRowsAsync(RostraDb db, DateTime from, DateTime to, int? siteId, Station? station = null)
    {
        var query = db.Shifts.AsNoTracking().Include(s => s.Staff).Where(s => s.Start >= from && s.Start < to);
        if (siteId is int site) query = query.Where(s => s.SiteId == site);
        if (station is { } st and not Station.None) query = query.Where(s => s.Station == st);
        var shifts = await query.OrderBy(s => s.Start).ToListAsync();
        var average = shifts.Any(s => s.Staff is null) ? await AverageRateAsync(db) : 0m;

        var ids = shifts.Select(s => s.Id).ToList();
        var punches = await db.ClockEvents
            .Where(c => c.ShiftId != null && ids.Contains(c.ShiftId.Value))
            .Select(c => new { Id = c.ShiftId!.Value, c.Kind, c.At })
            .ToListAsync();
        var ins = punches.Where(p => p.Kind == ClockKind.In).GroupBy(p => p.Id).ToDictionary(g => g.Key, g => g.Min(p => p.At));
        var outs = punches.Where(p => p.Kind == ClockKind.Out).GroupBy(p => p.Id).ToDictionary(g => g.Key, g => g.Max(p => p.At));

        return shifts.Select(s => new Row(
            s, s.Staff?.Name ?? "Open shift", s.Staff?.Title ?? "Unfilled", s.Staff?.HourlyRate ?? average,
            ins.TryGetValue(s.Id, out var i) ? i : null,
            outs.TryGetValue(s.Id, out var o) ? o : null)).ToList();
    }

    /// <summary>When an open punch is treated as ending: now for today, the rostered end for past days.</summary>
    static DateTime OpenEnd(Row r, DateTime now) => r.Out ?? (r.Shift.Start.Date == now.Date ? now : r.Shift.End);

    static async Task<Site> SiteOrHome(int? siteId, ClaimsPrincipal user, RostraDb db)
    {
        if (siteId is int id && await db.Sites.FirstOrDefaultAsync(s => s.Id == id) is { } site) return site;
        var home = await db.Staff.Where(s => s.Id == user.StaffId()).Select(s => s.HomeSiteId).FirstAsync();
        return await db.Sites.FirstAsync(s => s.Id == home);
    }

    static Station? ParseStation(string? value) =>
        Enum.TryParse<Station>(value, ignoreCase: true, out var st) && Enum.IsDefined(st) && st != Station.None ? st : null;

    /* ---------------------------------------------------------------------
       What should I work on?
       --------------------------------------------------------------------- */
    static async Task<IResult> GetTasks(RostraDb db)
    {
        var now = await db.NowAsync();
        var today = DateOnly.FromDateTime(now);

        var swaps = await db.Shifts.CountAsync(s => s.PendingCoverId != null);

        var requests = await db.TimeOff
            .Where(t => t.Status == RequestStatus.Pending && t.To >= today)
            .OrderBy(t => t.From)
            .Select(t => new { t.Id, t.StaffId, t.Staff!.Name, t.From, t.To, t.Reason })
            .ToListAsync();
        var timeOff = new List<object>();
        foreach (var t in requests)
        {
            var from = t.From.ToDateTime(TimeOnly.MinValue);
            var to = t.To.ToDateTime(TimeOnly.MinValue).AddDays(1);
            var clashes = await db.Shifts.CountAsync(s => s.StaffId == t.StaffId && s.Start >= from && s.Start < to);
            timeOff.Add(new { t.Id, t.Name, t.From, t.To, t.Reason, RosteredShifts = clashes });
        }

        var soon = today.AddDays(30);
        var certifications = await db.Staff
            .Where(s => s.IsActive && s.CertificationExpires != null && s.CertificationExpires <= soon)
            .OrderBy(s => s.CertificationExpires)
            .Select(s => new { s.Id, s.Name, s.Certification, Expires = s.CertificationExpires!.Value, Site = s.HomeSite!.Name })
            .ToListAsync();

        var nextMonday = Week.StartOf(today).AddDays(7).ToDateTime(TimeOnly.MinValue);
        var nextWeek = await LoadRowsAsync(db, nextMonday, nextMonday.AddDays(7), null);
        var sites = await db.Sites.OrderBy(s => s.Id).ToListAsync();
        var budgets = sites.Select(site =>
        {
            var rows = nextWeek.Where(r => r.Shift.SiteId == site.Id).ToList();
            var cost = rows.Sum(r => Labour.Cost(r.Shift.PaidHours, r.Rate, r.Shift.Start));
            return new { SiteId = site.Id, Site = site.Name, Cost = Math.Round(cost, 2), Budget = site.WeeklyBudget, Shifts = rows.Count };
        }).ToList();

        var dayStart = now.Date;
        var lateCutoff = now.AddMinutes(-10);
        var lateRows = await LoadRowsAsync(db, dayStart, dayStart.AddDays(1), null);
        var late = lateRows
            .Where(r => r.In is null && r.Shift.Start <= lateCutoff && r.Shift.End > now)
            .Select(r => new { ShiftId = r.Shift.Id, r.Name, r.Shift.SiteId, r.Shift.Start, r.Shift.End })
            .ToList();

        // Rosters that still need publishing: this week and next, per site.
        var thisMonday = Week.StartOf(today).ToDateTime(TimeOnly.MinValue);
        var publishedWeeks = await db.RosterWeeks
            .Where(w => w.Status == RosterStatus.Published && (w.Start == thisMonday || w.Start == nextMonday))
            .Select(w => new { w.SiteId, w.Start }).ToListAsync();
        var weeksWithShifts = await db.Shifts.Where(s => s.Start >= thisMonday && s.Start < nextMonday.AddDays(7))
            .Select(s => new { s.SiteId, s.Start }).ToListAsync();
        var unpublished = weeksWithShifts
            .Select(s => new { s.SiteId, Start = s.Start < nextMonday ? thisMonday : nextMonday })
            .Distinct()
            .Where(w => !publishedWeeks.Any(p => p.SiteId == w.SiteId && p.Start == w.Start))
            .Select(w => new { w.SiteId, Site = sites.First(s => s.Id == w.SiteId).Name, WeekStart = DateOnly.FromDateTime(w.Start), WeekNumber = Week.Number(w.Start) })
            .OrderBy(w => w.WeekStart).ToList();

        var openShifts = await db.Shifts.Where(s => s.StaffId == null && s.Start > now && s.Start < nextMonday.AddDays(7))
            .Select(s => new { s.Id, s.SiteId, s.Start, s.End, Claimed = s.PendingCoverId != null }).ToListAsync();

        return Results.Ok(new
        {
            Swaps = swaps, TimeOff = timeOff, Certifications = certifications, NextWeek = budgets, NextWeekStart = DateOnly.FromDateTime(nextMonday),
            Late = late, Unpublished = unpublished,
            OpenShifts = new { Total = openShifts.Count, Unclaimed = openShifts.Count(o => !o.Claimed) },
        });
    }

    static async Task<IResult> ResolveTimeOff(int id, RequestStatus status, RostraDb db, EventHub hub, Inbox inbox)
    {
        var request = await db.TimeOff.Include(t => t.Staff).FirstOrDefaultAsync(t => t.Id == id);
        if (request is null) return Results.NotFound();
        if (request.Status != RequestStatus.Pending)
            return Results.Conflict(new { error = $"This request was already {request.Status.ToString().ToLowerInvariant()}." });

        request.Status = status;
        await db.SaveChangesAsync();
        var span = request.From == request.To
            ? request.From.ToString("ddd d MMM", System.Globalization.CultureInfo.InvariantCulture)
            : $"{request.From.ToString("d MMM", System.Globalization.CultureInfo.InvariantCulture)} – {request.To.ToString("d MMM", System.Globalization.CultureInfo.InvariantCulture)}";
        await inbox.SendAsync([request.StaffId], "leave",
            status == RequestStatus.Approved ? $"Leave approved: {span}" : $"Leave declined: {span}",
            status == RequestStatus.Approved ? "Enjoy the time off." : "Talk to your manager if you need to change dates.", "/app/home");
        hub.Publish(request.CompanyId, "timeoff", new { id, status = status.ToString() });
        return Results.Ok(new { id, status });
    }

    /* ---------------------------------------------------------------------
       Who's in today?
       --------------------------------------------------------------------- */
    static async Task<IResult> GetToday(int? siteId, ClaimsPrincipal user, RostraDb db)
    {
        var site = await SiteOrHome(siteId, user, db);
        var now = await db.NowAsync();
        var today = DateOnly.FromDateTime(now);
        var rows = await LoadRowsAsync(db, now.Date, now.Date.AddDays(1), site.Id);

        var onLeave = await db.TimeOff
            .Where(t => t.Status == RequestStatus.Approved && t.From <= today && t.To >= today && t.Staff!.HomeSiteId == site.Id)
            .Select(t => new { t.Staff!.Name, t.Reason, t.To })
            .ToListAsync();

        return Results.Ok(new
        {
            Now = now,
            Site = new { site.Id, site.Name },
            Shifts = rows.Select(r => new
            {
                r.Shift.Id, r.Shift.StaffId, r.Name, r.Title, r.Shift.Station, r.Shift.Start, r.Shift.End,
                r.Shift.BreakMinutes, ClockIn = r.In, ClockOut = r.Out, IsOpen = r.Shift.StaffId == null,
            }),
            OnLeave = onLeave,
        });
    }

    /* ---------------------------------------------------------------------
       Live time clock
       --------------------------------------------------------------------- */
    static async Task<IResult> GetFeed(int? siteId, string? q, string? kind, RostraDb db)
    {
        var now = await db.NowAsync();
        var query = db.ClockEvents.Where(c => c.At <= now);
        if (siteId is int site) query = query.Where(c => c.SiteId == site);
        if (Enum.TryParse<ClockKind>(kind, true, out var k)) query = query.Where(c => c.Kind == k);
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim().ToLower();
            query = query.Where(c => c.Staff!.Name.ToLower().Contains(term));
        }

        var events = await query
            .OrderByDescending(c => c.At).Take(40)
            .Select(c => new
            {
                c.Id, c.StaffId, c.Staff!.Name, c.SiteId,
                Site = db.Sites.Where(s => s.Id == c.SiteId).Select(s => s.Name).First(),
                c.At, c.Kind, c.Source,
                ShiftStart = db.Shifts.Where(s => s.Id == c.ShiftId).Select(s => (DateTime?)s.Start).FirstOrDefault(),
                ShiftEnd = db.Shifts.Where(s => s.Id == c.ShiftId).Select(s => (DateTime?)s.End).FirstOrDefault(),
            })
            .ToListAsync();
        return Results.Ok(events);
    }

    /// <summary>Staff tap one button: it clocks them in, or out, of the shift they're on.</summary>
    static async Task<IResult> ClockMe(ClaimsPrincipal user, RostraDb db, EventHub hub)
    {
        var me = user.StaffId();
        var now = await db.NowAsync();
        var result = await PunchAsync(db, me, null, now, "App");
        if (result.Error is not null) return Results.Conflict(new { error = result.Error });

        hub.Publish(result.Event!.CompanyId, "clock", new { siteId = result.Event.SiteId });
        return Results.Ok(new { result.Event.Kind, result.Event.At, result.Event.ShiftId });
    }

    static async Task<IResult> ManualClock(ManualClockInput input, RostraDb db, EventHub hub)
    {
        var now = await db.NowAsync();
        var at = input.At ?? now;
        if (at > now.AddMinutes(1))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["at"] = ["Clock times can’t be in the future."] });
        if (!await db.Staff.AnyAsync(s => s.Id == input.StaffId))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["staffId"] = ["Choose someone from your team."] });

        var result = await PunchAsync(db, input.StaffId, input.Kind, at, "Manager");
        if (result.Error is not null)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["kind"] = [result.Error] });

        hub.Publish(result.Event!.CompanyId, "clock", new { siteId = result.Event.SiteId });
        return Results.Ok(new { result.Event.Id, result.Event.Kind, result.Event.At });
    }

    sealed record Punch(ClockEvent? Event, string? Error);

    static async Task<Punch> PunchAsync(RostraDb db, int staffId, ClockKind? kind, DateTime at, string source)
    {
        var window = source == "App" ? TimeSpan.FromHours(2) : TimeSpan.FromHours(4);
        // Staff can only clock against published shifts; managers can record punches for any.
        var shifts = source == "App" ? db.PublishedShifts : db.Shifts;
        var candidates = await shifts
            .Where(s => s.StaffId == staffId && s.Start <= at + window && s.End >= at - window)
            .Select(s => new
            {
                Shift = s,
                In = db.ClockEvents.Any(c => c.ShiftId == s.Id && c.Kind == ClockKind.In),
                Out = db.ClockEvents.Any(c => c.ShiftId == s.Id && c.Kind == ClockKind.Out),
            })
            .ToListAsync();

        // Prefer the shift they're currently clocked into; otherwise the one starting closest to now.
        var pick = candidates.FirstOrDefault(c => c.In && !c.Out)
                   ?? candidates.Where(c => !c.Out).OrderBy(c => Math.Abs((c.Shift.Start - at).TotalMinutes)).FirstOrDefault();
        if (pick is null)
            return candidates.Count > 0
                ? new Punch(null, "Already clocked out of this shift.")
                : new Punch(null, source == "App"
                    ? "You’re not rostered on right now. Ask your manager to add your shift first."
                    : "There’s no shift around that time. Add the shift first, then record the punch.");

        var next = pick.In ? ClockKind.Out : ClockKind.In;
        if (kind is { } wanted && wanted != next)
            return new Punch(null, wanted == ClockKind.In ? "They’re already clocked in to this shift." : "They haven’t clocked in yet, so record a clock-in first.");

        var e = new ClockEvent
        {
            CompanyId = pick.Shift.CompanyId, SiteId = pick.Shift.SiteId, StaffId = staffId,
            ShiftId = pick.Shift.Id, At = at, Kind = next, Source = source,
        };
        db.ClockEvents.Add(e);
        await db.SaveChangesAsync();
        return new Punch(e, null);
    }

    /* ---------------------------------------------------------------------
       Live wage tracker: staff on the floor vs rostered, and cost so far
       --------------------------------------------------------------------- */
    static async Task<IResult> GetWages(int? siteId, DateOnly? date, string? station, RostraDb db)
    {
        var now = await db.NowAsync();
        var day = date ?? DateOnly.FromDateTime(now);
        var from = day.ToDateTime(TimeOnly.MinValue);
        var to = from.AddDays(1);
        var cutoff = to <= now ? to : from <= now ? now : from; // future days have no actuals
        var rows = await LoadRowsAsync(db, from, to, siteId, ParseStation(station));

        var points = new List<object>();
        if (rows.Count > 0)
        {
            var first = rows.Min(r => r.In is { } i && i < r.Shift.Start ? i : r.Shift.Start);
            var last = rows.Max(r => r.Out is { } o && o > r.Shift.End ? o : r.Shift.End);
            var start = first.Date.AddHours(first.Hour);
            var end = last.Minute == 0 ? last : last.Date.AddHours(last.Hour + 1);
            for (var t = start; t <= end; t = t.AddMinutes(15))
            {
                var rostered = rows.Count(r => r.Shift.Start <= t && t < r.Shift.End);
                int? actual = t <= cutoff
                    ? rows.Count(r => r.In is { } i && i <= t && t < OpenEnd(r, now))
                    : null;
                points.Add(new { T = t, Rostered = rostered, Actual = actual });
            }
        }

        decimal rosteredCost = 0, actualCost = 0, dayCost = 0;
        double rosteredHours = 0, actualHours = 0, dayHours = 0;
        foreach (var r in rows)
        {
            var s = r.Shift;
            var planned = Labour.PaidHoursWithin(s.Start, s.End, s.BreakMinutes, from, cutoff);
            rosteredHours += planned;
            rosteredCost += Labour.Cost(planned, r.Rate, s.Start);
            dayHours += s.PaidHours;
            dayCost += Labour.Cost(s.PaidHours, r.Rate, s.Start);
            if (r.In is { } clockIn)
            {
                var worked = Labour.WorkedHoursWithin(s, clockIn, OpenEnd(r, now), from, cutoff);
                actualHours += worked;
                actualCost += Labour.Cost(worked, r.Rate, s.Start);
            }
        }

        return Results.Ok(new
        {
            Date = day, Now = now, Cutoff = cutoff, IsToday = day == DateOnly.FromDateTime(now), IsFuture = from > now,
            Points = points,
            SoFar = new { ActualCost = Math.Round(actualCost, 2), RosteredCost = Math.Round(rosteredCost, 2), ActualHours = Math.Round(actualHours, 2), RosteredHours = Math.Round(rosteredHours, 2) },
            Day = new { RosteredCost = Math.Round(dayCost, 2), RosteredHours = Math.Round(dayHours, 2), Shifts = rows.Count },
        });
    }

    /* ---------------------------------------------------------------------
       Weekly planner: roster vs actual vs revenue
       --------------------------------------------------------------------- */
    static async Task<IResult> GetWeek(int? siteId, DateOnly? week, RostraDb db)
    {
        var now = await db.NowAsync();
        var today = DateOnly.FromDateTime(now);
        var monday = Week.StartOf(week ?? today);
        var from = monday.ToDateTime(TimeOnly.MinValue);
        var rows = await LoadRowsAsync(db, from, from.AddDays(7), siteId);

        var revenueQuery = db.SiteDays.Where(d => d.Date >= monday && d.Date < monday.AddDays(7));
        if (siteId is int site) revenueQuery = revenueQuery.Where(d => d.SiteId == site);
        var revenue = await revenueQuery.ToListAsync();

        var days = Enumerable.Range(0, 7).Select(i =>
        {
            var date = monday.AddDays(i);
            var dayStart = date.ToDateTime(TimeOnly.MinValue);
            var dayEnd = dayStart.AddDays(1);
            var dayRows = rows.Where(r => r.Shift.Start >= dayStart && r.Shift.Start < dayEnd).ToList();
            var started = date <= today;
            var cutoff = date < today ? dayEnd : now;

            var worked = dayRows.Where(r => r.In is not null)
                .Select(r => (r, h: Labour.WorkedHoursWithin(r.Shift, r.In!.Value, OpenEnd(r, now), dayStart, cutoff)))
                .ToList();
            var dayRevenue = revenue.Where(d => d.Date == date).ToList();
            var actuals = dayRevenue.Where(d => d.ActualRevenue != null).ToList();

            return new
            {
                Date = date,
                IsToday = date == today,
                RosteredCost = Math.Round(dayRows.Sum(r => Labour.Cost(r.Shift.PaidHours, r.Rate, r.Shift.Start)), 2),
                RosteredHours = Math.Round(dayRows.Sum(r => r.Shift.PaidHours), 2),
                ActualCost = started ? Math.Round(worked.Sum(w => Labour.Cost(w.h, w.r.Rate, w.r.Shift.Start)), 2) : (decimal?)null,
                ActualHours = started ? Math.Round(worked.Sum(w => w.h), 2) : (double?)null,
                ForecastRevenue = dayRevenue.Sum(d => d.ForecastRevenue),
                ActualRevenue = actuals.Count > 0 ? actuals.Sum(d => d.ActualRevenue!.Value) : (decimal?)null,
            };
        }).ToList();

        return Results.Ok(new { WeekStart = monday, Days = days });
    }

    static async Task<IResult> UploadRevenue(RevenueUpload input, RostraDb db, EventHub hub)
    {
        var site = await db.Sites.FirstOrDefaultAsync(s => s.Id == input.SiteId);
        if (site is null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["siteId"] = ["Choose one of your sites."] });
        if (input.Rows is not { Length: > 0 and <= 400 })
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["rows"] = ["Upload between 1 and 400 days at a time."] });
        var bad = input.Rows.FirstOrDefault(r => r.Forecast is < 0 or > 10_000_000 || r.Actual is < 0 or > 10_000_000);
        if (bad is not null)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["rows"] = [$"The amount on {bad.Date:d MMM yyyy} doesn’t look right. Use plain numbers like 4520.50."] });

        var dates = input.Rows.Select(r => r.Date).ToList();
        var existing = await db.SiteDays.Where(d => d.SiteId == site.Id && dates.Contains(d.Date)).ToListAsync();
        foreach (var row in input.Rows)
        {
            var day = existing.FirstOrDefault(d => d.Date == row.Date);
            if (day is null)
            {
                day = new SiteDay { CompanyId = site.CompanyId, SiteId = site.Id, Date = row.Date };
                db.SiteDays.Add(day);
                existing.Add(day);
            }
            if (row.Forecast is { } f) day.ForecastRevenue = f;
            if (row.Actual is { } a) day.ActualRevenue = a;
        }
        await db.SaveChangesAsync();
        hub.Publish(site.CompanyId, "revenue", new { siteId = site.Id });
        return Results.Ok(new { Updated = input.Rows.Length });
    }
}
