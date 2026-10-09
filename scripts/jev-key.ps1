param(
  [ValidateSet('Save', 'Read')][string]$Mode = 'Save',
  [string]$KeyFile = (Join-Path $PSScriptRoot '..\runtime\jev-key.dpapi')
)
$ErrorActionPreference = 'Stop'
# Windows Terminal can inherit PSModulePath from PowerShell 7. Windows
# PowerShell 5.1 must load its own Security module, including on the Read path.
# Check before asking for a secret so a module failure never wastes user input.
$taskSecurityModule = [IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Security', 'Microsoft.PowerShell.Security.psd1')
Import-Module -Name $taskSecurityModule -Force -ErrorAction Stop
if ($Mode -eq 'Save') {
  $taskSecret = Read-Host 'TypeSafe API key (hidden input)' -AsSecureString
  if ($taskSecret.Length -eq 0) { throw 'API key cannot be empty.' }
  $taskKeyDirectory = Split-Path -Parent $KeyFile
  New-Item -ItemType Directory -Path $taskKeyDirectory -Force | Out-Null
  $taskSecret | ConvertFrom-SecureString | Set-Content -LiteralPath $KeyFile -Encoding ASCII -NoNewline
  Write-Host 'Saved using Windows user encryption. The key is never written to source or logs.'
} else {
  $taskSecret = (Get-Content -LiteralPath $KeyFile -Raw).Trim() | ConvertTo-SecureString
  $taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
  try { [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer) }
}
