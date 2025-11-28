using Pankha.WindowsAgent.Models;
using Pankha.WindowsAgent.Models.Configuration;
using Serilog;

namespace Pankha.WindowsAgent.Utilities;

/// <summary>
/// Sensor deduplication utility
/// Implements intelligent sensor filtering based on chip priority and temperature grouping
/// </summary>
public static class SensorDeduplicator
{
    /// <summary>
    /// Deduplicate sensors based on temperature proximity and chip priority
    /// </summary>
    /// <param name="sensors">Input sensors</param>
    /// <param name="tolerance">Temperature difference tolerance in °C</param>
    /// <param name="logger">Optional logger for debugging</param>
    /// <returns>Deduplicated sensor list</returns>
    public static List<Sensor> Deduplicate(
        List<Sensor> sensors,
        double tolerance,
        ILogger? logger = null)
    {
        if (sensors.Count <= 1)
            return sensors;

        logger?.Debug("Deduplicating {Count} sensors with {Tolerance}C tolerance", sensors.Count, tolerance);

        // Group sensors by temperature proximity
        var temperatureGroups = GroupByTemperature(sensors, tolerance);

        logger?.Debug("Found {GroupCount} temperature groups", temperatureGroups.Count);

        // For each group, select the sensor with highest priority
        var deduplicated = new List<Sensor>();

        foreach (var group in temperatureGroups)
        {
            if (group.Count == 1)
            {
                // No duplicates, keep the sensor
                deduplicated.Add(group[0]);
                continue;
            }

            // Multiple sensors with similar temperatures - select by priority
            var selected = group.OrderByDescending(s => s.Priority)
                .ThenBy(s => s.Name) // Tie-breaker: alphabetical
                .First();

            deduplicated.Add(selected);

            if (logger?.IsEnabled(Serilog.Events.LogEventLevel.Debug) == true)
            {
                var dropped = group.Where(s => s.Id != selected.Id).ToList();
                logger.Debug(
                    "  Group at {Temp:F1}°C: Selected {Selected} (priority {Priority}), dropped {Count} duplicates: {Dropped}",
                    selected.Temperature,
                    selected.Name,
                    selected.Priority,
                    dropped.Count,
                    string.Join(", ", dropped.Select(s => s.Name)));
            }
        }

        logger?.Information(
            "Sensor deduplication: {Original} -> {Final} sensors ({Removed} removed)",
            sensors.Count,
            deduplicated.Count,
            sensors.Count - deduplicated.Count);

        return deduplicated;
    }

    /// <summary>
    /// Group sensors by temperature proximity
    /// Sensors within tolerance °C are considered duplicates
    /// </summary>
    private static List<List<Sensor>> GroupByTemperature(List<Sensor> sensors, double tolerance)
    {
        var groups = new List<List<Sensor>>();
        var remaining = new List<Sensor>(sensors);

        while (remaining.Any())
        {
            var current = remaining.First();
            remaining.RemoveAt(0);

            // Find all sensors within tolerance of current sensor
            var group = new List<Sensor> { current };

            var similars = remaining
                .Where(s => Math.Abs(s.Temperature - current.Temperature) <= tolerance)
                .ToList();

            foreach (var similar in similars)
            {
                group.Add(similar);
                remaining.Remove(similar);
            }

            groups.Add(group);
        }

        return groups;
    }

    /// <summary>
    /// Analyze sensor duplication statistics
    /// </summary>
    public static void AnalyzeDuplication(List<Sensor> sensors, double tolerance, ILogger logger)
    {
        var groups = GroupByTemperature(sensors, tolerance);
        var duplicateGroups = groups.Where(g => g.Count > 1).ToList();

        if (!duplicateGroups.Any())
        {
            logger.Information("No duplicate sensors detected (tolerance: {Tolerance}C)", tolerance);
            return;
        }

        logger.Information("Duplicate Sensor Analysis (tolerance: {Tolerance}C):", tolerance);
        logger.Information("  Total sensors: {Count}", sensors.Count);
        logger.Information("  Duplicate groups: {Groups}", duplicateGroups.Count);
        logger.Information("");

        foreach (var group in duplicateGroups.Take(5)) // Show first 5 groups
        {
            var avgTemp = group.Average(s => s.Temperature);
            logger.Information("  Temperature ~{Temp:F1}°C:", avgTemp);

            var sorted = group.OrderByDescending(s => s.Priority).ToList();
            foreach (var sensor in sorted)
            {
                var marker = sensor == sorted.First() ? "[KEEP]" : "[DROP]";
                logger.Information("    {Marker} {Name} (priority: {Priority}, temp: {Temp:F1}C)",
                    marker, sensor.Name, sensor.Priority, sensor.Temperature);
            }
            logger.Information("");
        }

        if (duplicateGroups.Count > 5)
        {
            logger.Information("  ... and {More} more duplicate groups", duplicateGroups.Count - 5);
        }
    }
}
