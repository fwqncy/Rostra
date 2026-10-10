using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Rostra.Api.Auth;
using Rostra.Api.Dashboard;
using Rostra.Api.Home;
using Rostra.Api.Data;
using Rostra.Api.Domain;
using Rostra.Api.Infrastructure;
using Rostra.Api.Shifts;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ITenant, HttpTenant>();
builder.Services.AddDbContext<RostraDb>(options =>
{
    var connection = builder.Configuration.GetConnectionString("Rostra");
    if (string.IsNullOrWhiteSpace(connection))
        throw new InvalidOperationException("Set ConnectionStrings:Rostra (see README).");

    // SQL Server (Azure SQL) in production; SQLite lets `dotnet run` work with zero setup.
    if (builder.Configuration["Database:Provider"] == "Sqlite")
        options.UseSqlite(connection);
    else
        options.UseSqlServer(connection, sql => sql.EnableRetryOnFailure());
});

builder.Services.AddSingleton<EventHub>();
if (builder.Configuration.GetValue("Demo:Enabled", false))
    builder.Services.AddHostedService<DemoCrewService>();
builder.Services.AddScoped<INotifier, LiveNotifier>();
builder.Services.AddSingleton<IPasswordHasher<Staff>, PasswordHasher<Staff>>();
builder.Services.AddMemoryCache();
builder.Services.AddHealthChecks();
builder.Services.AddProblemDetails();
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.Cookie.Name = "rostra.auth";
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Strict;
        o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        o.ExpireTimeSpan = TimeSpan.FromHours(12);
        o.SlidingExpiration = true;
        // This is an API for the SPA: answer with status codes, never redirects.
        o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
    });

builder.Services.AddAuthorizationBuilder()
    .AddPolicy("Staff", p => p.RequireRole(nameof(StaffRole.Staff), nameof(StaffRole.Manager)))
    .AddPolicy("Manager", p => p.RequireRole(nameof(StaffRole.Manager)));

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<RostraDb>();
    await db.Database.EnsureCreatedAsync();

    // EnsureCreated can't evolve a schema. A local SQLite demo DB from an older version is simply rebuilt.
    if (db.Database.IsSqlite() && !await SchemaIsCurrentAsync(db))
    {
        app.Logger.LogWarning("Local demo database is from an older version of Rostra; recreating it.");
        var file = new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder(db.Database.GetConnectionString()).DataSource;
        await db.Database.CloseConnectionAsync();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        // Remove the WAL/SHM side files too, or SQLite reports a disk I/O error on the fresh file.
        foreach (var path in new[] { file, $"{file}-wal", $"{file}-shm" })
            if (File.Exists(path)) File.Delete(path);
        await db.Database.EnsureCreatedAsync();
    }

    if (app.Configuration.GetValue("Demo:Enabled", false))
    {
        await SeedData.SeedAsync(db, DateOnly.FromDateTime(DateTime.Today));
        await DemoCrew.TickAsync(db, null);
    }
}

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler();
    app.UseHsts();
}

app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h.XContentTypeOptions = "nosniff";
    h["Referrer-Policy"] = "strict-origin-when-cross-origin";
    h.XFrameOptions = "DENY";
    h.ContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        // Assets are small and unversioned: always revalidate so a deploy shows up immediately.
        ctx.Context.Response.Headers.CacheControl = "no-cache";
    },
});
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<IdempotencyMiddleware>();

app.MapHealthChecks("/healthz");
app.MapAuth();
app.MapRoster();
app.MapSwaps();
app.MapDashboard();
app.MapHome();

// Client-side routes (/login, /app/schedule, …) all load the single-page app.
app.MapFallbackToFile("index.html");

app.Run();

static async Task<bool> SchemaIsCurrentAsync(RostraDb db)
{
    // Look for the newest table and column without throwing (and logging) on an old schema.
    var tables = await db.Database
        .SqlQuery<int>($"SELECT COUNT(*) AS Value FROM sqlite_master WHERE type = 'table' AND name IN ('ClockEvents', 'SiteDays', 'TimeOff')")
        .SingleAsync();
    var columns = await db.Database
        .SqlQuery<int>($"SELECT (SELECT COUNT(*) FROM pragma_table_info('Staff') WHERE name = 'CertificationExpires') + (SELECT COUNT(*) FROM pragma_table_info('Companies') WHERE name = 'TimeZone') AS Value")
        .SingleAsync();
    return tables == 3 && columns == 2;
}
