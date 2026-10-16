using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using Rostra.Api.Domain;

namespace Rostra.Api.Infrastructure;

public sealed record ServerEvent(string Type, object? Data)
{
    public static readonly ServerEvent Ping = new("ping", null);
}

/// <summary>
/// In-process fan-out of roster changes to open browsers over Server-Sent Events.
/// Scale-out on Azure App Service needs a backplane (e.g. Azure SignalR / Web PubSub) instead.
/// </summary>
public sealed class EventHub
{
    readonly ConcurrentDictionary<Guid, (int CompanyId, int StaffId, Channel<ServerEvent> Channel)> _subscribers = new();

    /// <summary>Sends to everyone in the company, or to one person's open tabs when <paramref name="staffId"/> is set.</summary>
    public void Publish(int companyId, string type, object data, int? staffId = null)
    {
        foreach (var (_, sub) in _subscribers)
            if (sub.CompanyId == companyId && (staffId is null || sub.StaffId == staffId))
                sub.Channel.Writer.TryWrite(new ServerEvent(type, data));
    }

    public async IAsyncEnumerable<ServerEvent> Subscribe(int companyId, int staffId, [EnumeratorCancellation] CancellationToken ct)
    {
        var id = Guid.NewGuid();
        var channel = Channel.CreateBounded<ServerEvent>(new BoundedChannelOptions(64) { FullMode = BoundedChannelFullMode.DropOldest });
        _subscribers[id] = (companyId, staffId, channel);
        try
        {
            while (!ct.IsCancellationRequested)
            {
                // Heartbeat keeps proxies (and App Service's 230s idle timeout) from closing the stream.
                var idle = false;
                using (var wait = CancellationTokenSource.CreateLinkedTokenSource(ct))
                {
                    wait.CancelAfter(TimeSpan.FromSeconds(25));
                    try { await channel.Reader.WaitToReadAsync(wait.Token); }
                    catch (OperationCanceledException) when (!ct.IsCancellationRequested) { idle = true; }
                }

                if (idle) { yield return ServerEvent.Ping; continue; }
                while (channel.Reader.TryRead(out var e)) yield return e;
            }
        }
        finally
        {
            _subscribers.TryRemove(id, out _);
        }
    }
}

public interface INotifier
{
    Task ManagerAsync(Shift shift, Staff cover);
}

/// <summary>Pushes swap requests to managers' open dashboards the moment they're made, and drops them in the bell menu.</summary>
public sealed class LiveNotifier(EventHub hub, Inbox inbox, ILogger<LiveNotifier> log) : INotifier
{
    public async Task ManagerAsync(Shift shift, Staff cover)
    {
        var when = Week.Label(shift.Start, shift.End);
        var from = shift.Staff?.Name ?? "Someone";
        await inbox.SendAsync(await inbox.ManagerIdsAsync(), "swap", $"{from} asked {cover.Name} to cover {when}", "Needs your approval", "/app/swaps");
        await inbox.SendAsync([cover.Id], "swap", $"{from} asked you to cover {when}", "Your manager will confirm it", "/app/swaps");

        hub.Publish(shift.CompanyId, "swap.requested", new
        {
            shiftId = shift.Id,
            siteId = shift.SiteId,
            from = shift.Staff?.Name,
            cover = cover.Name,
            start = shift.Start,
            end = shift.End,
        });
        log.LogInformation("Swap requested on shift {ShiftId}: {From} → {Cover}", shift.Id, shift.Staff?.Name, cover.Name);
    }
}
