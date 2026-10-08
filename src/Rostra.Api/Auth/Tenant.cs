using System.Security.Claims;
using Rostra.Api.Domain;

namespace Rostra.Api.Auth;

public interface ITenant
{
    int? CompanyId { get; }
}

public sealed class HttpTenant(IHttpContextAccessor http) : ITenant
{
    public int? CompanyId => http.HttpContext?.User.CompanyId();
}

public static class ClaimsExtensions
{
    public const string CompanyClaim = "company_id";

    public static int? CompanyId(this ClaimsPrincipal user) =>
        int.TryParse(user.FindFirstValue(CompanyClaim), out var id) ? id : null;

    public static int StaffId(this ClaimsPrincipal user) =>
        int.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0;

    public static bool IsManager(this ClaimsPrincipal user) => user.IsInRole(nameof(StaffRole.Manager));
}
