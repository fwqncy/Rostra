using Microsoft.EntityFrameworkCore;
using Rostra.Api.Auth;
using Rostra.Api.Domain;

namespace Rostra.Api.Data;

public class RostraDb(DbContextOptions<RostraDb> options, ITenant tenant) : DbContext(options)
{
    /// <summary>The signed-in user's company. Null outside a request, which matches no rows.</summary>
    public int? CompanyId => tenant.CompanyId;

    public DbSet<Company> Companies => Set<Company>();
    public DbSet<Site> Sites => Set<Site>();
    public DbSet<Staff> Staff => Set<Staff>();
    public DbSet<Shift> Shifts => Set<Shift>();
    public DbSet<ClockEvent> ClockEvents => Set<ClockEvent>();
    public DbSet<TimeOffRequest> TimeOff => Set<TimeOffRequest>();
    public DbSet<SiteDay> SiteDays => Set<SiteDay>();

    DateTime? _now;

    /// <summary>Wall-clock now for the signed-in company's venues.</summary>
    public async Task<DateTime> NowAsync()
    {
        if (_now is { } cached) return cached;
        var zone = await Companies.Where(c => c.Id == CompanyId).Select(c => c.TimeZone).FirstOrDefaultAsync();
        return (_now = VenueClock.Now(zone ?? "Australia/Brisbane")).Value;
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Company>(e =>
        {
            e.Property(c => c.Name).HasMaxLength(80);
            e.Property(c => c.Slug).HasMaxLength(40);
            e.Property(c => c.Accent).HasMaxLength(7);
            e.Property(c => c.Currency).HasMaxLength(3);
            e.Property(c => c.TimeZone).HasMaxLength(64);
            e.HasIndex(c => c.Slug).IsUnique();
            e.HasMany(c => c.Sites).WithOne().HasForeignKey(s => s.CompanyId);
        });

        // Tenancy is enforced here, once, so no endpoint can forget it.
        b.Entity<Site>(e =>
        {
            e.HasQueryFilter(s => s.CompanyId == CompanyId);
            e.Property(s => s.Name).HasMaxLength(80);
            e.Property(s => s.WeeklyBudget).HasPrecision(10, 2);
        });

        b.Entity<Staff>(e =>
        {
            e.HasQueryFilter(s => s.CompanyId == CompanyId);
            e.Property(s => s.Name).HasMaxLength(80);
            e.Property(s => s.Email).HasMaxLength(120);
            e.Property(s => s.Title).HasMaxLength(60);
            e.Property(s => s.UsualPattern).HasMaxLength(7);
            e.Property(s => s.Certification).HasMaxLength(60);
            e.Property(s => s.HourlyRate).HasPrecision(8, 2);
            e.Property(s => s.Role).HasConversion<string>().HasMaxLength(16);
            e.HasIndex(s => s.Email).IsUnique();
            e.HasOne<Company>().WithMany().HasForeignKey(s => s.CompanyId);
            e.HasOne(s => s.HomeSite).WithMany().HasForeignKey(s => s.HomeSiteId);
        });

        b.Entity<Shift>(e =>
        {
            e.HasQueryFilter(s => s.CompanyId == CompanyId);
            e.Property(s => s.Notes).HasMaxLength(280);
            e.HasOne<Company>().WithMany().HasForeignKey(s => s.CompanyId);
            e.HasOne(s => s.Site).WithMany().HasForeignKey(s => s.SiteId);
            e.HasOne(s => s.Staff).WithMany(s => s.Shifts).HasForeignKey(s => s.StaffId);
            e.HasOne(s => s.PendingCover).WithMany().HasForeignKey(s => s.PendingCoverId);
            e.HasIndex(s => new { s.SiteId, s.Start });
            e.HasIndex(s => new { s.StaffId, s.Start });
            e.Ignore(s => s.PaidHours);
        });

        b.Entity<ClockEvent>(e =>
        {
            e.HasQueryFilter(c => c.CompanyId == CompanyId);
            e.Property(c => c.Kind).HasConversion<string>().HasMaxLength(8);
            e.Property(c => c.Source).HasMaxLength(16);
            e.HasOne<Company>().WithMany().HasForeignKey(c => c.CompanyId);
            e.HasOne<Site>().WithMany().HasForeignKey(c => c.SiteId);
            e.HasOne(c => c.Staff).WithMany().HasForeignKey(c => c.StaffId);
            e.HasOne<Shift>().WithMany().HasForeignKey(c => c.ShiftId);
            e.HasIndex(c => new { c.CompanyId, c.At });
            e.HasIndex(c => c.ShiftId);
        });

        b.Entity<TimeOffRequest>(e =>
        {
            e.HasQueryFilter(t => t.CompanyId == CompanyId);
            e.Property(t => t.Reason).HasMaxLength(200);
            e.Property(t => t.Status).HasConversion<string>().HasMaxLength(16);
            e.HasOne<Company>().WithMany().HasForeignKey(t => t.CompanyId);
            e.HasOne(t => t.Staff).WithMany(s => s.TimeOff).HasForeignKey(t => t.StaffId);
            e.HasIndex(t => new { t.CompanyId, t.Status, t.From });
        });

        b.Entity<SiteDay>(e =>
        {
            e.HasQueryFilter(d => d.CompanyId == CompanyId);
            e.Property(d => d.ForecastRevenue).HasPrecision(12, 2);
            e.Property(d => d.ActualRevenue).HasPrecision(12, 2);
            e.HasOne<Company>().WithMany().HasForeignKey(d => d.CompanyId);
            e.HasOne<Site>().WithMany().HasForeignKey(d => d.SiteId);
            e.HasIndex(d => new { d.SiteId, d.Date }).IsUnique();
        });

        // SQL Server rejects multiple cascade paths; deletes are explicit anyway.
        foreach (var fk in b.Model.GetEntityTypes().SelectMany(t => t.GetForeignKeys()))
            fk.DeleteBehavior = DeleteBehavior.Restrict;
    }
}
