namespace Rostra.Api.Domain;

public class Shift
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public int SiteId { get; set; }
    public Site? Site { get; set; }

    public int StaffId { get; set; }
    public Staff? Staff { get; set; }

    /// <summary>Venue-local time. Restaurants roster in wall-clock time, not UTC.</summary>
    public DateTime Start { get; set; }
    public DateTime End { get; set; }
    public int BreakMinutes { get; set; }
    public Station Station { get; set; }
    public string? Notes { get; set; }

    /// <summary>Set when the rostered person has asked someone to cover; cleared on approve/decline.</summary>
    public int? PendingCoverId { get; set; }
    public Staff? PendingCover { get; set; }

    public double PaidHours => Math.Max(0, (End - Start).TotalHours - BreakMinutes / 60.0);
}

public record SwapRequest(int CoverId);
