namespace Rostra.Api.Domain;

public static class Week
{
    /// <summary>Rosters run Monday to Sunday.</summary>
    public static DateOnly StartOf(DateOnly day) => day.AddDays(-(((int)day.DayOfWeek + 6) % 7));

    public static Days DayFlag(DayOfWeek day) => day switch
    {
        DayOfWeek.Monday => Days.Mon,
        DayOfWeek.Tuesday => Days.Tue,
        DayOfWeek.Wednesday => Days.Wed,
        DayOfWeek.Thursday => Days.Thu,
        DayOfWeek.Friday => Days.Fri,
        DayOfWeek.Saturday => Days.Sat,
        _ => Days.Sun,
    };

    /// <summary>"9–5", "4–11", "6:30–2:30" — how rosters are written on the back-of-house wall.</summary>
    public static string Compact(DateTime start, DateTime end) => $"{Hour(start)}–{Hour(end)}";

    static string Hour(DateTime t)
    {
        var h = t.Hour % 12 == 0 ? 12 : t.Hour % 12;
        return t.Minute == 0 ? $"{h}" : $"{h}:{t.Minute:00}";
    }
}
