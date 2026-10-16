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
    public DbSet<RosterWeek> RosterWeeks => Set<RosterWeek>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<Announcement> Announcements => Set<Announcement>();
    public DbSet<AnnouncementRead> AnnouncementReads => Set<AnnouncementRead>();
    public DbSet<Kudos> Kudos => Set<Kudos>();
    public DbSet<TimesheetApproval> TimesheetApprovals => Set<TimesheetApproval>();

    /// <summary>Bump when the model changes; a local SQLite demo database from another version is rebuilt.</summary>
    public const int SchemaVersion = 3;

    /// <summary>Shifts staff are allowed to see: those in a site-week the manager has published.</summary>
    public IQueryable<Shift> PublishedShifts => Shifts.Where(s =>
        RosterWeeks.Any(w => w.SiteId == s.SiteId && w.Status == RosterStatus.Published && w.Start <= s.Start && s.Start < w.End));

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
            e.Property(c => c.DefaultAppearance).HasMaxLength(200);
            e.Ignore(c => c.SouthernHemisphere);
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
            e.Property(s => s.CalendarToken).HasMaxLength(64);
            e.Property(s => s.Appearance).HasMaxLength(200);
            e.HasIndex(s => s.CalendarToken).IsUnique();
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
            e.Ignore(s => s.IsOpen);
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
            e.Property(t => t.Type).HasConversion<string>().HasMaxLength(16);
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

        b.Entity<RosterWeek>(e =>
        {
            e.HasQueryFilter(w => w.CompanyId == CompanyId);
            e.Property(w => w.Status).HasConversion<string>().HasMaxLength(16);
            e.HasOne<Company>().WithMany().HasForeignKey(w => w.CompanyId);
            e.HasOne<Site>().WithMany().HasForeignKey(w => w.SiteId);
            e.HasOne<Staff>().WithMany().HasForeignKey(w => w.PublishedById);
            e.HasIndex(w => new { w.SiteId, w.Start }).IsUnique();
        });

        b.Entity<Notification>(e =>
        {
            e.HasQueryFilter(n => n.CompanyId == CompanyId);
            e.Property(n => n.Kind).HasMaxLength(32);
            e.Property(n => n.Title).HasMaxLength(200);
            e.Property(n => n.Body).HasMaxLength(400);
            e.Property(n => n.Link).HasMaxLength(200);
            e.HasOne<Company>().WithMany().HasForeignKey(n => n.CompanyId);
            e.HasOne<Staff>().WithMany().HasForeignKey(n => n.StaffId);
            e.HasIndex(n => new { n.StaffId, n.CreatedAt });
        });

        b.Entity<Announcement>(e =>
        {
            e.HasQueryFilter(a => a.CompanyId == CompanyId);
            e.Property(a => a.Title).HasMaxLength(120);
            e.Property(a => a.Body).HasMaxLength(2000);
            e.HasOne<Company>().WithMany().HasForeignKey(a => a.CompanyId);
            e.HasOne<Site>().WithMany().HasForeignKey(a => a.SiteId);
            e.HasOne(a => a.Author).WithMany().HasForeignKey(a => a.AuthorId);
            e.HasIndex(a => new { a.CompanyId, a.CreatedAt });
        });

        b.Entity<AnnouncementRead>(e =>
        {
            e.HasQueryFilter(r => r.CompanyId == CompanyId);
            e.HasOne<Announcement>().WithMany().HasForeignKey(r => r.AnnouncementId);
            e.HasOne<Staff>().WithMany().HasForeignKey(r => r.StaffId);
            e.HasIndex(r => new { r.AnnouncementId, r.StaffId }).IsUnique();
        });

        b.Entity<Kudos>(e =>
        {
            e.HasQueryFilter(k => k.CompanyId == CompanyId);
            e.Property(k => k.Message).HasMaxLength(140);
            e.HasOne<Company>().WithMany().HasForeignKey(k => k.CompanyId);
            e.HasOne(k => k.From).WithMany().HasForeignKey(k => k.FromId);
            e.HasOne(k => k.To).WithMany().HasForeignKey(k => k.ToId);
            e.HasIndex(k => new { k.ToId, k.CreatedAt });
        });

        b.Entity<TimesheetApproval>(e =>
        {
            e.HasQueryFilter(t => t.CompanyId == CompanyId);
            e.HasOne<Company>().WithMany().HasForeignKey(t => t.CompanyId);
            e.HasOne<Staff>().WithMany().HasForeignKey(t => t.StaffId);
            e.HasOne<Staff>().WithMany().HasForeignKey(t => t.ApprovedById);
            e.HasIndex(t => new { t.StaffId, t.WeekStart }).IsUnique();
        });

        // SQL Server rejects multiple cascade paths; deletes are explicit anyway.
        foreach (var fk in b.Model.GetEntityTypes().SelectMany(t => t.GetForeignKeys()))
            fk.DeleteBehavior = DeleteBehavior.Restrict;
    }
}
