using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Rostra.Api.Auth;
using Rostra.Api.Data;
using Rostra.Api.Domain;
using Rostra.Api.Infrastructure;

namespace Rostra.Api.Shifts;

public record WeekInput(int SiteId, DateOnly Week);

/// <summary>Draft → published rosters, copying last week, and the open-shift marketplace.</summary>
public static class PublishingEndpoints
{
    public static void MapPublishing(this WebApplication app)
    {
        var manager = app.MapGroup("").RequireAuthorization("Manager");
        manager.MapPost("/schedule/publish", Publish);
        manager.MapPost("/schedule/unpublish", Unpublish);
        manager.MapPost("/schedule/copy", CopyPreviousWeek);

        var staff = app.MapGroup("").RequireAuthorization("Staff");
        staff.MapGet("/open-shifts", GetOpenShifts);
        staff.MapPost("/shifts/{id:int}/claim", Claim);
    }

    static async Task<(Site? Site, DateTime From)> ResolveAsync(RostraDb db, WeekInput input) =>
        (await db.Sites.FirstOrDefaultAsync(s => s.Id == input.SiteId), Week.StartOf(input.Week).ToDateTime(TimeOnly.MinValue));

    static async Task<IResult> Publish(WeekInput input, ClaimsPrincipal user, RostraDb db, EventHub hub, Inbox inbox)
    {
        var (site, from) = await ResolveAsync(db, input);
        if (site is null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["siteId"] = ["Choose one of your sites."] });
        var to = from.AddDays(7);

        var shifts = await db.Shifts.AsNoTracking().Where(s => s.SiteId == site.Id && s.Start >= from && s.Start < to).ToListAsync();
        if (shifts.Count == 0)
            return Results.Conflict(new { error = "There are no shifts to publish this week. Add some shifts or copy last week first." });

        var row = await db.RosterWeeks.FirstOrDefaultAsync(w => w.SiteId == site.Id && w.Start == from);
        if (row is null)
        {
            row = new RosterWeek { CompanyId = site.CompanyId, SiteId = site.Id, Start = from, End = to };
            db.RosterWeeks.Add(row);
        }
        var firstTime = row.Status != RosterStatus.Published;
        row.Status = RosterStatus.Published;
        row.PublishedAt = await db.NowAsync();
        row.PublishedById = user.StaffId();
        await db.SaveChangesAsync();

        var number = Week.Number(from);
        var notified = 0;
        foreach (var person in shifts.Where(s => s.StaffId != null).GroupBy(s => s.StaffId!.Value))
        {
            var hours = person.Sum(s => s.PaidHours);
            await inbox.SendAsync([person.Key], "roster",
                firstTime ? $"Your Week {number} roster is out" : $"Week {number} roster updated",
                $"{person.Count()} {(person.Count() == 1 ? "shift" : "shifts")}, {hours:0.#} h at {site.Name}.", "/app/my-shifts");
            notified++;
        }
        var open = shifts.Where(s => s.StaffId == null).ToList();
        if (open.Count > 0)
            await inbox.SendAsync(await RosterEndpoints.EligibleForOpenShiftAsync(db, open[0]), "open-shift",
                $"{open.Count} open {(open.Count == 1 ? "shift" : "shifts")} at {site.Name} in Week {number}", "Ask for one from Home.", "/app/home");

        hub.Publish(site.CompanyId, "schedule.changed", new { siteId = site.Id });
        return Results.Ok(new { row.Status, row.PublishedAt, Notified = notified, Open = open.Count });
    }

    static async Task<IResult> Unpublish(WeekInput input, RostraDb db, EventHub hub)
    {
        var (site, from) = await ResolveAsync(db, input);
        if (site is null) return Results.NotFound();
        var row = await db.RosterWeeks.FirstOrDefaultAsync(w => w.SiteId == site.Id && w.Start == from);
        if (row is null || row.Status == RosterStatus.Draft) return Results.NoContent();

        var now = await db.NowAsync();
        if (from <= now)
            return Results.Conflict(new { error = "This week has already started, so staff are working from it. Edit shifts instead; changes notify the people affected." });

        row.Status = RosterStatus.Draft;
        row.PublishedAt = null;
        row.PublishedById = null;
        await db.SaveChangesAsync();
        hub.Publish(site.CompanyId, "schedule.changed", new { siteId = site.Id });
        return Results.NoContent();
    }

    /// <summary>
    /// Copies last week's shifts into an empty week. Anyone who can't work the copied shift
    /// (on leave, unavailable, inactive or already busy) has it turned into an open shift, so nothing is lost.
    /// </summary>
    static async Task<IResult> CopyPreviousWeek(WeekInput input, RostraDb db, EventHub hub)
    {
        var (site, from) = await ResolveAsync(db, input);
        if (site is null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["siteId"] = ["Choose one of your sites."] });
        var to = from.AddDays(7);

        if (await db.Shifts.AnyAsync(s => s.SiteId == site.Id && s.Start >= from && s.Start < to))
            return Results.Conflict(new { error = "This week already has shifts. Copy into an empty week, or add shifts one by one." });

        var source = await db.Shifts.AsNoTracking()
            .Where(s => s.SiteId == site.Id && s.Start >= from.AddDays(-7) && s.Start < from)
            .OrderBy(s => s.Start).ToListAsync();
        if (source.Count == 0)
            return Results.Conflict(new { error = "Last week has no shifts to copy. Add shifts to this week instead." });

        var ids = source.Where(s => s.StaffId != null).Select(s => s.StaffId!.Value).Distinct().ToList();
        var people = await db.Staff.AsNoTracking().Where(s => ids.Contains(s.Id)).ToDictionaryAsync(s => s.Id);
        var firstDay = DateOnly.FromDateTime(from);
        var lastDay = firstDay.AddDays(6);
        var leave = (await db.TimeOff.AsNoTracking()
                .Where(t => t.Status == RequestStatus.Approved && ids.Contains(t.StaffId) && t.From <= lastDay && t.To >= firstDay)
                .ToListAsync())
            .ToLookup(t => t.StaffId);
        var busy = (await db.Shifts.AsNoTracking()
                .Where(s => s.StaffId != null && ids.Contains(s.StaffId.Value) && s.Start < to && s.End > from)
                .ToListAsync())
            .ToLookup(s => s.StaffId!.Value);

        var opened = new List<object>();
        var created = new List<Shift>();
        foreach (var s in source)
        {
            var copy = new Shift
            {
                CompanyId = s.CompanyId, SiteId = s.SiteId, StaffId = s.StaffId,
                Start = s.Start.AddDays(7), End = s.End.AddDays(7), BreakMinutes = s.BreakMinutes,
                Station = s.Station, Notes = s.Notes,
            };
            if (copy.StaffId is int who)
            {
                var reason = !people.TryGetValue(who, out var person) || !person.IsActive ? "no longer on the team"
                    : !person.AvailableDays.HasFlag(Week.DayFlag(copy.Start.DayOfWeek)) ? $"unavailable on {copy.Start.DayOfWeek}s"
                    : leave[who].Any(t => t.From <= DateOnly.FromDateTime(copy.Start) && t.To >= DateOnly.FromDateTime(copy.Start)) ? "on leave"
                    : busy[who].Concat(created.Where(c => c.StaffId == who)).Any(o => o.Start < copy.End && copy.Start < o.End) ? "already working then"
                    : null;
                if (reason is not null)
                {
                    opened.Add(new { Name = person?.Name ?? "Someone", Shift = Week.Label(copy.Start, copy.End), Reason = reason });
                    copy.StaffId = null;
                }
            }
            created.Add(copy);
        }
        db.Shifts.AddRange(created);
        await db.SaveChangesAsync();

        hub.Publish(site.CompanyId, "schedule.changed", new { siteId = site.Id });
        return Results.Ok(new { Copied = created.Count, Opened = opened });
    }

    static async Task<IResult> GetOpenShifts(ClaimsPrincipal user, RostraDb db)
    {
        var now = await db.NowAsync();
        var isManager = user.IsManager();
        var source = isManager ? db.Shifts : db.PublishedShifts;
        var open = await source.AsNoTracking()
            .Where(s => s.StaffId == null && s.Start > now)
            .OrderBy(s => s.Start).Take(30)
            .Select(s => new
            {
                Shift = s, Site = s.Site!.Name,
                ClaimedBy = s.PendingCover != null ? s.PendingCover.Name : null,
            })
            .ToListAsync();

        // Work out, for this person, which open shifts they could actually take.
        var meId = user.StaffId();
        var min = open.Count > 0 ? open.Min(o => o.Shift.Start) : now;
        var max = open.Count > 0 ? open.Max(o => o.Shift.End) : now;
        var firstDay = DateOnly.FromDateTime(min);
        var lastDay = DateOnly.FromDateTime(max);
        var me = await db.Staff
            .Include(s => s.Shifts.Where(o => o.Start < max && o.End > min))
            .Include(s => s.TimeOff.Where(t => t.Status == RequestStatus.Approved && t.From <= lastDay && t.To >= firstDay))
            .FirstAsync(s => s.Id == meId);

        return Results.Ok(open.Select(o => new
        {
            o.Shift.Id, o.Shift.SiteId, o.Site, o.Shift.Start, o.Shift.End, o.Shift.BreakMinutes, o.Shift.Station, o.Shift.Notes,
            o.ClaimedBy, ClaimedByMe = o.Shift.PendingCoverId == meId,
            Reason = o.Shift.PendingCoverId is int claimant && claimant != meId ? "Someone has already asked for it" : me.WhyCannotWork(o.Shift),
        }));
    }

    static async Task<IResult> Claim(int id, ClaimsPrincipal user, RostraDb db, EventHub hub, Inbox inbox)
    {
        var meId = user.StaffId();
        var shift = await db.PublishedShifts.Include(s => s.Site).FirstOrDefaultAsync(s => s.Id == id);
        if (shift is null) return Results.NotFound();
        if (shift.StaffId is not null) return Results.Conflict(new { error = "This shift has already been filled." });
        if (shift.PendingCoverId is int other && other != meId)
            return Results.Conflict(new { error = "Someone has already asked for this shift. You’ll hear if it opens up again." });
        if (shift.PendingCoverId == meId) return Results.Accepted();

        var day = DateOnly.FromDateTime(shift.Start);
        var me = await db.Staff
            .Include(s => s.Shifts.Where(o => o.Start < shift.End && o.End > shift.Start))
            .Include(s => s.TimeOff.Where(t => t.Status == RequestStatus.Approved && t.From <= day && t.To >= day))
            .FirstAsync(s => s.Id == meId);
        if (me.WhyCannotWork(shift) is { } reason) return Results.Conflict(new { error = $"You can’t take this shift: {reason}." });

        shift.PendingCoverId = meId;
        await db.SaveChangesAsync();

        await inbox.SendAsync(await inbox.ManagerIdsAsync(), "open-shift", $"{me.Name} wants to pick up {Week.Label(shift.Start, shift.End)}",
            $"Open shift at {shift.Site!.Name}. Needs your approval.", "/app/swaps", exceptStaffId: meId);
        hub.Publish(shift.CompanyId, "swap.requested", new
        {
            shiftId = shift.Id, siteId = shift.SiteId, from = (string?)null, cover = me.Name, start = shift.Start, end = shift.End, open = true,
        });
        return Results.Accepted();
    }
}
