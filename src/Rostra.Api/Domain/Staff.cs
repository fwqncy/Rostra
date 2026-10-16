using Microsoft.EntityFrameworkCore.Infrastructure;

namespace Rostra.Api.Domain;

public enum StaffRole { Staff, Manager }

[Flags]
public enum Station { None = 0, Floor = 1, Kitchen = 2, Bar = 4, Barista = 8 }

[Flags]
public enum Days { None = 0, Mon = 1, Tue = 2, Wed = 4, Thu = 8, Fri = 16, Sat = 32, Sun = 64, All = 127 }

public class Staff
{
    private ICollection<Shift>? _shifts;
    private ICollection<TimeOffRequest>? _timeOff;

    public Staff() { }

    // EF injects a lazy loader so CanWork can see the cover's other shifts
    // straight after a FindAsync, without the caller remembering to Include them.
    private Staff(ILazyLoader lazyLoader) => LazyLoader = lazyLoader;
    private ILazyLoader? LazyLoader { get; set; }

    public int Id { get; set; }
    public int CompanyId { get; set; }
    public int HomeSiteId { get; set; }
    public Site? HomeSite { get; set; }

    public required string Name { get; set; }
    public required string Email { get; set; }
    public string PasswordHash { get; set; } = "";
    public StaffRole Role { get; set; }
    public string Title { get; set; } = "Crew";

    public decimal HourlyRate { get; set; }
    public Station Stations { get; set; }
    public Station PrimaryStation { get; set; }
    public Days AvailableDays { get; set; } = Days.All;

    /// <summary>Usual week as 7 template codes (Mon–Sun), used to pre-fill new weeks.</summary>
    public string? UsualPattern { get; set; }
    public bool IsActive { get; set; } = true;

    /// <summary>The ticket this role legally needs, e.g. RSA for bar staff.</summary>
    public string? Certification { get; set; }
    public DateOnly? CertificationExpires { get; set; }

    /// <summary>Time spent actively using Rostra. It grows the tree on Home.</summary>
    public long ActiveSeconds { get; set; }
    public DateTime? LastActiveAt { get; set; }

    /// <summary>Secret for the personal calendar feed (webcal). Reset it to revoke old links.</summary>
    public string CalendarToken { get; set; } = NewToken();

    /// <summary>JSON: colour scheme, custom colour, light/dark mode and motion. Follows the person across devices.</summary>
    public string? Appearance { get; set; }

    public static string NewToken() => Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

    public ICollection<Shift> Shifts
    {
        get => LazyLoader.Load(this, ref _shifts) ?? (_shifts = new List<Shift>());
        set => _shifts = value;
    }

    public ICollection<TimeOffRequest> TimeOff
    {
        get => LazyLoader.Load(this, ref _timeOff) ?? (_timeOff = new List<TimeOffRequest>());
        set => _timeOff = value;
    }

    public bool CanWork(Shift shift) => WhyCannotWork(shift) is null;

    /// <summary>Returns a short, human reason this person can't take the shift, or null if they can.</summary>
    public string? WhyCannotWork(Shift shift)
    {
        if (Id == shift.StaffId) return "Already on this shift";
        if (!IsActive || CompanyId != shift.CompanyId) return "Not on the roster";
        if (!AvailableDays.HasFlag(Week.DayFlag(shift.Start.DayOfWeek)))
            return $"Unavailable on {shift.Start.DayOfWeek}s";
        var day = DateOnly.FromDateTime(shift.Start);
        if (TimeOff.Any(t => t.Status == RequestStatus.Approved && t.From <= day && t.To >= day)) return "On leave";
        if (!Stations.HasFlag(shift.Station)) return $"Not trained on {shift.Station}";

        var clash = Shifts.FirstOrDefault(s => s.Id != shift.Id && s.Start < shift.End && shift.Start < s.End);
        if (clash is not null) return $"Already working {Week.Compact(clash.Start, clash.End)}";

        return null;
    }
}
