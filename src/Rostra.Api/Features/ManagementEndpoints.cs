using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Rostra.Api.Auth;
using Rostra.Api.Data;
using Rostra.Api.Domain;
using Rostra.Api.Infrastructure;

namespace Rostra.Api.Features;

public record TeamMemberInput(
    string? Name, string? Email, string? Title, StaffRole Role, int HomeSiteId, decimal HourlyRate,
    string[]? Stations, Station PrimaryStation, string? Certification, DateOnly? CertificationExpires);
public record ApproveTimesheetsInput(int[] StaffIds, DateOnly Week);
public record UnapproveTimesheetInput(int StaffId, DateOnly Week);
public record PunchEditInput(DateTime? ClockIn, DateTime? ClockOut);

/// <summary>Managing the team, and turning clocked hours into approved timesheets for payroll.</summary>
public static class ManagementEndpoints
{
    public static void MapManagement(this WebApplication app)
    {
        var manager = app.MapGroup("").RequireAuthorization("Manager");
        manager.MapGet("/team", GetTeam);
        manager.MapPost("/team", AddMember);
        manager.MapPut("/team/{id:int}", UpdateMember);
        manager.MapPost("/team/{id:int}/deactivate", Deactivate);
        manager.MapPost("/team/{id:int}/reactivate", Reactivate);
        manager.MapPost("/team/{id:int}/reset-password", ResetPassword);

        manager.MapGet("/timesheets", GetTimesheets);
        manager.MapPost("/timesheets/approve", Approve);
        manager.MapPost("/timesheets/unapprove", Unapprove);
        manager.MapPut("/shifts/{id:int}/punches", EditPunches);
        manager.MapGet("/timesheets/export", Export);
    }

    /* ----------------------------- Team ----------------------------- */
    static async Task<IResult> GetTeam(RostraDb db)
    {
        var now = await db.NowAsync();
        var monday = Week.StartOf(DateOnly.FromDateTime(now)).ToDateTime(TimeOnly.MinValue);
        var team = await db.Staff.OrderBy(s => !s.IsActive).ThenBy(s => s.Role).ThenBy(s => s.Name)
            .Select(s => new
            {
                s.Id, s.Name, s.Email, s.Title, s.Role, s.HomeSiteId, Site = s.HomeSite!.Name, s.HourlyRate,
                s.Stations, s.PrimaryStation, s.AvailableDays, s.Certification, s.CertificationExpires, s.IsActive,
                WeekShifts = db.Shifts.Where(x => x.StaffId == s.Id && x.Start >= monday && x.Start < monday.AddDays(7))
                    .Select(x => new { x.Start, x.End, x.BreakMinutes }).ToList(),
            })
            .ToListAsync();
        return Results.Ok(team.Select(s => new
        {
            s.Id, s.Name, s.Email, s.Title, s.Role, s.HomeSiteId, s.Site, s.HourlyRate, s.Stations, s.PrimaryStation,
            s.AvailableDays, s.Certification, s.CertificationExpires, s.IsActive,
            HoursThisWeek = Math.Round(s.WeekShifts.Sum(x => Math.Max(0, (x.End - x.Start).TotalHours - x.BreakMinutes / 60.0)), 1),
        }));
    }

    static Station ParseStations(string[]? names) =>
        (names ?? []).Aggregate(Station.None, (all, n) => Enum.TryParse<Station>(n, true, out var s) && Enum.IsDefined(s) ? all | s : all);

    static async Task<Dictionary<string, string[]>> ValidateMember(TeamMemberInput input, int? id, RostraDb db)
    {
        var errors = new Dictionary<string, string[]>();
        var name = input.Name?.Trim() ?? "";
        var email = input.Email?.Trim().ToLowerInvariant() ?? "";
        if (name.Length == 0) errors["name"] = ["Enter their name."];
        else if (name.Length > 80) errors["name"] = ["Keep the name to 80 characters."];
        if (email.Length == 0 || !email.Contains('@') || email.Length > 120) errors["email"] = ["Enter a work email, like name@venue.com."];
        else if (await db.Staff.IgnoreQueryFilters().AnyAsync(s => s.Email == email && s.Id != id))
            errors["email"] = ["Someone already signs in with that email."];
        if ((input.Title?.Trim().Length ?? 0) is 0 or > 60) errors["title"] = ["Add a job title, like Chef or Floor Staff."];
        if (!await db.Sites.AnyAsync(s => s.Id == input.HomeSiteId)) errors["homeSiteId"] = ["Choose their home site."];
        if (input.HourlyRate is < 15 or > 500) errors["hourlyRate"] = ["Enter an hourly rate between $15 and $500."];
        var stations = ParseStations(input.Stations);
        if (stations == Station.None) errors["stations"] = ["Choose at least one station they can work."];
        else if (!stations.HasFlag(input.PrimaryStation) || input.PrimaryStation == Station.None)
            errors["primaryStation"] = ["Their main station must be one they’re trained on."];
        if (!Enum.IsDefined(input.Role)) errors["role"] = ["Choose Staff or Manager."];
        return errors;
    }

    static void Apply(Staff s, TeamMemberInput input)
    {
        s.Name = input.Name!.Trim();
        s.Email = input.Email!.Trim().ToLowerInvariant();
        s.Title = input.Title!.Trim();
        s.Role = input.Role;
        s.HomeSiteId = input.HomeSiteId;
        s.HourlyRate = Math.Round(input.HourlyRate, 2);
        s.Stations = ParseStations(input.Stations);
        s.PrimaryStation = input.PrimaryStation;
        s.Certification = string.IsNullOrWhiteSpace(input.Certification) ? null : input.Certification.Trim();
        s.CertificationExpires = input.CertificationExpires;
    }

    /// <summary>Readable one-time passwords: no 0/O or 1/l confusion when read aloud.</summary>
    static string TempPassword()
    {
        const string alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
        return string.Concat(Enumerable.Range(0, 12).Select(_ => alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)]));
    }

    static async Task<IResult> AddMember(TeamMemberInput input, RostraDb db, IPasswordHasher<Staff> hasher)
    {
        var errors = await ValidateMember(input, null, db);
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var member = new Staff { Name = "", Email = "", CompanyId = db.CompanyId!.Value };
        Apply(member, input);
        var password = TempPassword();
        member.PasswordHash = hasher.HashPassword(member, password);
        db.Staff.Add(member);
        await db.SaveChangesAsync();
        return Results.Created($"/team/{member.Id}", new { member.Id, member.Name, member.Email, TemporaryPassword = password });
    }

    static async Task<IResult> UpdateMember(int id, TeamMemberInput input, ClaimsPrincipal user, RostraDb db)
    {
        var member = await db.Staff.FirstOrDefaultAsync(s => s.Id == id);
        if (member is null) return Results.NotFound();
        var errors = await ValidateMember(input, id, db);
        if (id == user.StaffId() && input.Role != StaffRole.Manager)
            errors["role"] = ["You can’t remove your own manager access. Ask another manager."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);
        Apply(member, input);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    /// <summary>Deactivating keeps history (timesheets, past shifts) but frees up their future shifts as open shifts.</summary>
    static async Task<IResult> Deactivate(int id, ClaimsPrincipal user, RostraDb db, EventHub hub)
    {
        if (id == user.StaffId()) return Results.Conflict(new { error = "You can’t deactivate your own account." });
        var member = await db.Staff.FirstOrDefaultAsync(s => s.Id == id);
        if (member is null) return Results.NotFound();
        var now = await db.NowAsync();

        var future = await db.Shifts.Where(s => s.StaffId == id && s.Start > now).ToListAsync();
        foreach (var s in future) { s.StaffId = null; s.PendingCoverId = null; }
        await db.Shifts.Where(s => s.PendingCoverId == id).ExecuteUpdateAsync(u => u.SetProperty(s => s.PendingCoverId, (int?)null));
        member.IsActive = false;
        await db.SaveChangesAsync();
        foreach (var site in future.Select(s => s.SiteId).Distinct()) hub.Publish(member.CompanyId, "schedule.changed", new { siteId = site });
        return Results.Ok(new { OpenedShifts = future.Count });
    }

    static async Task<IResult> Reactivate(int id, RostraDb db)
    {
        var member = await db.Staff.FirstOrDefaultAsync(s => s.Id == id);
        if (member is null) return Results.NotFound();
        member.IsActive = true;
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    static async Task<IResult> ResetPassword(int id, RostraDb db, IPasswordHasher<Staff> hasher)
    {
        var member = await db.Staff.FirstOrDefaultAsync(s => s.Id == id);
        if (member is null) return Results.NotFound();
        var password = TempPassword();
        member.PasswordHash = hasher.HashPassword(member, password);
        await db.SaveChangesAsync();
        return Results.Ok(new { TemporaryPassword = password });
    }

    /* ----------------------------- Timesheets ----------------------------- */
    sealed record SheetLine(Shift Shift, string Name, string Email, decimal Rate, DateTime? In, DateTime? Out, double Hours, decimal Pay, string[] Flags);

    static async Task<(Site Site, DateTime From, List<SheetLine> Lines, Dictionary<int, TimesheetApproval> Approvals)?> LoadSheetAsync(RostraDb db, int? siteId, DateOnly? week, ClaimsPrincipal user)
    {
        var home = await db.Staff.Where(s => s.Id == user.StaffId()).Select(s => s.HomeSiteId).FirstAsync();
        var site = await db.Sites.FirstOrDefaultAsync(s => s.Id == (siteId ?? home));
        if (site is null) return null;
        var now = await db.NowAsync();
        var from = Week.StartOf(week ?? DateOnly.FromDateTime(now)).ToDateTime(TimeOnly.MinValue);
        var to = from.AddDays(7);

        var shifts = await db.Shifts.AsNoTracking().Include(s => s.Staff)
            .Where(s => s.SiteId == site.Id && s.StaffId != null && s.Start >= from && s.Start < to && s.Start <= now)
            .OrderBy(s => s.Staff!.Name).ThenBy(s => s.Start).ToListAsync();
        var ids = shifts.Select(s => s.Id).ToList();
        var punches = await db.ClockEvents.Where(c => c.ShiftId != null && ids.Contains(c.ShiftId.Value))
            .Select(c => new { Id = c.ShiftId!.Value, c.Kind, c.At }).ToListAsync();

        var lines = shifts.Select(s =>
        {
            var clockIn = punches.Where(p => p.Id == s.Id && p.Kind == ClockKind.In).Select(p => (DateTime?)p.At).Min();
            var clockOut = punches.Where(p => p.Id == s.Id && p.Kind == ClockKind.Out).Select(p => (DateTime?)p.At).Max();
            var hours = clockIn is { } i && clockOut is { } o ? Labour.WorkedHoursWithin(s, i, o, DateTime.MinValue, DateTime.MaxValue) : 0;
            var flags = new List<string>();
            if (clockIn is null) flags.Add(s.End <= now ? "No clock-in" : "Not clocked in yet");
            else if ((clockIn.Value - s.Start).TotalMinutes > 5) flags.Add($"{(clockIn.Value - s.Start).TotalMinutes:0} min late");
            if (clockIn is not null && clockOut is null) flags.Add(s.End <= now ? "No clock-out" : "On shift");
            else if (clockOut is { } co && (co - s.End).TotalMinutes > 15) flags.Add($"{(co - s.End).TotalMinutes:0} min over");
            return new SheetLine(s, s.Staff!.Name, s.Staff.Email, s.Staff.HourlyRate, clockIn, clockOut, Math.Round(hours, 2),
                Math.Round(Labour.Cost(hours, s.Staff.HourlyRate, s.Start), 2), flags.ToArray());
        }).ToList();

        var staffIds = lines.Select(l => l.Shift.StaffId!.Value).Distinct().ToList();
        var approvals = await db.TimesheetApprovals.Where(a => staffIds.Contains(a.StaffId) && a.WeekStart == from).ToDictionaryAsync(a => a.StaffId);
        return (site, from, lines, approvals);
    }

    static async Task<IResult> GetTimesheets(int? siteId, DateOnly? week, ClaimsPrincipal user, RostraDb db)
    {
        if (await LoadSheetAsync(db, siteId, week, user) is not { } sheet) return Results.NotFound();
        var approvers = await db.Staff.Where(s => sheet.Approvals.Values.Select(a => a.ApprovedById).Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name);
        var people = sheet.Lines.GroupBy(l => l.Shift.StaffId!.Value).Select(g =>
        {
            sheet.Approvals.TryGetValue(g.Key, out var approval);
            return new
            {
                StaffId = g.Key, Name = g.First().Name, Rate = g.First().Rate,
                RosteredHours = Math.Round(g.Sum(l => l.Shift.PaidHours), 2),
                WorkedHours = Math.Round(g.Sum(l => l.Hours), 2),
                Pay = g.Sum(l => l.Pay),
                Issues = g.Count(l => l.Flags.Any(f => f is "No clock-in" or "No clock-out")),
                Approved = approval is not null,
                ApprovedAt = approval?.ApprovedAt,
                ApprovedBy = approval is null ? null : approvers.GetValueOrDefault(approval.ApprovedById),
                Lines = g.Select(l => new
                {
                    ShiftId = l.Shift.Id, l.Shift.Start, l.Shift.End, l.Shift.BreakMinutes, l.Shift.Station,
                    ClockIn = l.In, ClockOut = l.Out, l.Hours, RosteredHours = Math.Round(l.Shift.PaidHours, 2), l.Pay, l.Flags,
                }),
            };
        }).ToList();
        return Results.Ok(new
        {
            Site = new { sheet.Site.Id, sheet.Site.Name }, WeekStart = DateOnly.FromDateTime(sheet.From), WeekNumber = Week.Number(sheet.From),
            People = people,
            Totals = new { WorkedHours = people.Sum(p => p.WorkedHours), Pay = people.Sum(p => p.Pay), Approved = people.Count(p => p.Approved), People = people.Count },
        });
    }

    static async Task<IResult> Approve(ApproveTimesheetsInput input, ClaimsPrincipal user, RostraDb db, Inbox inbox)
    {
        var from = Week.StartOf(input.Week).ToDateTime(TimeOnly.MinValue);
        var ids = (input.StaffIds ?? []).Distinct().ToList();
        var valid = await db.Staff.Where(s => ids.Contains(s.Id)).Select(s => s.Id).ToListAsync();
        var existing = await db.TimesheetApprovals.Where(a => valid.Contains(a.StaffId) && a.WeekStart == from).Select(a => a.StaffId).ToListAsync();
        var now = await db.NowAsync();
        var fresh = valid.Except(existing).ToList();
        foreach (var id in fresh)
            db.TimesheetApprovals.Add(new TimesheetApproval { CompanyId = db.CompanyId!.Value, StaffId = id, WeekStart = from, ApprovedAt = now, ApprovedById = user.StaffId() });
        await db.SaveChangesAsync();
        await inbox.SendAsync(fresh, "timesheet", $"Your Week {Week.Number(from)} timesheet was approved", "It’s ready for payroll.", "/app/home");
        return Results.Ok(new { Approved = fresh.Count });
    }

    static async Task<IResult> Unapprove(UnapproveTimesheetInput input, RostraDb db)
    {
        var from = Week.StartOf(input.Week).ToDateTime(TimeOnly.MinValue);
        await db.TimesheetApprovals.Where(a => a.StaffId == input.StaffId && a.WeekStart == from).ExecuteDeleteAsync();
        return Results.NoContent();
    }

    /// <summary>Fixes a missed or wrong punch. Approved timesheets are locked until unapproved.</summary>
    static async Task<IResult> EditPunches(int id, PunchEditInput input, RostraDb db, EventHub hub)
    {
        var shift = await db.Shifts.FirstOrDefaultAsync(s => s.Id == id);
        if (shift?.StaffId is not int staffId) return Results.NotFound();
        var weekStart = Week.StartOf(DateOnly.FromDateTime(shift.Start)).ToDateTime(TimeOnly.MinValue);
        if (await db.TimesheetApprovals.AnyAsync(a => a.StaffId == staffId && a.WeekStart == weekStart))
            return Results.Conflict(new { error = "This timesheet is approved. Unapprove it first, then fix the times." });

        var now = await db.NowAsync();
        var errors = new Dictionary<string, string[]>();
        if (input.ClockIn is { } ci && (ci < shift.Start.AddHours(-4) || ci > shift.End.AddHours(4))) errors["clockIn"] = ["Clock-in must be within 4 hours of the shift."];
        if (input.ClockOut is { } co && input.ClockIn is { } ci2 && co <= ci2) errors["clockOut"] = ["Clock-out must be after clock-in."];
        if (input.ClockOut is { } co2 && co2 > now) errors["clockOut"] = ["Clock-out can’t be in the future."];
        if (input.ClockOut is not null && input.ClockIn is null) errors["clockIn"] = ["Add a clock-in time too."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        await db.ClockEvents.Where(c => c.ShiftId == id).ExecuteDeleteAsync();
        if (input.ClockIn is { } inAt)
            db.ClockEvents.Add(new ClockEvent { CompanyId = shift.CompanyId, SiteId = shift.SiteId, StaffId = staffId, ShiftId = id, At = inAt, Kind = ClockKind.In, Source = "Manager" });
        if (input.ClockOut is { } outAt)
            db.ClockEvents.Add(new ClockEvent { CompanyId = shift.CompanyId, SiteId = shift.SiteId, StaffId = staffId, ShiftId = id, At = outAt, Kind = ClockKind.Out, Source = "Manager" });
        await db.SaveChangesAsync();
        hub.Publish(shift.CompanyId, "clock", new { siteId = shift.SiteId });
        return Results.NoContent();
    }

    /// <summary>Payroll export: one row per worked shift, with the award multiplier spelled out.</summary>
    static async Task<IResult> Export(int? siteId, DateOnly? week, bool? approvedOnly, ClaimsPrincipal user, RostraDb db)
    {
        if (await LoadSheetAsync(db, siteId, week, user) is not { } sheet) return Results.NotFound();
        var inv = CultureInfo.InvariantCulture;
        string Csv(string? v) => v is null ? "" : v.Contains(',') || v.Contains('"') ? $"\"{v.Replace("\"", "\"\"")}\"" : v;
        var sb = new StringBuilder("Employee,Email,Site,Date,Rostered Start,Rostered End,Clock In,Clock Out,Break (min),Paid Hours,Rate,Multiplier,Pay,Status\n");
        foreach (var l in sheet.Lines)
        {
            var approved = sheet.Approvals.ContainsKey(l.Shift.StaffId!.Value);
            if (approvedOnly == true && !approved) continue;
            sb.AppendJoin(',', Csv(l.Name), Csv(l.Email), Csv(sheet.Site.Name), l.Shift.Start.ToString("yyyy-MM-dd", inv),
                l.Shift.Start.ToString("HH:mm", inv), l.Shift.End.ToString("HH:mm", inv),
                l.In?.ToString("HH:mm", inv) ?? "", l.Out?.ToString("HH:mm", inv) ?? "", l.Shift.BreakMinutes.ToString(inv),
                l.Hours.ToString("0.00", inv), l.Rate.ToString("0.00", inv), Labour.Multiplier(l.Shift.Start).ToString("0.00", inv),
                l.Pay.ToString("0.00", inv), approved ? "Approved" : "Pending");
            sb.Append('\n');
        }
        var name = $"rostra-timesheets-{sheet.Site.Name.ToLowerInvariant().Replace(' ', '-')}-week-{Week.Number(sheet.From)}.csv";
        return Results.File(Encoding.UTF8.GetBytes(sb.ToString()), "text/csv", name);
    }
}
