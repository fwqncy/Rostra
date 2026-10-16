namespace Rostra.Api.Domain;

public enum RosterStatus { Draft, Published }

/// <summary>A site's roster for one Monday–Sunday week. No row means the week is still a draft.</summary>
public class RosterWeek
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public int SiteId { get; set; }

    /// <summary>Monday 00:00, venue time. End is stored too so "is this shift published?" stays a simple range query.</summary>
    public DateTime Start { get; set; }
    public DateTime End { get; set; }
    public RosterStatus Status { get; set; }
    public DateTime? PublishedAt { get; set; }
    public int? PublishedById { get; set; }
}

/// <summary>Something one person should know about, shown in the bell menu.</summary>
public class Notification
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public int StaffId { get; set; }
    public required string Kind { get; set; }
    public required string Title { get; set; }
    public string? Body { get; set; }
    public string? Link { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ReadAt { get; set; }
}

/// <summary>A post from management to the whole company or one site.</summary>
public class Announcement
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public int? SiteId { get; set; }
    public int AuthorId { get; set; }
    public Staff? Author { get; set; }
    public required string Title { get; set; }
    public required string Body { get; set; }
    public bool RequiresAck { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class AnnouncementRead
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public int AnnouncementId { get; set; }
    public int StaffId { get; set; }
    public DateTime ReadAt { get; set; }
}

/// <summary>A thank-you between teammates. Each one received lights a firefly in the recipient's tree.</summary>
public class Kudos
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public int FromId { get; set; }
    public Staff? From { get; set; }
    public int ToId { get; set; }
    public Staff? To { get; set; }
    public required string Message { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>A manager signing off one person's worked hours for one week, ready for payroll.</summary>
public class TimesheetApproval
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public int StaffId { get; set; }
    public DateTime WeekStart { get; set; }
    public DateTime ApprovedAt { get; set; }
    public int ApprovedById { get; set; }
}
