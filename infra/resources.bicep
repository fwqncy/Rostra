param location string
param tags object
param sqlAdminLogin string
@secure()
param sqlAdminPassword string

var suffix = uniqueString(resourceGroup().id)

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-rostra-${suffix}'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-rostra-${suffix}'
  location: location
  tags: tags
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id }
}

resource sql 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: 'sql-rostra-${suffix}'
  location: location
  tags: tags
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource db 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sql
  name: 'Rostra'
  location: location
  tags: tags
  sku: { name: 'Basic', tier: 'Basic' }
}

// 0.0.0.0 is Azure's convention for "allow other Azure services", i.e. the web app.
resource allowAzure 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sql
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-rostra-${suffix}'
  location: location
  tags: tags
  kind: 'linux'
  sku: { name: 'B1' }
  properties: { reserved: true }
}

resource web 'Microsoft.Web/sites@2023-12-01' = {
  name: 'app-rostra-${suffix}'
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|8.0'
      alwaysOn: true // keeps the live (SSE) connection hub warm
      http20Enabled: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      healthCheckPath: '/healthz'
      appSettings: [
        { name: 'Database__Provider', value: 'SqlServer' }
        { name: 'Demo__Enabled', value: 'true' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
        { name: 'ApplicationInsightsAgent_EXTENSION_VERSION', value: '~3' }
      ]
      // Surfaces as SQLAZURECONNSTR_Rostra, which ASP.NET Core reads as ConnectionStrings:Rostra.
      connectionStrings: [
        {
          name: 'Rostra'
          type: 'SQLAzure'
          connectionString: 'Server=tcp:${sql.properties.fullyQualifiedDomainName},1433;Database=${db.name};User ID=${sqlAdminLogin};Password=${sqlAdminPassword};Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;'
        }
      ]
    }
  }
}

output webUrl string = 'https://${web.properties.defaultHostName}'
