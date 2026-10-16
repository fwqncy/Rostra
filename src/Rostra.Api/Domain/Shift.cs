namespace Rostra.Api.Domain;

public class Shift
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public int SiteId { get; set; }
    public Site? Site { get; set; }

    /// <summary>Null for an open shift that anyone suitable can ask to pick up.</summary>
    public int? StaffId { get; set; }
    public Staff? Staff { get; set; }

    /// <summary>Venue-local time. Restaurants roster in wall-clock time, not UTC.</summary>
    public DateTime Start { get; set; }
    public DateTime End { get; set; }
    public int BreakMinutes { get; set; }
    public Station Station { get; set; }
    public string? Notes { get; set; }

    /// <summary>
    /// Who's waiting to take this shift: a swap cover, or someone asking to pick up an open shift.
    /// Cleared on approve/decline.
    /// </summary>
    public int? PendingCoverId { get; set; }
    public Staff? PendingCover { get; set; }

    public double PaidHours => Math.Max(0, (End - Start).TotalHours - BreakMinutes / 60.0);
    public bool IsOpen => StaffId is null;
}

public record SwapRequest(int CoverId);
