param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$Node,[Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference='Continue'
$env:SWNW_CONTRACT_CONFIG=$Config
$logRoot=Join-Path (Split-Path $Config) 'logs'
while($true){
 Start-Process -FilePath $Node -ArgumentList ('"'+(Join-Path $Root 'scripts\contract-marketing-worker.mjs')+'"') -Wait -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'contract-marketing-out.log') -RedirectStandardError (Join-Path $logRoot 'contract-marketing-error.log')
 Start-Sleep -Seconds 15
}
