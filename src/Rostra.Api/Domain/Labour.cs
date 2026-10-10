namespace Rostra.Api.Domain;

/// <summary>Weekend award penalty multipliers applied to labour cost.</summary>
public record Penalties(decimal Saturday, decimal Sunday);

public static class Labour
{
    public static readonly Penalties Penalties = new(1.25m, 1.50m);

    public static decimal Multiplier(DateTime start) => start.DayOfWeek switch
    {
        DayOfWeek.Saturday => Penalties.Saturday,
        DayOfWeek.Sunday => Penalties.Sunday,
        _ => 1m,
    };

    /// <summary>
    /// Paid hours of a shift that fall inside [from, to). The unpaid break is spread evenly
    /// across the shift, so "so far" figures part-way through a day stay fair.
    /// </summary>
    public static double PaidHoursWithin(DateTime start, DateTime end, int breakMinutes, DateTime from, DateTime to)
    {
        var length = (end - start).TotalHours;
        if (length <= 0) return 0;
        var span = ((end < to ? end : to) - (start > from ? start : from)).TotalHours;
        if (span <= 0) return 0;
        return span * Math.Max(0, 1 - breakMinutes / 60.0 / length);
    }

    /// <summary>Paid hours actually worked between clock-in and clock-out (or now), using the rostered break ratio.</summary>
    public static double WorkedHoursWithin(Shift shape, DateTime clockIn, DateTime clockOut, DateTime from, DateTime to)
    {
        var length = (shape.End - shape.Start).TotalHours;
        var ratio = length <= 0 ? 1 : Math.Max(0, 1 - shape.BreakMinutes / 60.0 / length);
        var span = ((clockOut < to ? clockOut : to) - (clockIn > from ? clockIn : from)).TotalHours;
        return span <= 0 ? 0 : span * ratio;
    }

    public static decimal Cost(double hours, decimal rate, DateTime start) => (decimal)hours * rate * Multiplier(start);
}
