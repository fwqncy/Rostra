using System.Globalization;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Rostra.Api.Auth;
using Rostra.Api.Data;
using Rostra.Api.Domain;
using Rostra.Api.Shifts;

namespace Rostra.Api.Features;

public record AppearanceInput(string? Scheme, string? Custom, string? Mode, string? Motion);
public record PasswordInput(string? Current, string? Next);
public record ActivityInput(int Seconds);

/// <summary>Appearance, password, calendar feed, and the time-spent counter that grows the tree.</summary>
public static partial class PersonalEndpoints
{
    static readonly string[] Schemes = ["overgrowth", "burgundy-navy", "brand", "custom"];
    static readonly string[] Modes = ["system", "light", "dark"];
    static readonly string[] Motions = ["auto", "reduced", "full"];

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColour();

    public static void MapPersonal(this WebApplication app)
    {
        var me = app.MapGroup("").RequireAuthorization("Staff");
        me.MapGet("/me/settings", GetSettings);
        me.MapPut("/me/appearance", SetAppearance);
        me.MapPost("/me/password", ChangePassword);
        me.MapPost("/me/calendar/reset", ResetCalendar);
        me.MapPost("/me/activity", RecordActivity);
        me.MapGet("/me/grove", GetGrove);
        app.MapPut("/company/appearance", SetCompanyAppearance).RequireAuthorization("Manager");
        app.MapGet("/calendar/{token}.ics", CalendarFeed).AllowAnonymous().RequireRateLimiting("calendar");
    }

    static async Task<IResult> GetSettings(ClaimsPrincipal user, RostraDb db)
    {
        var me = await db.Staff.FirstAsync(s => s.Id == user.StaffId());
        return Results.Ok(new { CalendarPath = $"/calendar/{me.CalendarToken}.ics", me.ActiveSeconds });
    }

    static (string? Json, Dictionary<string, string[]> Errors) Normalise(AppearanceInput input, bool personal)
    {
        var errors = new Dictionary<string, string[]>();
        var scheme = (input.Scheme ?? "overgrowth").ToLowerInvariant();
        if (!Schemes.Contains(scheme)) errors["scheme"] = ["Choose one of the colour schemes."];
        var custom = input.Custom?.Trim();
        if (scheme == "custom" && (custom is null || !HexColour().IsMatch(custom))) errors["custom"] = ["Pick a colour on the wheel, or enter a hex code like #C2410C."];
        var mode = (input.Mode ?? "dark").ToLowerInvariant();
        var motion = (input.Motion ?? "auto").ToLowerInvariant();
        if (personal && !Modes.Contains(mode)) errors["mode"] = ["Choose System, Light or Dark."];
        if (personal && !Motions.Contains(motion)) errors["motion"] = ["Choose a motion setting."];
        if (errors.Count > 0) return (null, errors);
        object value = personal
            ? new { scheme, custom = scheme == "custom" ? custom!.ToUpperInvariant() : null, mode, motion }
            : new { scheme, custom = scheme == "custom" ? custom!.ToUpperInvariant() : null };
        return (JsonSerializer.Serialize(value), errors);
    }

    static async Task<IResult> SetAppearance(AppearanceInput input, ClaimsPrincipal user, RostraDb db)
    {
        var (json, errors) = Normalise(input, personal: true);
        if (errors.Count > 0) return Results.ValidationProblem(errors);
        var me = await db.Staff.FirstAsync(s => s.Id == user.StaffId());
        me.Appearance = json;
        await db.SaveChangesAsync();
        return Results.Ok(RosterEndpoints.ParseJson(json));
    }

    static async Task<IResult> SetCompanyAppearance(AppearanceInput input, ClaimsPrincipal user, RostraDb db)
    {
        var (json, errors) = Normalise(input, personal: false);
        if (errors.Count > 0) return Results.ValidationProblem(errors);
        var company = await db.Companies.FirstAsync(c => c.Id == user.CompanyId());
        company.DefaultAppearance = json;
        await db.SaveChangesAsync();
        return Results.Ok(RosterEndpoints.ParseJson(json));
    }

    static async Task<IResult> ChangePassword(PasswordInput input, ClaimsPrincipal user, RostraDb db, IPasswordHasher<Staff> hasher)
    {
        var me = await db.Staff.FirstAsync(s => s.Id == user.StaffId());
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrEmpty(input.Current) || hasher.VerifyHashedPassword(me, me.PasswordHash, input.Current) == PasswordVerificationResult.Failed)
            errors["current"] = ["That isn’t your current password."];
        if ((input.Next?.Length ?? 0) < 10) errors["next"] = ["Use at least 10 characters. A short phrase works well."];
        else if (input.Next == input.Current) errors["next"] = ["Choose a password you haven’t used here."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);
        me.PasswordHash = hasher.HashPassword(me, input.Next!);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    static async Task<IResult> ResetCalendar(ClaimsPrincipal user, RostraDb db)
    {
        var me = await db.Staff.FirstAsync(s => s.Id == user.StaffId());
        me.CalendarToken = Staff.NewToken();
        await db.SaveChangesAsync();
        return Results.Ok(new { CalendarPath = $"/calendar/{me.CalendarToken}.ics" });
    }

    /// <summary>
    /// Called about once a minute while the app is open and in use. The server caps each call
    /// to the real time elapsed, so a busy loop can't grow a tree faster.
    /// </summary>
    static async Task<IResult> RecordActivity(ActivityInput input, ClaimsPrincipal user, RostraDb db)
    {
        var me = await db.Staff.FirstAsync(s => s.Id == user.StaffId());
        var now = DateTime.UtcNow;
        var add = Math.Clamp(input.Seconds, 0, 120);
        if (me.LastActiveAt is { } last)
        {
            var since = (now - last).TotalSeconds;
            if (since < 30) return Results.Ok(new { me.ActiveSeconds });
            if (since < 600) add = (int)Math.Min(add, since);
        }
        me.ActiveSeconds += add;
        me.LastActiveAt = now;
        await db.SaveChangesAsync();
        return Results.Ok(new { me.ActiveSeconds });
    }

    /// <summary>
    /// What the tree shows. Managers: one apple per site-week roster (red published, green still a draft).
    /// Staff: one apple per week they're rostered (red worked, green coming up). Fireflies are kudos received.
    /// </summary>
    static async Task<IResult> GetGrove(ClaimsPrincipal user, RostraDb db)
    {
        var me = await db.Staff.FirstAsync(s => s.Id == user.StaffId());
        var company = await db.Companies.FirstAsync(c => c.Id == me.CompanyId);
        var now = await db.NowAsync();
        var monday = Week.StartOf(DateOnly.FromDateTime(now)).ToDateTime(TimeOnly.MinValue);
        var from = monday.AddDays(-7 * 11);
        var to = monday.AddDays(7 * 4);

        var apples = new List<object>();
        if (me.Role == StaffRole.Manager)
        {
            var starts = await db.Shifts.Where(s => s.Start >= from && s.Start < to).Select(s => new { s.SiteId, s.Start }).ToListAsync();
            var sites = await db.Sites.ToDictionaryAsync(s => s.Id, s => s.Name);
            var published = (await db.RosterWeeks.Where(w => w.Status == RosterStatus.Published && w.Start >= from && w.Start < to)
                .Select(w => new { w.SiteId, w.Start }).ToListAsync()).Select(w => (w.SiteId, w.Start)).ToHashSet();
            foreach (var wk in starts.Select(s => (s.SiteId, Start: Week.StartOf(DateOnly.FromDateTime(s.Start)).ToDateTime(TimeOnly.MinValue))).Distinct().OrderBy(w => w.Start))
                apples.Add(new
                {
                    WeekStart = DateOnly.FromDateTime(wk.Start), Site = sites.GetValueOrDefault(wk.SiteId),
                    Status = published.Contains(wk) ? "published" : "draft",
                    Label = $"Week {Week.Number(wk.Start)} · {sites.GetValueOrDefault(wk.SiteId)}",
                });
        }
        else
        {
            var mine = await db.PublishedShifts.Where(s => s.StaffId == me.Id && s.Start >= from && s.Start < to)
                .Select(s => s.Start).ToListAsync();
            foreach (var wk in mine.Select(s => Week.StartOf(DateOnly.FromDateTime(s))).Distinct().OrderBy(d => d))
            {
                var start = wk.ToDateTime(TimeOnly.MinValue);
                apples.Add(new
                {
                    WeekStart = wk, Site = (string?)null,
                    Status = start.AddDays(7) <= now ? "completed" : "upcoming",
                    Label = $"Week {Week.Number(start)}",
                });
            }
        }

        var fireflies = await db.Kudos.CountAsync(k => k.ToId == me.Id && k.CreatedAt >= now.AddDays(-30));
        var month = now.Month;
        var northern = month switch { 3 or 4 or 5 => "spring", 6 or 7 or 8 => "summer", 9 or 10 or 11 => "autumn", _ => "winter" };
        var season = !company.SouthernHemisphere ? northern
            : northern switch { "spring" => "autumn", "summer" => "winter", "autumn" => "spring", _ => "summer" };

        return Results.Ok(new { me.ActiveSeconds, Role = me.Role, Apples = apples, Fireflies = Math.Min(fireflies, 30), Season = season });
    }

    /// <summary>Personal iCalendar feed of published shifts. Calendar apps poll it; the token is the only credential.</summary>
    static async Task<IResult> CalendarFeed(string token, RostraDb db)
    {
        var me = await db.Staff.IgnoreQueryFilters().FirstOrDefaultAsync(s => s.CalendarToken == token && s.IsActive);
        if (me is null) return Results.NotFound();
        var company = await db.Companies.FirstAsync(c => c.Id == me.CompanyId);
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById(company.TimeZone); } catch (TimeZoneNotFoundException) { zone = TimeZoneInfo.Utc; }
        var now = VenueClock.Now(company.TimeZone);

        var shifts = await db.Shifts.IgnoreQueryFilters().Include(s => s.Site)
            .Where(s => s.StaffId == me.Id && s.Start >= now.AddDays(-30) && s.Start < now.AddDays(120)
                        && db.RosterWeeks.IgnoreQueryFilters().Any(w => w.SiteId == s.SiteId && w.Status == RosterStatus.Published && w.Start <= s.Start && s.Start < w.End))
            .OrderBy(s => s.Start).ToListAsync();

        static string Esc(string v) => v.Replace("\\", "\\\\").Replace(";", "\\;").Replace(",", "\\,").Replace("\n", "\\n");
        string Utc(DateTime local) => TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), zone)
            .ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
        var stamp = DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);

        var ics = new StringBuilder();
        ics.Append("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Rostra//Roster//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n");
        ics.Append($"X-WR-CALNAME:{Esc($"{company.Name} shifts")}\r\nX-WR-TIMEZONE:{company.TimeZone}\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n");
        foreach (var s in shifts)
        {
            var description = $"Station: {s.Station}. Unpaid break: {s.BreakMinutes} min." + (s.Notes is null ? "" : $" Notes: {s.Notes}");
            ics.Append("BEGIN:VEVENT\r\n");
            ics.Append($"UID:shift-{s.Id}@rostra\r\nDTSTAMP:{stamp}\r\nDTSTART:{Utc(s.Start)}\r\nDTEND:{Utc(s.End)}\r\n");
            ics.Append($"SUMMARY:{Esc($"{s.Station} shift · {s.Site!.Name}")}\r\nLOCATION:{Esc($"{company.Name}, {s.Site.Name}")}\r\n");
            ics.Append($"DESCRIPTION:{Esc(description)}\r\nEND:VEVENT\r\n");
        }
        ics.Append("END:VCALENDAR\r\n");
        return Results.Text(ics.ToString(), "text/calendar; charset=utf-8");
    }
}
