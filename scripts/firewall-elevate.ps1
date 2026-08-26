<#
  Ask Windows for permission, then run firewall.ps1 with it.

  Its own file for one boring reason: carrying a quoted path through cmd.exe,
  into PowerShell, through Start-Process and out to a second PowerShell is four
  layers of escaping, and it comes apart on any folder name with a space in it.
  Here the path is a variable and nothing has to be escaped by hand.
#>
param(
  [int]$Port = 3443,
  [switch]$Private
)

$target = Join-Path $PSScriptRoot "firewall.ps1"
if (-not (Test-Path -LiteralPath $target)) {
  Write-Host "  Can't find $target"
  exit 1
}

$arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$target`"", "-Fix", "-Port", "$Port")
if ($Private) { $arguments += "-Private" }

try {
  Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -ArgumentList $arguments
  exit 0
} catch {
  # Almost always: the permission box was closed or declined.
  Write-Host "  Windows didn't give permission: $($_.Exception.Message)"
  exit 1
}
