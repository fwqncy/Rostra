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
