namespace Rostra.Api.Domain;

/// <summary>A restaurant group. Every row below it is scoped to one company.</summary>
public class Company
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public required string Slug { get; set; }

    /// <summary>Brand accent as #RRGGBB. The UI tints itself with it after sign-in.</summary>
    public required string Accent { get; set; }

    public string Currency { get; set; } = "AUD";

    /// <summary>IANA zone the venues trade in. Shift times are wall-clock in this zone.</summary>
    public string TimeZone { get; set; } = "Australia/Brisbane";

    /// <summary>JSON: the colour scheme staff see until they pick their own.</summary>
    public string? DefaultAppearance { get; set; }

    public bool SouthernHemisphere => TimeZone.StartsWith("Australia/") || TimeZone is "Pacific/Auckland" or "Pacific/Chatham";

    public List<Site> Sites { get; set; } = [];
}

/// <summary>One venue of a multi-site group, e.g. "Ipswich".</summary>
public class Site
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public required string Name { get; set; }
    public decimal WeeklyBudget { get; set; }
}

public static class VenueClock
{
    /// <summary>Wall-clock "now" in a venue's zone, independent of the server's (UTC on Azure).</summary>
    public static DateTime Now(string timeZone)
    {
        try
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
            return DateTime.SpecifyKind(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone), DateTimeKind.Unspecified);
        }
        catch (TimeZoneNotFoundException)
        {
            return DateTime.SpecifyKind(DateTime.Now, DateTimeKind.Unspecified);
        }
    }
}
