using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Rostra.Api.Data;
using Rostra.Api.Domain;

namespace Rostra.Api.Auth;

public record LoginInput(string? Email, string? Password, bool Remember);

public static class AuthEndpoints
{
    // Verifying against a throwaway hash for unknown emails keeps response times uniform.
    static readonly string DecoyHash = new PasswordHasher<Staff>().HashPassword(null!, Guid.NewGuid().ToString());

    public static void MapAuth(this WebApplication app)
    {
        app.MapPost("/auth/login", Login).RequireRateLimiting("login");
        app.MapPost("/auth/logout", async (HttpContext ctx) =>
        {
            await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        });

        if (app.Configuration.GetValue("Demo:Enabled", false))
            app.MapGet("/auth/demo", () => new { Password = SeedData.DemoPassword, Accounts = SeedData.DemoAccounts });
    }

    static async Task<IResult> Login(LoginInput input, RostraDb db, HttpContext ctx, IPasswordHasher<Staff> hasher)
    {
        var email = input.Email?.Trim().ToLowerInvariant() ?? "";
        var password = input.Password ?? "";

        var errors = new Dictionary<string, string[]>();
        if (email.Length == 0) errors["email"] = ["Enter your work email."];
        else if (!email.Contains('@')) errors["email"] = ["Enter a full email address, like name@venue.com."];
        if (password.Length == 0) errors["password"] = ["Enter your password."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        // Sign-in is the one place that looks across companies.
        var staff = await db.Staff.IgnoreQueryFilters().FirstOrDefaultAsync(s => s.Email == email && s.IsActive);
        var verdict = hasher.VerifyHashedPassword(staff!, staff?.PasswordHash ?? DecoyHash, password);
        if (staff is null || verdict == PasswordVerificationResult.Failed)
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["password"] = ["That email and password don’t match. Check both and try again."],
            });

        Claim[] claims =
        [
            new(ClaimTypes.NameIdentifier, staff.Id.ToString()),
            new(ClaimTypes.Name, staff.Name),
            new(ClaimTypes.Role, staff.Role.ToString()),
            new(ClaimsExtensions.CompanyClaim, staff.CompanyId.ToString()),
        ];
        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity),
            new AuthenticationProperties { IsPersistent = input.Remember });
        return Results.NoContent();
    }
}
