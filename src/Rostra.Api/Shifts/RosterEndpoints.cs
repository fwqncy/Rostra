using System.Linq.Expressions;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Rostra.Api.Auth;
using Rostra.Api.Data;
using Rostra.Api.Domain;
using Rostra.Api.Infrastructure;

namespace Rostra.Api.Shifts;

public record ShiftDto(
    int Id, int SiteId, int StaffId, DateTime Start, DateTime End,
    int BreakMinutes, Station Station, string? Notes, int? PendingCoverId);

public record ShiftInput(
    int StaffId, int SiteId, DateTime Start, DateTime End,
    int BreakMinutes, Station Station, string? Notes);

public static class RosterEndpoints
{
    static readonly Penalties Penalties = Labour.Penalties;

    static readonly Expression<Func<Shift, ShiftDto>> ToDto = s => new ShiftDto(
        s.Id, s.SiteId, s.StaffId, s.Start, s.End, s.BreakMinutes, s.Station, s.Notes, s.PendingCoverId);

    static readonly Func<Shift, ShiftDto> Dto = ToDto.Compile();

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

    static async Task<IResult> GetMe(ClaimsPrincipal user, RostraDb db)
    {
        if (user.Identity?.IsAuthenticated != true) return Results.NoContent();
        var me = await db.Staff.FirstOrDefaultAsync(s => s.Id == user.StaffId());
        if (me is null) return Results.NoContent();

        var company = await db.Companies.FirstAsync(c => c.Id == me.CompanyId);
        var sites = await db.Sites.OrderBy(s => s.Id).Select(s => new { s.Id, s.Name }).ToListAsync();
        return Results.Ok(new
        {
            me.Id, me.Name, me.Email, me.Title, me.Role, me.HomeSiteId,
            Company = new { company.Id, company.Name, company.Slug, company.Accent, company.Currency },
            Sites = sites,
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

        var onRoster = shifts.Select(s => s.StaffId)
            .Concat(shifts.Where(s => s.PendingCoverId != null).Select(s => s.PendingCoverId!.Value))
            .ToHashSet();

        var isManager = user.IsManager();
        var people = await db.Staff
            .Where(s => s.IsActive && (s.HomeSiteId == site.Id || onRoster.Contains(s.Id)))
            .OrderBy(s => s.Role == StaffRole.Manager ? 0 : 1).ThenBy(s => s.Id)
            .Select(s => new
            {
                s.Id, s.Name, s.Title, s.Role, s.Stations, s.PrimaryStation, s.HomeSiteId,
                // Pay rates are manager-only.
                HourlyRate = isManager ? s.HourlyRate : (decimal?)null,
            })
            .ToListAsync();

        return Results.Ok(new
        {
            Site = new { site.Id, site.Name, WeeklyBudget = isManager ? site.WeeklyBudget : (decimal?)null },
            WeekStart = monday,
            Staff = people,
            Shifts = shifts,
            Penalties,
        });
    }

    static async Task<IResult> GetMyShifts(ClaimsPrincipal user, RostraDb db)
    {
        var me = user.StaffId();
        var since = (await db.NowAsync()).Date;
        var shifts = await db.Shifts
            .Where(s => (s.StaffId == me || s.PendingCoverId == me) && s.End >= since)
            .OrderBy(s => s.Start).Take(40)
            .Select(s => new
            {
                s.Id, s.SiteId, Site = s.Site!.Name, s.StaffId, StaffName = s.Staff!.Name,
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
                From = new { s.Staff!.Id, s.Staff.Name, HourlyRate = isManager ? s.Staff.HourlyRate : (decimal?)null },
                Cover = new { s.PendingCover!.Id, s.PendingCover.Name, HourlyRate = isManager ? s.PendingCover.HourlyRate : (decimal?)null },
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

    static async Task<IResult> ApproveSwap(int id, RostraDb db, EventHub hub)
    {
        var shift = await db.Shifts
            .Include(s => s.Staff)
            .Include(s => s.PendingCover)
            .FirstOrDefaultAsync(s => s.Id == id);
        if (shift is null) return Results.NotFound();
        if (shift.PendingCover is not { } cover)
            return Results.Conflict(new { error = "This swap was already resolved. Refresh to see the latest roster." });

        // Re-check at approval time: the cover may have picked up another shift since asking.
        if (cover.WhyCannotWork(shift) is { } reason)
            return Results.Conflict(new { error = $"{cover.Name} can’t take this shift any more: {reason}." });

        var from = shift.Staff!.Name;
        shift.Staff = cover;
        shift.PendingCover = null;
        shift.PendingCoverId = null;
        await db.SaveChangesAsync();

        hub.Publish(shift.CompanyId, "swap.resolved", new { shiftId = shift.Id, siteId = shift.SiteId, approved = true, from, cover = cover.Name });
        return Results.Ok(Dto(shift));
    }

    static async Task<IResult> DeclineSwap(int id, ClaimsPrincipal user, RostraDb db, EventHub hub)
    {
        var shift = await db.Shifts.Include(s => s.Staff).FirstOrDefaultAsync(s => s.Id == id);
        if (shift is null) return Results.NotFound();

        // Managers decline, the asker cancels, or the person asked says no.
        var me = user.StaffId();
        if (!user.IsManager() && shift.StaffId != me && shift.PendingCoverId != me) return Results.Forbid();
        if (shift.PendingCoverId is null) return Results.NoContent();

        shift.PendingCoverId = null;
        await db.SaveChangesAsync();

        hub.Publish(shift.CompanyId, "swap.resolved", new
        {
            shiftId = shift.Id, siteId = shift.SiteId, approved = false,
            from = shift.Staff!.Name, cancelled = shift.StaffId == me,
        });
        return Results.NoContent();
    }

    static async Task<IResult> CreateShift(ShiftInput input, RostraDb db, EventHub hub)
    {
        if (await Validate(input, null, db) is { } problem) return problem;

        var shift = new Shift { CompanyId = db.CompanyId!.Value };
        Apply(shift, input);
        db.Shifts.Add(shift);
        await db.SaveChangesAsync();

        hub.Publish(shift.CompanyId, "schedule.changed", new { siteId = shift.SiteId });
        return Results.Created($"/shifts/{shift.Id}", Dto(shift));
    }

    static async Task<IResult> UpdateShift(int id, ShiftInput input, RostraDb db, EventHub hub)
    {
        var shift = await db.Shifts.FirstOrDefaultAsync(s => s.Id == id);
        if (shift is null) return Results.NotFound();
        if (await Validate(input, id, db) is { } problem) return problem;

        // A pending cover was agreed for the old time and person; don't silently carry it over.
        if (shift.StaffId != input.StaffId || shift.Start != input.Start || shift.End != input.End)
            shift.PendingCoverId = null;

        var oldSite = shift.SiteId;
        Apply(shift, input);
        await db.SaveChangesAsync();

        hub.Publish(shift.CompanyId, "schedule.changed", new { siteId = shift.SiteId });
        if (oldSite != shift.SiteId) hub.Publish(shift.CompanyId, "schedule.changed", new { siteId = oldSite });
        return Results.Ok(Dto(shift));
    }

    static async Task<IResult> DeleteShift(int id, RostraDb db, EventHub hub)
    {
        var shift = await db.Shifts.FirstOrDefaultAsync(s => s.Id == id);
        if (shift is null) return Results.NoContent();

        db.Shifts.Remove(shift);
        await db.SaveChangesAsync();
        hub.Publish(shift.CompanyId, "schedule.changed", new { siteId = shift.SiteId });
        return Results.NoContent();
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
            await foreach (var e in hub.Subscribe(user.CompanyId()!.Value, ct))
            {
                var frame = e == ServerEvent.Ping
                    ? ": ping\n\n"
                    : $"event: {e.Type}\ndata: {System.Text.Json.JsonSerializer.Serialize(e.Data)}\n\n";
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
        var person = await db.Staff.FirstOrDefaultAsync(s => s.Id == input.StaffId && s.IsActive);
        if (person is null) errors["staffId"] = ["Choose someone from your team."];
        if (!await db.Sites.AnyAsync(s => s.Id == input.SiteId)) errors["siteId"] = ["Choose one of your sites."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var clash = await db.Shifts.Include(s => s.Site)
            .Where(s => s.StaffId == input.StaffId && s.Id != id && s.Start < input.End && input.Start < s.End)
            .FirstOrDefaultAsync();
        if (clash is not null)
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["start"] = [$"{person!.Name} is already working {Week.Compact(clash.Start, clash.End)} at {clash.Site!.Name}."],
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
        var owner = await db.Shifts.Where(s => s.Id == id).Select(s => (int?)s.StaffId).FirstOrDefaultAsync();
        if (owner is null) return Results.NotFound();
        return owner == user.StaffId() ? await next(ctx) : Results.Forbid();
    }
}
