param(
  [string]$Project = (Get-Location).Path,
  [switch]$Apply
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackRoot = Resolve-Path (Join-Path $ScriptDir "..")
$Cli = Join-Path $PackRoot "bin/demo-foundry.mjs"

if ($Apply) {
  node $Cli init --project $Project --apply
} else {
  node $Cli init --project $Project
}
