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

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Company>(e =>
        {
            e.Property(c => c.Name).HasMaxLength(80);
            e.Property(c => c.Slug).HasMaxLength(40);
            e.Property(c => c.Accent).HasMaxLength(7);
            e.Property(c => c.Currency).HasMaxLength(3);
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

        // SQL Server rejects multiple cascade paths; deletes are explicit anyway.
        foreach (var fk in b.Model.GetEntityTypes().SelectMany(t => t.GetForeignKeys()))
            fk.DeleteBehavior = DeleteBehavior.Restrict;
    }
}
