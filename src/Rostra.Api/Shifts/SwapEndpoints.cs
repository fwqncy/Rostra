// Rostra.Api/Shifts/SwapEndpoints.cs
using Microsoft.EntityFrameworkCore;
using Rostra.Api.Data;
using Rostra.Api.Domain;
using Rostra.Api.Infrastructure;

namespace Rostra.Api.Shifts;

public static class SwapEndpoints
{
    public static void MapSwaps(this WebApplication app)
    {
        app.MapPost("/shifts/{id:int}/swap", RequestSwap)
            .RequireAuthorization("Staff")
            .AddEndpointFilter<OwnShiftFilter>();
    }

    static async Task<IResult> RequestSwap(
        int id, SwapRequest req, RostraDb db, INotifier notify)
    {
        var shift = await db.Shifts
            .Include(s => s.Staff)
            .FirstOrDefaultAsync(s => s.Id == id);
        if (shift is null) return Results.NotFound();

        var cover = await db.Staff.FindAsync(req.CoverId);
        if (cover is null || !cover.CanWork(shift))
            return Results.Conflict("Cover is not available");

        shift.PendingCoverId = cover.Id;
        await db.SaveChangesAsync();
        await notify.ManagerAsync(shift, cover);
        return Results.Accepted();
    }
}
