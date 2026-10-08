using Microsoft.Extensions.Caching.Memory;
using Rostra.Api.Auth;

namespace Rostra.Api.Infrastructure;

/// <summary>
/// Replays the first response for a repeated Idempotency-Key, so a double-tap or a retry on a
/// flaky phone connection can't create two shifts or send two swap requests.
/// </summary>
public sealed class IdempotencyMiddleware(RequestDelegate next, IMemoryCache cache)
{
    sealed record Replay(int Status, string? ContentType, byte[] Body);

    public async Task InvokeAsync(HttpContext ctx)
    {
        var key = ctx.Request.Headers["Idempotency-Key"].ToString();
        if (!HttpMethods.IsPost(ctx.Request.Method) || key.Length is 0 or > 100
            || ctx.Request.Path.StartsWithSegments("/auth"))
        {
            await next(ctx);
            return;
        }

        var cacheKey = $"idem:{ctx.User.StaffId()}:{ctx.Request.Path}:{key}";
        if (cache.TryGetValue(cacheKey, out Replay? hit) && hit is not null)
        {
            ctx.Response.StatusCode = hit.Status;
            ctx.Response.ContentType = hit.ContentType;
            ctx.Response.Headers["Idempotent-Replayed"] = "true";
            await ctx.Response.Body.WriteAsync(hit.Body);
            return;
        }

        var original = ctx.Response.Body;
        using var buffer = new MemoryStream();
        ctx.Response.Body = buffer;
        try { await next(ctx); }
        finally { ctx.Response.Body = original; }

        var body = buffer.ToArray();
        if (ctx.Response.StatusCode < 500)
            cache.Set(cacheKey, new Replay(ctx.Response.StatusCode, ctx.Response.ContentType, body), TimeSpan.FromMinutes(10));
        await original.WriteAsync(body);
    }
}
