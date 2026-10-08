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

    public ICollection<Shift> Shifts
    {
        get => LazyLoader.Load(this, ref _shifts) ?? (_shifts = new List<Shift>());
        set => _shifts = value;
    }

    public bool CanWork(Shift shift) => WhyCannotWork(shift) is null;

    /// <summary>Returns a short, human reason this person can't take the shift, or null if they can.</summary>
    public string? WhyCannotWork(Shift shift)
    {
        if (Id == shift.StaffId) return "Already on this shift";
        if (!IsActive || CompanyId != shift.CompanyId) return "Not on the roster";
        if (!AvailableDays.HasFlag(Week.DayFlag(shift.Start.DayOfWeek)))
            return $"Unavailable on {shift.Start.DayOfWeek}s";
        if (!Stations.HasFlag(shift.Station)) return $"Not trained on {shift.Station}";

        var clash = Shifts.FirstOrDefault(s => s.Id != shift.Id && s.Start < shift.End && shift.Start < s.End);
        if (clash is not null) return $"Already working {Week.Compact(clash.Start, clash.End)}";

        return null;
    }
}
