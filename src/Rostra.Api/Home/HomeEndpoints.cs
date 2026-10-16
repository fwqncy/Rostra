using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Rostra.Api.Auth;
using Rostra.Api.Data;
using Rostra.Api.Domain;
using Rostra.Api.Infrastructure;

namespace Rostra.Api.Home;

public record AvailabilityInput(string[]? Days);
public record LeaveInput(DateOnly? From, DateOnly? To, string? Reason, LeaveType? Type);

/// <summary>The personal "Home" screen: next shift, this week's pay, availability and leave.</summary>
public static class HomeEndpoints
{
    static readonly Days[] Week7 = [Days.Mon, Days.Tue, Days.Wed, Days.Thu, Days.Fri, Days.Sat, Days.Sun];

    public static void MapHome(this WebApplication app)
    {
        var me = app.MapGroup("").RequireAuthorization("Staff");
        me.MapGet("/home", GetHome);
        me.MapPut("/me/availability", SetAvailability);
        me.MapPost("/me/time-off", RequestLeave);
        me.MapDelete("/me/time-off/{id:int}", CancelLeave);
    }

    static async Task<IResult> GetHome(ClaimsPrincipal user, RostraDb db)
    {
        var me = await db.Staff.FirstAsync(s => s.Id == user.StaffId());
        var now = await db.NowAsync();
        var today = DateOnly.FromDateTime(now);

        var next = await db.PublishedShifts
            .Where(s => s.StaffId == me.Id && s.End > now)
            .OrderBy(s => s.Start)
            .Select(s => new
            {
                s.Id, s.Start, s.End, s.BreakMinutes, s.Station, Site = s.Site!.Name,
                s.PendingCoverId, PendingCoverName = s.PendingCover != null ? s.PendingCover.Name : null,
                ClockIn = db.ClockEvents.Where(c => c.ShiftId == s.Id && c.Kind == ClockKind.In).Min(c => (DateTime?)c.At),
            })
            .FirstOrDefaultAsync();

        // This week's pay: finished shifts use clocked time when there is some, the rest use the roster.
        var monday = Week.StartOf(today);
        var from = monday.ToDateTime(TimeOnly.MinValue);
        var shifts = await db.PublishedShifts.AsNoTracking()
            .Where(s => s.StaffId == me.Id && s.Start >= from && s.Start < from.AddDays(7))
            .ToListAsync();
        var ids = shifts.Select(s => s.Id).ToList();
        var punches = await db.ClockEvents
            .Where(c => c.ShiftId != null && ids.Contains(c.ShiftId.Value))
            .Select(c => new { Id = c.ShiftId!.Value, c.Kind, c.At })
            .ToListAsync();

        int pendingCount = 0, completedCount = 0;
        double pendingHours = 0, completedHours = 0;
        decimal pendingPay = 0, completedPay = 0;
        foreach (var s in shifts)
        {
            var clockIn = punches.Where(p => p.Id == s.Id && p.Kind == ClockKind.In).Select(p => (DateTime?)p.At).Min();
            var clockOut = punches.Where(p => p.Id == s.Id && p.Kind == ClockKind.Out).Select(p => (DateTime?)p.At).Max();
            var finished = clockOut is not null || s.End <= now;
            if (finished)
            {
                var hours = clockIn is { } i ? Labour.WorkedHoursWithin(s, i, clockOut ?? s.End, DateTime.MinValue, DateTime.MaxValue) : s.PaidHours;
                completedCount++;
                completedHours += hours;
                completedPay += Labour.Cost(hours, me.HourlyRate, s.Start);
            }
            else
            {
                pendingCount++;
                pendingHours += s.PaidHours;
                pendingPay += Labour.Cost(s.PaidHours, me.HourlyRate, s.Start);
            }
        }

        var leave = await db.TimeOff
            .Where(t => t.StaffId == me.Id && t.To >= today.AddDays(-30))
            .OrderBy(t => t.From)
            .Select(t => new { t.Id, t.From, t.To, t.Reason, t.Type, t.Status })
            .ToListAsync();

        return Results.Ok(new
        {
            Now = now,
            NextShift = next,
            Week = new
            {
                Start = monday, End = monday.AddDays(6), Shifts = shifts.Count,
                Pending = new { Count = pendingCount, Hours = Math.Round(pendingHours, 2), Pay = Math.Round(pendingPay, 2) },
                Completed = new { Count = completedCount, Hours = Math.Round(completedHours, 2), Pay = Math.Round(completedPay, 2) },
            },
            Availability = Week7.Where(d => me.AvailableDays.HasFlag(d)).Select(d => d.ToString()),
            TimeOff = leave,
        });
    }

    static async Task<IResult> SetAvailability(AvailabilityInput input, ClaimsPrincipal user, RostraDb db)
    {
        var days = Days.None;
        foreach (var name in input.Days ?? [])
        {
            if (!Enum.TryParse<Days>(name, true, out var d) || !Week7.Contains(d))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["days"] = [$"“{name}” isn’t a day of the week."] });
            days |= d;
        }
        if (days == Days.None)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["days"] = ["Choose at least one day you can work. For time away, request leave instead."] });

        var me = await db.Staff.FirstAsync(s => s.Id == user.StaffId());
        me.AvailableDays = days;
        await db.SaveChangesAsync();
        return Results.Ok(new { Availability = Week7.Where(d => days.HasFlag(d)).Select(d => d.ToString()) });
    }

    static async Task<IResult> RequestLeave(LeaveInput input, ClaimsPrincipal user, RostraDb db, EventHub hub, Inbox inbox)
    {
        var today = DateOnly.FromDateTime(await db.NowAsync());
        var reason = input.Reason?.Trim() ?? "";
        var errors = new Dictionary<string, string[]>();
        if (input.From is not { } from) errors["from"] = ["Choose your first day off."];
        else if (from < today) errors["from"] = ["Leave can’t start in the past."];
        if (input.To is not { } to) errors["to"] = ["Choose your last day off."];
        else if (input.From is { } f && to < f) errors["to"] = ["The last day must be on or after the first day."];
        else if (input.From is { } f2 && to.DayNumber - f2.DayNumber > 60) errors["to"] = ["Leave can be up to 60 days at a time."];
        if (input.Type is { } type && !Enum.IsDefined(type)) errors["type"] = ["Choose a leave type."];
        if (reason.Length == 0) errors["reason"] = ["Add a short reason, like “Family wedding”."];
        else if (reason.Length > 200) errors["reason"] = ["Keep the reason to 200 characters."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var me = await db.Staff.FirstAsync(s => s.Id == user.StaffId());
        var overlap = await db.TimeOff.AnyAsync(t => t.StaffId == me.Id && t.Status != RequestStatus.Declined
                                                     && t.From <= input.To && t.To >= input.From);
        if (overlap)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["from"] = ["You already have leave in those dates. Cancel it first to change it."] });

        var request = new TimeOffRequest
        {
            CompanyId = me.CompanyId, StaffId = me.Id, From = input.From!.Value, To = input.To!.Value, Reason = reason,
            Type = input.Type ?? LeaveType.Annual,
            // Managers are the approvers, so their own leave is recorded as approved.
            Status = me.Role == StaffRole.Manager ? RequestStatus.Approved : RequestStatus.Pending,
            CreatedAt = await db.NowAsync(),
        };
        db.TimeOff.Add(request);
        await db.SaveChangesAsync();

        var start = request.From.ToDateTime(TimeOnly.MinValue);
        var end = request.To.ToDateTime(TimeOnly.MinValue).AddDays(1);
        var rostered = await db.Shifts.CountAsync(s => s.StaffId == me.Id && s.Start >= start && s.Start < end);

        if (request.Status == RequestStatus.Pending)
            await inbox.SendAsync(await inbox.ManagerIdsAsync(), "leave", $"{me.Name} requested {request.Type.ToString().ToLowerInvariant()} leave",
                $"{request.From:d MMM} – {request.To:d MMM}: {reason}" + (rostered > 0 ? $" Rostered on {rostered} {(rostered == 1 ? "shift" : "shifts")} then." : ""),
                "/app/dashboard?open=timeoff");
        hub.Publish(me.CompanyId, "timeoff", new { id = request.Id, status = request.Status.ToString() });
        return Results.Created($"/me/time-off/{request.Id}", new { request.Id, request.From, request.To, request.Reason, request.Type, request.Status, RosteredShifts = rostered });
    }

    static async Task<IResult> CancelLeave(int id, ClaimsPrincipal user, RostraDb db, EventHub hub)
    {
        var request = await db.TimeOff.FirstOrDefaultAsync(t => t.Id == id && t.StaffId == user.StaffId());
        if (request is null) return Results.NotFound();
        var today = DateOnly.FromDateTime(await db.NowAsync());
        if (request.From <= today)
            return Results.Conflict(new { error = "This leave has already started. Ask your manager to change it." });

        db.TimeOff.Remove(request);
        await db.SaveChangesAsync();
        hub.Publish(request.CompanyId, "timeoff", new { id, status = "Cancelled" });
        return Results.NoContent();
    }
}
