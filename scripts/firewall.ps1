<#
  Windows Firewall: the thing that actually stops your phone.

  Axis binds to every address on this machine and always has. What stops the
  phone is Windows deciding that nothing from outside may reach the port. That
  is the default, and it is also what happens for ever after if the "Allow
  Node.js to communicate on this network?" box was ever cancelled - a block
  rule gets written and never mentioned again. Nothing logs an error. The phone
  simply spins.

  So: look, say what is in the way, and offer to move it.

  Modes
    (none)   Report. Needs no administrator, changes nothing.
    -Fix     Add the allow rule. Needs administrator - the launcher elevates
             into this and Windows asks you first.

  Exit codes from the report
    0  the way is clear
    1  the firewall is in the way          -> worth elevating
    2  couldn't tell (old or locked-down Windows)
    3  firewall is fine, the network is marked Public
#>
param(
  [switch]$Fix,
  [switch]$Private,
  [int]$Port = 3443,
  [string]$RuleName = "Axis phone access"
)

function Get-BlockingRules {
  # Block rules beat allow rules in Windows Firewall, so a leftover "no" from a
  # Node.js prompt defeats anything we add. These are the ones that matter.
  try {
    $blocks = Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True -ErrorAction Stop
    return @($blocks | Where-Object {
      $program = ($_ | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue).Program
      $program -and ($program -match 'node\.exe$')
    })
  } catch {
    return @()
  }
}

function Get-PublicProfiles {
  try {
    return @(Get-NetConnectionProfile -ErrorAction Stop | Where-Object { $_.NetworkCategory -eq 'Public' })
  } catch {
    return @()
  }
}

# ---------------------------------------------------------------- report ----

if (-not $Fix) {
  $firewallInTheWay = $false

  try {
    $rule = @(Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue)
    if ($rule.Count -eq 0) { $firewallInTheWay = $true }
    elseif (-not ($rule | Where-Object { $_.Enabled -eq 'True' })) { $firewallInTheWay = $true }
  } catch {
    Write-Host "  (Couldn't read this computer's firewall rules.)"
    exit 2
  }

  $blocks = Get-BlockingRules
  if ($blocks.Count -gt 0) {
    $firewallInTheWay = $true
    Write-Host ""
    Write-Host "  Windows is actively blocking Node.js from answering your phone."
    Write-Host "  That is what a cancelled 'Allow access?' box leaves behind."
    foreach ($b in $blocks) { Write-Host "      blocking rule: $($b.DisplayName)" }
  }

  if ($firewallInTheWay) { exit 1 }

  # The rule is there. A network marked Public is the other way this fails:
  # Public tells Windows to hide this computer from everything else on the
  # network, and home Wi-Fi gets marked Public more often than anyone expects.
  $public = Get-PublicProfiles
  if ($public.Count -gt 0) {
    Write-Host ""
    Write-Host "  The firewall is fine, but your network is set to Public:"
    foreach ($p in $public) { Write-Host "      $($p.Name)  ($($p.InterfaceAlias))" }
    Write-Host ""
    Write-Host "  Public tells Windows to hide this computer from every other"
    Write-Host "  device on the network - your own phone included."
    exit 3
  }

  exit 0
}

# ------------------------------------------------------------- fix mode ----
# From here on this is running as administrator, in its own window.

Write-Host ""
Write-Host "  Opening the door for Axis on port $Port..."
Write-Host ""

$changed = @()

foreach ($b in Get-BlockingRules) {
  try {
    Disable-NetFirewallRule -Name $b.Name -ErrorAction Stop
    # Turned off rather than deleted: reversible, and still visible under
    # Windows Defender Firewall > Advanced settings if you ever want it back.
    $changed += "turned off the block rule '$($b.DisplayName)'"
  } catch {
    Write-Host "  Couldn't turn off '$($b.DisplayName)': $($_.Exception.Message)"
  }
}

$added = $false
try {
  $existing = @(Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue)
  if ($existing.Count -gt 0) {
    Enable-NetFirewallRule -DisplayName $RuleName -ErrorAction Stop
    $changed += "switched the existing Axis rule back on"
  } else {
    # Private and Domain only, never Public. On a cafe or airport network this
    # computer should stay invisible, and Public is exactly what those are.
    New-NetFirewallRule -DisplayName $RuleName -Description "Lets your own phone reach Axis over your home Wi-Fi." -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private,Domain -ErrorAction Stop | Out-Null
    $changed += "added an allow rule for port $Port on private networks"
  }
  $added = $true
} catch {
  Write-Host "  The usual way didn't work ($($_.Exception.Message)), trying the old one..."
}

if (-not $added) {
  # netsh has been in Windows since XP and does the same job.
  netsh advfirewall firewall add rule "name=$RuleName" dir=in action=allow protocol=TCP "localport=$Port" profile=private,domain | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $changed += "added an allow rule for port $Port"
  } else {
    Write-Host ""
    Write-Host "  Couldn't add the firewall rule. You can add it by hand:"
    Write-Host "  Windows Defender Firewall > Advanced settings > Inbound Rules"
    Write-Host "  > New Rule > Port > TCP > $Port > Allow > Private only."
    Write-Host ""
    Start-Sleep -Seconds 8
    exit 1
  }
}

if ($Private) {
  foreach ($p in Get-PublicProfiles) {
    try {
      Set-NetConnectionProfile -InterfaceIndex $p.InterfaceIndex -NetworkCategory Private -ErrorAction Stop
      $changed += "set '$($p.Name)' from Public to Private"
    } catch {
      Write-Host "  Couldn't change '$($p.Name)': $($_.Exception.Message)"
    }
  }
}

Write-Host ""
foreach ($c in $changed) { Write-Host "  Done - $c." }
Write-Host ""
Write-Host "  Nothing else about this computer changed: one port, on your own"
Write-Host "  network only. From anywhere else Axis still asks for a passcode."
Write-Host ""
Start-Sleep -Seconds 4
exit 0
