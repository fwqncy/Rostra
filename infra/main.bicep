// Rostra on Azure: App Service (Linux, .NET 8) + Azure SQL Database + Application Insights.
targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('azd environment name, used to name the resource group and resources.')
param environmentName string

@minLength(1)
param location string

@description('SQL administrator login.')
param sqlAdminLogin string = 'rostraadmin'

@secure()
@description('SQL administrator password (set with: azd env set AZURE_SQL_PASSWORD <value>).')
param sqlAdminPassword string

var tags = { 'azd-env-name': environmentName }

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  name: 'rostra-resources'
  scope: rg
  params: {
    location: location
    tags: tags
    sqlAdminLogin: sqlAdminLogin
    sqlAdminPassword: sqlAdminPassword
  }
}

output AZURE_RESOURCE_GROUP string = rg.name
output WEB_URL string = resources.outputs.webUrl
