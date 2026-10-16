using Microsoft.EntityFrameworkCore;
using Rostra.Api.Data;
using Rostra.Api.Domain;

namespace Rostra.Api.Infrastructure;

/// <summary>Writes bell-menu notifications for the signed-in company and pings each recipient's open tabs.</summary>
public sealed class Inbox(RostraDb db, EventHub hub)
{
    public async Task SendAsync(IEnumerable<int> staffIds, string kind, string title, string? body = null, string? link = null, int? exceptStaffId = null)
    {
        if (db.CompanyId is not int companyId) return;
        var ids = staffIds.Distinct().Where(id => id != exceptStaffId).ToList();
        if (ids.Count == 0) return;

        var now = await db.NowAsync();
        foreach (var id in ids)
            db.Notifications.Add(new Notification
            {
                CompanyId = companyId, StaffId = id, Kind = kind, CreatedAt = now,
                Title = Clip(title, 200), Body = body is null ? null : Clip(body, 400), Link = link,
            });
        await db.SaveChangesAsync();
        foreach (var id in ids) hub.Publish(companyId, "notification", new { kind, title }, id);
    }

    public Task<List<int>> ManagerIdsAsync() =>
        db.Staff.Where(s => s.Role == StaffRole.Manager && s.IsActive).Select(s => s.Id).ToListAsync();

    static string Clip(string s, int max) => s.Length <= max ? s : s[..(max - 1)] + "…";
}
