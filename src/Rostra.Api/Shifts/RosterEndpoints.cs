using System.Linq.Expressions;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Rostra.Api.Auth;
using Rostra.Api.Data;
using Rostra.Api.Domain;
using Rostra.Api.Infrastructure;

namespace Rostra.Api.Shifts;

public record ShiftDto(
    int Id, int SiteId, int? StaffId, DateTime Start, DateTime End,
    int BreakMinutes, Station Station, string? Notes, int? PendingCoverId);

/// <summary>A shift to create or change. A null <see cref="StaffId"/> makes it an open shift.</summary>
public record ShiftInput(
    int? StaffId, int SiteId, DateTime Start, DateTime End,
    int BreakMinutes, Station Station, string? Notes);

public record SwapPerson(int Id, string Name, decimal? HourlyRate);

public static class RosterEndpoints
{
    static readonly Penalties Penalties = Labour.Penalties;

    static readonly Expression<Func<Shift, ShiftDto>> ToDto = s => new ShiftDto(
        s.Id, s.SiteId, s.StaffId, s.Start, s.End, s.BreakMinutes, s.Station, s.Notes, s.PendingCoverId);

    internal static readonly Func<Shift, ShiftDto> Dto = ToDto.Compile();

    public static void MapRoster(this WebApplication app)
    {
        var staff = app.MapGroup("").RequireAuthorization("Staff");
        var manager = app.MapGroup("").RequireAuthorization("Manager");

        // Anonymous-friendly so the SPA can ask "am I signed in?" without a 401: 204 means no.
        app.MapGet("/me", GetMe).AllowAnonymous();
        staff.MapGet("/my-shifts", GetMyShifts);
        staff.MapGet("/swaps", GetSwaps);
        staff.MapGet("/shifts/{id:int}/cover-options", GetCoverOptions).AddEndpointFilter<OwnShiftFilter>();
        staff.MapPost("/shifts/{id:int}/swap/decline", DeclineSwap);
        staff.MapGet("/events", StreamEvents);

        manager.MapGet("/schedule", GetSchedule);
        manager.MapPost("/shifts", CreateShift);
        manager.MapPut("/shifts/{id:int}", UpdateShift);
        manager.MapDelete("/shifts/{id:int}", DeleteShift);
        manager.MapPost("/shifts/{id:int}/swap/approve", ApproveSwap);
    }

    internal static object? ParseJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<JsonElement>(json); } catch (JsonException) { return null; }
    }

    static async Task<IResult> GetMe(ClaimsPrincipal user, RostraDb db)
    {
        if (user.Identity?.IsAuthenticated != true) return Results.NoContent();
        var me = await db.Staff.FirstOrDefaultAsync(s => s.Id == user.StaffId());
        if (me is null) return Results.NoContent();

        var company = await db.Companies.FirstAsync(c => c.Id == me.CompanyId);
        var sites = await db.Sites.OrderBy(s => s.Id).Select(s => new { s.Id, s.Name }).ToListAsync();
        var unread = await db.Notifications.CountAsync(n => n.StaffId == me.Id && n.ReadAt == null);
        return Results.Ok(new
        {
            me.Id, me.Name, me.Email, me.Title, me.Role, me.HomeSiteId,
            Appearance = ParseJson(me.Appearance),
            Company = new
            {
                company.Id, company.Name, company.Slug, company.Accent, company.Currency, company.TimeZone,
                Appearance = ParseJson(company.DefaultAppearance),
            },
            Sites = sites,
            UnreadNotifications = unread,
        });
    }

    static async Task<IResult> GetSchedule(int? siteId, DateOnly? week, ClaimsPrincipal user, RostraDb db)
    {
        var me = await db.Staff.FirstAsync(s => s.Id == user.StaffId());
        var site = await db.Sites.FirstOrDefaultAsync(s => s.Id == (siteId ?? me.HomeSiteId))
                   ?? await db.Sites.OrderBy(s => s.Id).FirstAsync();

        var monday = Week.StartOf(week ?? DateOnly.FromDateTime(await db.NowAsync()));
        var from = monday.ToDateTime(TimeOnly.MinValue);
        var to = from.AddDays(7);

        var shifts = await db.Shifts
            .Where(s => s.SiteId == site.Id && s.Start < to && s.End > from)
            .OrderBy(s => s.Start).Select(ToDto).ToListAsync();

        var onRoster = shifts.Where(s => s.StaffId != null).Select(s => s.StaffId!.Value)
            .Concat(shifts.Where(s => s.PendingCoverId != null).Select(s => s.PendingCoverId!.Value))
            .ToHashSet();

        var people = await db.Staff
            .Where(s => s.IsActive && (s.HomeSiteId == site.Id || onRoster.Contains(s.Id)))
            .OrderBy(s => s.Role == StaffRole.Manager ? 0 : 1).ThenBy(s => s.Id)
            .Select(s => new { s.Id, s.Name, s.Title, s.Role, s.Stations, s.PrimaryStation, s.HomeSiteId, s.HourlyRate })
            .ToListAsync();

        // Compliance needs each person's shifts either side of the week and at every site.
        var ids = onRoster.ToList();
        var span = await db.Shifts.AsNoTracking()
            .Where(s => s.StaffId != null && ids.Contains(s.StaffId.Value) && s.Start >= from.AddDays(-1) && s.Start < to.AddDays(1))
            .ToListAsync();
        var staffById = await db.Staff.AsNoTracking().Where(s => ids.Contains(s.Id)).ToDictionaryAsync(s => s.Id);
        var firstDay = monday;
        var lastDay = monday.AddDays(6);
        var leave = (await db.TimeOff.AsNoTracking()
                .Where(t => t.Status == RequestStatus.Approved && ids.Contains(t.StaffId) && t.From <= lastDay && t.To >= firstDay)
                .ToListAsync())
            .ToLookup(t => t.StaffId);
        var here = shifts.Select(s => s.Id).ToHashSet();
        var warnings = Compliance.Check(span, from, staffById, leave).Where(w => here.Contains(w.ShiftId)).ToList();

        var weekRow = await db.RosterWeeks.FirstOrDefaultAsync(w => w.SiteId == site.Id && w.Start == from);
        var publishedBy = weekRow?.PublishedById is int by
            ? await db.Staff.Where(s => s.Id == by).Select(s => s.Name).FirstOrDefaultAsync()
            : null;
        // SQLite can't average decimals, so average in memory (it's one small column).
        var rates = await db.Staff.Where(s => s.IsActive && s.Role == StaffRole.Staff).Select(s => s.HourlyRate).ToListAsync();
        var estimatedRate = rates.Count > 0 ? rates.Average() : 30m;

        return Results.Ok(new
        {
            Site = new { site.Id, site.Name, site.WeeklyBudget },
            WeekStart = monday,
            Week = new
            {
                Number = Week.Number(from),
                Status = weekRow?.Status ?? RosterStatus.Draft,
                weekRow?.PublishedAt,
                PublishedBy = publishedBy,
            },
            Staff = people,
            Shifts = shifts,
            Warnings = warnings,
            // Open shifts are costed at the team's average rate until someone takes them.
            EstimatedRate = Math.Round(estimatedRate, 2),
            Penalties,
        });
    }

    static async Task<IResult> GetMyShifts(ClaimsPrincipal user, RostraDb db)
    {
        var me = user.StaffId();
        var since = (await db.NowAsync()).Date;
        var shifts = await db.PublishedShifts
            .Where(s => (s.StaffId == me || s.PendingCoverId == me) && s.End >= since)
            .OrderBy(s => s.Start).Take(40)
            .Select(s => new
            {
                s.Id, s.SiteId, Site = s.Site!.Name, s.StaffId, StaffName = s.Staff != null ? s.Staff.Name : null,
                IsOpen = s.StaffId == null,
                s.Start, s.End, s.BreakMinutes, s.Station, s.Notes,
                s.PendingCoverId, PendingCoverName = s.PendingCover != null ? s.PendingCover.Name : null,
                ClockIn = db.ClockEvents.Where(c => c.ShiftId == s.Id && c.Kind == ClockKind.In).Min(c => (DateTime?)c.At),
                ClockOut = db.ClockEvents.Where(c => c.ShiftId == s.Id && c.Kind == ClockKind.Out).Max(c => (DateTime?)c.At),
            })
            .ToListAsync();
        return Results.Ok(shifts);
    }

    static async Task<IResult> GetSwaps(ClaimsPrincipal user, RostraDb db)
    {
        var me = user.StaffId();
        var isManager = user.IsManager();
        var query = db.Shifts.Where(s => s.PendingCoverId != null);
        if (!isManager) query = query.Where(s => s.StaffId == me || s.PendingCoverId == me);

        var swaps = await query.OrderBy(s => s.Start)
            .Select(s => new
            {
                ShiftId = s.Id, s.SiteId, Site = s.Site!.Name, s.Start, s.End, s.BreakMinutes, s.Station,
                IsOpen = s.StaffId == null,
                From = s.Staff == null ? null : new SwapPerson(s.Staff.Id, s.Staff.Name, isManager ? s.Staff.HourlyRate : null),
                Cover = new SwapPerson(s.PendingCover!.Id, s.PendingCover.Name, isManager ? s.PendingCover.HourlyRate : null),
            })
            .ToListAsync();
        return Results.Ok(new { Swaps = swaps, Penalties });
    }

    static async Task<IResult> GetCoverOptions(int id, ClaimsPrincipal user, RostraDb db)
    {
        var shift = await db.Shifts.FirstOrDefaultAsync(s => s.Id == id);
        if (shift is null) return Results.NotFound();

        // Only load shifts and leave that could clash, then let the domain decide.
        var day = DateOnly.FromDateTime(shift.Start);
        var colleagues = await db.Staff
            .Include(s => s.HomeSite)
            .Include(s => s.Shifts.Where(o => o.Start < shift.End && o.End > shift.Start))
            .Include(s => s.TimeOff.Where(t => t.Status == RequestStatus.Approved && t.From <= day && t.To >= day))
            .Where(s => s.IsActive && s.Id != shift.StaffId)
            .ToListAsync();

        var isManager = user.IsManager();
        var options = colleagues
            .Select(c => new
            {
                c.Id, c.Name, c.Title, Site = c.HomeSite!.Name,
                SameSite = c.HomeSiteId == shift.SiteId,
                Reason = c.WhyCannotWork(shift),
                HourlyRate = isManager ? c.HourlyRate : (decimal?)null,
            })
            .OrderBy(o => o.Reason != null).ThenBy(o => !o.SameSite).ThenBy(o => o.Name)
            .Select(o => new { o.Id, o.Name, o.Title, o.Site, Available = o.Reason == null, o.Reason, o.HourlyRate })
            .ToList();
        return Results.Ok(options);
    }

    static async Task<IResult> ApproveSwap(int id, RostraDb db, EventHub hub, Inbox inbox)
    {
        var shift = await db.Shifts
            .Include(s => s.Staff)
            .Include(s => s.PendingCover)
            .Include(s => s.Site)
            .FirstOrDefaultAsync(s => s.Id == id);
        if (shift is null) return Results.NotFound();
        if (shift.PendingCover is not { } cover)
            return Results.Conflict(new { error = "This request was already resolved. Refresh to see the latest roster." });

        // Re-check at approval time: the cover may have picked up another shift since asking.
        if (cover.WhyCannotWork(shift) is { } reason)
            return Results.Conflict(new { error = $"{cover.Name} can’t take this shift any more: {reason}." });

        var from = shift.Staff;
        shift.Staff = cover;
        shift.PendingCover = null;
        shift.PendingCoverId = null;
        await db.SaveChangesAsync();

        var label = Week.Label(shift.Start, shift.End);
        if (from is not null)
        {
            await inbox.SendAsync([from.Id], "swap", $"{cover.Name} is covering your {label} shift", "Approved by your manager.", "/app/my-shifts");
            await inbox.SendAsync([cover.Id], "swap", $"You’re covering {from.Name}’s {label} shift", $"At {shift.Site!.Name}. It’s in My Shifts.", "/app/my-shifts");
        }
        else
        {
            await inbox.SendAsync([cover.Id], "open-shift", $"You picked up {label}", $"At {shift.Site!.Name}. It’s in My Shifts.", "/app/my-shifts");
        }

        hub.Publish(shift.CompanyId, "swap.resolved", new { shiftId = shift.Id, siteId = shift.SiteId, approved = true, from = from?.Name, cover = cover.Name, open = from is null });
        return Results.Ok(Dto(shift));
    }

    static async Task<IResult> DeclineSwap(int id, ClaimsPrincipal user, RostraDb db, EventHub hub, Inbox inbox)
    {
        var shift = await db.Shifts.Include(s => s.Staff).Include(s => s.PendingCover).FirstOrDefaultAsync(s => s.Id == id);
        if (shift is null) return Results.NotFound();

        // Managers decline, the asker cancels, or the person asked says no.
        var me = user.StaffId();
        if (!user.IsManager() && shift.StaffId != me && shift.PendingCoverId != me) return Results.Forbid();
        if (shift.PendingCover is not { } cover) return Results.NoContent();

        shift.PendingCoverId = null;
        shift.PendingCover = null;
        await db.SaveChangesAsync();

        var label = Week.Label(shift.Start, shift.End);
        if (shift.Staff is not { } owner)
        {
            if (me != cover.Id)
                await inbox.SendAsync([cover.Id], "open-shift", $"Your request to pick up {label} wasn’t approved", "The shift stays open.", "/app/home");
        }
        else if (me == owner.Id)
            await inbox.SendAsync([cover.Id], "swap", $"{owner.Name} no longer needs cover for {label}", null, "/app/swaps");
        else if (me == cover.Id)
            await inbox.SendAsync([owner.Id], "swap", $"{cover.Name} can’t cover your {label} shift", "Ask someone else from My Shifts.", "/app/my-shifts");
        else
            await inbox.SendAsync([owner.Id, cover.Id], "swap", $"Swap declined: {label}", $"{owner.Name} stays on this shift.", "/app/my-shifts");

        hub.Publish(shift.CompanyId, "swap.resolved", new
        {
            shiftId = shift.Id, siteId = shift.SiteId, approved = false,
            from = shift.Staff?.Name, cancelled = shift.StaffId == me,
        });
        return Results.NoContent();
    }

    internal static Task<bool> IsPublishedAsync(RostraDb db, int siteId, DateTime start) =>
        db.RosterWeeks.AnyAsync(w => w.SiteId == siteId && w.Status == RosterStatus.Published && w.Start <= start && start < w.End);

    static async Task<IResult> CreateShift(ShiftInput input, RostraDb db, EventHub hub, Inbox inbox)
    {
        if (await Validate(input, null, db) is { } problem) return problem;

        var shift = new Shift { CompanyId = db.CompanyId!.Value };
        Apply(shift, input);
        db.Shifts.Add(shift);
        await db.SaveChangesAsync();

        if (await IsPublishedAsync(db, shift.SiteId, shift.Start))
        {
            var site = await db.Sites.Where(s => s.Id == shift.SiteId).Select(s => s.Name).FirstAsync();
            var label = Week.Label(shift.Start, shift.End);
            if (shift.StaffId is int who)
                await inbox.SendAsync([who], "shift", $"New shift: {label}", $"At {site}.", "/app/my-shifts");
            else
                await inbox.SendAsync(await EligibleForOpenShiftAsync(db, shift), "open-shift", $"Open shift up for grabs: {label}", $"At {site}. Ask for it from Home.", "/app/home");
        }

        hub.Publish(shift.CompanyId, "schedule.changed", new { siteId = shift.SiteId });
        return Results.Created($"/shifts/{shift.Id}", Dto(shift));
    }

    static async Task<IResult> UpdateShift(int id, ShiftInput input, RostraDb db, EventHub hub, Inbox inbox)
    {
        var shift = await db.Shifts.FirstOrDefaultAsync(s => s.Id == id);
        if (shift is null) return Results.NotFound();
        if (await Validate(input, id, db) is { } problem) return problem;

        var before = new { shift.StaffId, shift.Start, shift.End, shift.SiteId };
        var wasPublished = await IsPublishedAsync(db, shift.SiteId, shift.Start);

        // A pending cover was agreed for the old time and person; don't silently carry it over.
        if (shift.StaffId != input.StaffId || shift.Start != input.Start || shift.End != input.End)
            shift.PendingCoverId = null;

        Apply(shift, input);
        await db.SaveChangesAsync();

        var nowPublished = await IsPublishedAsync(db, shift.SiteId, shift.Start);
        if (wasPublished || nowPublished)
        {
            var oldLabel = Week.Label(before.Start, before.End);
            var newLabel = Week.Label(shift.Start, shift.End);
            var moved = before.Start != shift.Start || before.End != shift.End || before.SiteId != shift.SiteId;
            if (before.StaffId == shift.StaffId && shift.StaffId is int same && moved)
                await inbox.SendAsync([same], "shift", "Your shift changed", $"{oldLabel} → {newLabel}", "/app/my-shifts");
            else if (before.StaffId != shift.StaffId)
            {
                if (before.StaffId is int old) await inbox.SendAsync([old], "shift", $"You’re no longer on {oldLabel}", null, "/app/my-shifts");
                if (shift.StaffId is int added) await inbox.SendAsync([added], "shift", $"New shift: {newLabel}", null, "/app/my-shifts");
            }
        }

        hub.Publish(shift.CompanyId, "schedule.changed", new { siteId = shift.SiteId });
        if (before.SiteId != shift.SiteId) hub.Publish(shift.CompanyId, "schedule.changed", new { siteId = before.SiteId });
        return Results.Ok(Dto(shift));
    }

    static async Task<IResult> DeleteShift(int id, RostraDb db, EventHub hub, Inbox inbox)
    {
        var shift = await db.Shifts.FirstOrDefaultAsync(s => s.Id == id);
        if (shift is null) return Results.NoContent();

        var published = await IsPublishedAsync(db, shift.SiteId, shift.Start);
        var punches = await db.ClockEvents.Where(c => c.ShiftId == id).ToListAsync();
        if (punches.Count > 0)
            return Results.Conflict(new { error = "This shift has clock-ins recorded, so it’s part of a timesheet. Edit it instead of deleting it." });

        db.Shifts.Remove(shift);
        await db.SaveChangesAsync();
        if (published && shift.StaffId is int who)
            await inbox.SendAsync([who], "shift", $"Shift removed: {Week.Label(shift.Start, shift.End)}", null, "/app/my-shifts");
        hub.Publish(shift.CompanyId, "schedule.changed", new { siteId = shift.SiteId });
        return Results.NoContent();
    }

    /// <summary>Home-site staff who could take an open shift: available that day and trained for the station.</summary>
    internal static async Task<List<int>> EligibleForOpenShiftAsync(RostraDb db, Shift shift)
    {
        var day = Week.DayFlag(shift.Start.DayOfWeek);
        var people = await db.Staff
            .Where(s => s.IsActive && s.HomeSiteId == shift.SiteId)
            .Select(s => new { s.Id, s.AvailableDays, s.Stations })
            .ToListAsync();
        return people.Where(p => p.AvailableDays.HasFlag(day) && p.Stations.HasFlag(shift.Station)).Select(p => p.Id).ToList();
    }

    static async Task StreamEvents(HttpContext ctx, ClaimsPrincipal user, EventHub hub, CancellationToken ct)
    {
        ctx.Response.Headers.ContentType = "text/event-stream";
        ctx.Response.Headers.CacheControl = "no-cache, no-transform";
        ctx.Response.Headers["X-Accel-Buffering"] = "no";
        await ctx.Response.WriteAsync(": connected\n\n", ct);
        await ctx.Response.Body.FlushAsync(ct);

        try
        {
            await foreach (var e in hub.Subscribe(user.CompanyId()!.Value, user.StaffId(), ct))
            {
                var frame = e == ServerEvent.Ping
                    ? ": ping\n\n"
                    : $"event: {e.Type}\ndata: {JsonSerializer.Serialize(e.Data)}\n\n";
                await ctx.Response.WriteAsync(frame, ct);
                await ctx.Response.Body.FlushAsync(ct);
            }
        }
        catch (OperationCanceledException) { /* browser went away */ }
    }

    static async Task<IResult?> Validate(ShiftInput input, int? id, RostraDb db)
    {
        var errors = new Dictionary<string, string[]>();
        var length = input.End - input.Start;
        if (length <= TimeSpan.Zero) errors["end"] = ["End time must be after the start time."];
        else if (length > TimeSpan.FromHours(14)) errors["end"] = ["Shifts can be up to 14 hours long."];
        if (input.BreakMinutes is < 0 or > 120) errors["breakMinutes"] = ["Breaks can be 0 to 120 minutes."];
        else if (length > TimeSpan.Zero && TimeSpan.FromMinutes(input.BreakMinutes) >= length)
            errors["breakMinutes"] = ["The break must be shorter than the shift."];
        if (input.Station is Station.None || !Enum.IsDefined(input.Station)) errors["station"] = ["Choose a station."];
        if ((input.Notes?.Length ?? 0) > 280) errors["notes"] = ["Keep notes to 280 characters."];

        // Query filters make these tenant checks: another company's IDs simply don't exist.
        Staff? person = null;
        if (input.StaffId is int staffId)
        {
            person = await db.Staff.FirstOrDefaultAsync(s => s.Id == staffId && s.IsActive);
            if (person is null) errors["staffId"] = ["Choose someone from your team, or leave it as an open shift."];
        }
        if (!await db.Sites.AnyAsync(s => s.Id == input.SiteId)) errors["siteId"] = ["Choose one of your sites."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);
        if (person is null) return null;

        var clash = await db.Shifts.Include(s => s.Site)
            .Where(s => s.StaffId == person.Id && s.Id != id && s.Start < input.End && input.Start < s.End)
            .FirstOrDefaultAsync();
        if (clash is not null)
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["start"] = [$"{person.Name} is already working {Week.Compact(clash.Start, clash.End)} at {clash.Site!.Name}."],
            });
        return null;
    }

    static void Apply(Shift shift, ShiftInput input)
    {
        shift.StaffId = input.StaffId;
        shift.SiteId = input.SiteId;
        shift.Start = input.Start;
        shift.End = input.End;
        shift.BreakMinutes = input.BreakMinutes;
        shift.Station = input.Station;
        shift.Notes = string.IsNullOrWhiteSpace(input.Notes) ? null : input.Notes.Trim();
    }
}

/// <summary>Staff may only act on their own shifts; managers may act on any.</summary>
public sealed class OwnShiftFilter(RostraDb db) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var user = ctx.HttpContext.User;
        if (user.IsManager()) return await next(ctx);

        var id = ctx.Arguments.OfType<int>().First();
        var owner = await db.Shifts.Where(s => s.Id == id).Select(s => s.StaffId).FirstOrDefaultAsync();
        if (owner is null) return Results.NotFound();
        return owner == user.StaffId() ? await next(ctx) : Results.Forbid();
    }
}
