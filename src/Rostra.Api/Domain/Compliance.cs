namespace Rostra.Api.Domain;

public record ComplianceWarning(int ShiftId, int StaffId, string Code, string Message);

/// <summary>
/// Roster checks modelled on common Australian hospitality award rules. They warn rather than block:
/// the manager decides, but nothing slips through unnoticed.
/// </summary>
public static class Compliance
{
    public const double MinRestHours = 10;
    public const double MaxShiftHours = 10;
    public const double OrdinaryWeekHours = 38;
    public const double BreakAfterHours = 5;

    /// <param name="shifts">Everyone's shifts from the day before the week to the day after, across all sites.</param>
    /// <param name="people">Staff by id, for availability, training and names.</param>
    /// <param name="leave">Approved leave by staff id.</param>
    public static List<ComplianceWarning> Check(IEnumerable<Shift> shifts, DateTime weekStart,
        IReadOnlyDictionary<int, Staff> people, ILookup<int, TimeOffRequest> leave)
    {
        var warnings = new List<ComplianceWarning>();
        var weekEnd = weekStart.AddDays(7);

        foreach (var group in shifts.Where(s => s.StaffId is not null).GroupBy(s => s.StaffId!.Value))
        {
            people.TryGetValue(group.Key, out var person);
            var name = person?.Name.Split(' ')[0] ?? "They";
            var ordered = group.OrderBy(s => s.Start).ToList();
            double hours = 0;
            var days = new HashSet<DateOnly>();
            Shift? previous = null;

            foreach (var s in ordered)
            {
                var inWeek = s.Start >= weekStart && s.Start < weekEnd;
                void Warn(string code, string message) { if (inWeek) warnings.Add(new(s.Id, group.Key, code, message)); }

                // Overnight rest only: split shifts on the same day are normal in hospitality.
                if (previous is not null && previous.End.Date != s.Start.Date)
                {
                    var rest = (s.Start - previous.End).TotalHours;
                    if (rest >= 0 && rest < MinRestHours)
                        Warn("rest", $"Only {rest:0.#} h rest after {name}’s {previous.Start:dddd} shift (aim for {MinRestHours:0} h).");
                }
                previous = s;
                if (!inWeek) continue;

                if ((s.End - s.Start).TotalHours > MaxShiftHours) Warn("long", $"Longer than {MaxShiftHours:0} h.");
                if (s.PaidHours > BreakAfterHours && s.BreakMinutes == 0) Warn("break", $"No meal break on a shift over {BreakAfterHours:0} h.");

                var before = hours;
                hours += s.PaidHours;
                if (before <= OrdinaryWeekHours && hours > OrdinaryWeekHours)
                    Warn("overtime", $"Takes {name} to {hours:0.#} h this week, over {OrdinaryWeekHours:0} h.");

                days.Add(DateOnly.FromDateTime(s.Start));
                if (days.Count == 7) Warn("no-day-off", $"{name} is rostered all 7 days this week.");

                if (person is null) continue;
                var day = DateOnly.FromDateTime(s.Start);
                if (!person.AvailableDays.HasFlag(Week.DayFlag(s.Start.DayOfWeek))) Warn("unavailable", $"{name} is unavailable on {s.Start.DayOfWeek}s.");
                if (leave[group.Key].Any(t => t.From <= day && t.To >= day)) Warn("leave", $"{name} is on approved leave.");
                if (!person.Stations.HasFlag(s.Station)) Warn("training", $"{name} isn’t trained on {s.Station}.");
            }
        }
        return warnings;
    }
}
