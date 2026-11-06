param()

$ErrorActionPreference = "Stop"

$taskName = "Telescope YouGile KB Publisher"
$publisherScript = Join-Path $PSScriptRoot "publisher.mjs"
$nodeCommand = Get-Command "node" -ErrorAction Stop
$userName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

if (-not (Test-Path -LiteralPath $publisherScript)) {
    throw "Publisher script was not found: $publisherScript"
}

$action = New-ScheduledTaskAction `
    -Execute $nodeCommand.Source `
    -Argument ('"{0}" --publish --watch' -f $publisherScript) `
    -WorkingDirectory $PSScriptRoot

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userName
$principal = New-ScheduledTaskPrincipal `
    -UserId $userName `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Description "Polls the public Telescope meeting queue and publishes new files through the signed-in YouGile web interface." `
    -Force | Out-Null

Write-Output "Scheduled task installed: $taskName"
Write-Output "It starts at your next Windows sign-in. To remove it, delete that task in Task Scheduler."
