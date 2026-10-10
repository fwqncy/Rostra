namespace Rostra.Api.Domain;

public enum ClockKind { In, Out }

/// <summary>A punch on the time clock, tied to the shift it was made against.</summary>
public class ClockEvent
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public int SiteId { get; set; }
    public int StaffId { get; set; }
    public Staff? Staff { get; set; }
    public int? ShiftId { get; set; }
    public DateTime At { get; set; }
    public ClockKind Kind { get; set; }

    /// <summary>"App" when staff clocked themselves, "Manager" for a manual entry.</summary>
    public string Source { get; set; } = "App";
}

public enum RequestStatus { Pending, Approved, Declined }

/// <summary>Staff asking not to be rostered on these days.</summary>
public class TimeOffRequest
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public int StaffId { get; set; }
    public Staff? Staff { get; set; }
    public DateOnly From { get; set; }
    public DateOnly To { get; set; }
    public required string Reason { get; set; }
    public RequestStatus Status { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>Takings for one site on one day: a forecast up front, the actual from the POS afterwards.</summary>
public class SiteDay
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public int SiteId { get; set; }
    public DateOnly Date { get; set; }
    public decimal ForecastRevenue { get; set; }
    public decimal? ActualRevenue { get; set; }
}
