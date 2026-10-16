using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Rostra.Api.Auth;
using Rostra.Api.Data;
using Rostra.Api.Domain;
using Rostra.Api.Infrastructure;

namespace Rostra.Api.Features;

public record AnnouncementInput(string? Title, string? Body, int? SiteId, bool RequiresAck);
public record KudosInput(int ToStaffId, string? Message);

/// <summary>The bell menu, announcements with read receipts, and kudos between teammates.</summary>
public static class CommunityEndpoints
{
    public static void MapCommunity(this WebApplication app)
    {
        var staff = app.MapGroup("").RequireAuthorization("Staff");
        staff.MapGet("/notifications", GetNotifications);
        staff.MapPost("/notifications/read", MarkAllRead);
        staff.MapPost("/notifications/{id:int}/read", MarkRead);

        staff.MapGet("/announcements", GetAnnouncements);
        staff.MapPost("/announcements/{id:int}/ack", Acknowledge);
        var manager = app.MapGroup("").RequireAuthorization("Manager");
        manager.MapPost("/announcements", PostAnnouncement);
        manager.MapDelete("/announcements/{id:int}", DeleteAnnouncement);

        staff.MapGet("/kudos", GetKudos);
        staff.MapPost("/kudos", GiveKudos);
        staff.MapGet("/team/directory", GetDirectory);
    }

    /* ----------------------------- Notifications ----------------------------- */
    static async Task<IResult> GetNotifications(ClaimsPrincipal user, RostraDb db)
    {
        var me = user.StaffId();
        var items = await db.Notifications.Where(n => n.StaffId == me)
            .OrderByDescending(n => n.CreatedAt).Take(40)
            .Select(n => new { n.Id, n.Kind, n.Title, n.Body, n.Link, n.CreatedAt, Read = n.ReadAt != null })
            .ToListAsync();
        var unread = await db.Notifications.CountAsync(n => n.StaffId == me && n.ReadAt == null);
        return Results.Ok(new { Items = items, Unread = unread });
    }

    static async Task<IResult> MarkAllRead(ClaimsPrincipal user, RostraDb db)
    {
        var me = user.StaffId();
        var now = await db.NowAsync();
        await db.Notifications.Where(n => n.StaffId == me && n.ReadAt == null)
            .ExecuteUpdateAsync(u => u.SetProperty(n => n.ReadAt, now));
        return Results.NoContent();
    }

    static async Task<IResult> MarkRead(int id, ClaimsPrincipal user, RostraDb db)
    {
        var me = user.StaffId();
        var now = await db.NowAsync();
        await db.Notifications.Where(n => n.Id == id && n.StaffId == me && n.ReadAt == null)
            .ExecuteUpdateAsync(u => u.SetProperty(n => n.ReadAt, now));
        return Results.NoContent();
    }

    /* ----------------------------- Announcements ----------------------------- */
    static async Task<IResult> GetAnnouncements(ClaimsPrincipal user, RostraDb db)
    {
        var meId = user.StaffId();
        var me = await db.Staff.FirstAsync(s => s.Id == meId);
        var isManager = user.IsManager();
        var query = db.Announcements.AsQueryable();
        if (!isManager) query = query.Where(a => a.SiteId == null || a.SiteId == me.HomeSiteId);

        var list = await query.OrderByDescending(a => a.CreatedAt).Take(20)
            .Select(a => new
            {
                a.Id, a.Title, a.Body, a.SiteId, Site = db.Sites.Where(s => s.Id == a.SiteId).Select(s => s.Name).FirstOrDefault(),
                Author = a.Author!.Name, a.AuthorId, a.RequiresAck, a.CreatedAt,
                ReadByMe = db.AnnouncementReads.Any(r => r.AnnouncementId == a.Id && r.StaffId == meId),
                Reads = db.AnnouncementReads.Count(r => r.AnnouncementId == a.Id),
                Audience = db.Staff.Count(s => s.IsActive && (a.SiteId == null || s.HomeSiteId == a.SiteId)),
            })
            .ToListAsync();
        // Read counts are for managers; staff only see their own receipt.
        return Results.Ok(list.Select(a => new
        {
            a.Id, a.Title, a.Body, a.SiteId, a.Site, a.Author, a.RequiresAck, a.CreatedAt, a.ReadByMe,
            Reads = isManager ? a.Reads : (int?)null, Audience = isManager ? a.Audience : (int?)null,
            CanDelete = isManager,
        }));
    }

    static async Task<IResult> PostAnnouncement(AnnouncementInput input, ClaimsPrincipal user, RostraDb db, Inbox inbox, EventHub hub)
    {
        var title = input.Title?.Trim() ?? "";
        var body = input.Body?.Trim() ?? "";
        var errors = new Dictionary<string, string[]>();
        if (title.Length == 0) errors["title"] = ["Give the announcement a title."];
        else if (title.Length > 120) errors["title"] = ["Keep the title to 120 characters."];
        if (body.Length == 0) errors["body"] = ["Write the announcement."];
        else if (body.Length > 2000) errors["body"] = ["Keep it to 2,000 characters."];
        if (input.SiteId is int sid && !await db.Sites.AnyAsync(s => s.Id == sid)) errors["siteId"] = ["Choose one of your sites."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var announcement = new Announcement
        {
            CompanyId = db.CompanyId!.Value, SiteId = input.SiteId, AuthorId = user.StaffId(),
            Title = title, Body = body, RequiresAck = input.RequiresAck, CreatedAt = await db.NowAsync(),
        };
        db.Announcements.Add(announcement);
        await db.SaveChangesAsync();

        var audience = await db.Staff.Where(s => s.IsActive && (input.SiteId == null || s.HomeSiteId == input.SiteId)).Select(s => s.Id).ToListAsync();
        await inbox.SendAsync(audience, "announcement", title, input.RequiresAck ? "Please read and confirm." : null, "/app/home", exceptStaffId: user.StaffId());
        hub.Publish(announcement.CompanyId, "announcement", new { announcement.Id });
        return Results.Created($"/announcements/{announcement.Id}", new { announcement.Id });
    }

    static async Task<IResult> Acknowledge(int id, ClaimsPrincipal user, RostraDb db)
    {
        var me = user.StaffId();
        if (!await db.Announcements.AnyAsync(a => a.Id == id)) return Results.NotFound();
        if (!await db.AnnouncementReads.AnyAsync(r => r.AnnouncementId == id && r.StaffId == me))
        {
            db.AnnouncementReads.Add(new AnnouncementRead { CompanyId = db.CompanyId!.Value, AnnouncementId = id, StaffId = me, ReadAt = await db.NowAsync() });
            await db.SaveChangesAsync();
        }
        return Results.NoContent();
    }

    static async Task<IResult> DeleteAnnouncement(int id, RostraDb db, EventHub hub)
    {
        var a = await db.Announcements.FirstOrDefaultAsync(x => x.Id == id);
        if (a is null) return Results.NoContent();
        await db.AnnouncementReads.Where(r => r.AnnouncementId == id).ExecuteDeleteAsync();
        db.Announcements.Remove(a);
        await db.SaveChangesAsync();
        hub.Publish(a.CompanyId, "announcement", new { id });
        return Results.NoContent();
    }

    /* ----------------------------- Kudos ----------------------------- */
    static async Task<IResult> GetKudos(ClaimsPrincipal user, RostraDb db)
    {
        var me = user.StaffId();
        var since = (await db.NowAsync()).AddDays(-30);
        var wall = await db.Kudos.OrderByDescending(k => k.CreatedAt).Take(12)
            .Select(k => new { k.Id, From = k.From!.Name, k.FromId, To = k.To!.Name, k.ToId, k.Message, k.CreatedAt })
            .ToListAsync();
        var received = await db.Kudos.CountAsync(k => k.ToId == me && k.CreatedAt >= since);
        var given = await db.Kudos.CountAsync(k => k.FromId == me && k.CreatedAt >= since);
        return Results.Ok(new { Wall = wall, ReceivedLast30Days = received, GivenLast30Days = given });
    }

    static async Task<IResult> GiveKudos(KudosInput input, ClaimsPrincipal user, RostraDb db, Inbox inbox, EventHub hub)
    {
        var me = user.StaffId();
        var message = input.Message?.Trim() ?? "";
        var errors = new Dictionary<string, string[]>();
        var to = await db.Staff.FirstOrDefaultAsync(s => s.Id == input.ToStaffId && s.IsActive);
        if (to is null) errors["toStaffId"] = ["Choose a teammate."];
        else if (to.Id == me) errors["toStaffId"] = ["Kudos are for teammates. Choose someone else."];
        if (message.Length == 0) errors["message"] = ["Say what you’re thanking them for."];
        else if (message.Length > 140) errors["message"] = ["Keep it to 140 characters."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var now = await db.NowAsync();
        if (await db.Kudos.CountAsync(k => k.FromId == me && k.CreatedAt >= now.AddDays(-1)) >= 10)
            return Results.Conflict(new { error = "You’ve sent 10 kudos today. Save some thanks for tomorrow." });

        var from = await db.Staff.FirstAsync(s => s.Id == me);
        db.Kudos.Add(new Kudos { CompanyId = from.CompanyId, FromId = me, ToId = to!.Id, Message = message, CreatedAt = now });
        await db.SaveChangesAsync();
        await inbox.SendAsync([to.Id], "kudos", $"{from.Name} sent you kudos", $"“{message}” A new firefly is glowing in your tree.", "/app/home");
        hub.Publish(from.CompanyId, "kudos", new { to = to.Id });
        return Results.Created("/kudos", new { to.Name });
    }

    /// <summary>Names and titles only: enough to thank someone or find who's on.</summary>
    static async Task<IResult> GetDirectory(RostraDb db) =>
        Results.Ok(await db.Staff.Where(s => s.IsActive).OrderBy(s => s.Name)
            .Select(s => new { s.Id, s.Name, s.Title, s.Role, Site = s.HomeSite!.Name }).ToListAsync());
}
