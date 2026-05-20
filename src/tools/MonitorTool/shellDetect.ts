/**
 * Detect whether a shell command targets PowerShell or bash.
 *
 * Used by MonitorTool to route the command to the correct shell provider
 * (pipe mode for PowerShell, file mode for bash).
 *
 * PowerShelldice indicators (checked in order):
 * 1. Cmdlets: Write-Host, Get-ChildItem, etc.
 * 2. PowerShell comparison operators: -le, -ge, -eq, -ne, -lt, -gt
 * 3. PowerShell variable syntax: $var (but not $(…) bash subshell)
 *
 * Bash for/while/until loops end with 'done' — checked before PS variables
 * to prevent false positives on bash loop variables ($i, $j, $n).
 *
 * Everything else defaults to bash.
 */
export function detectShell(command: string): 'bash' | 'powershell' {
  // Bash for/while/until loops end with 'done' — never PowerShell.
  // Check before psVarRE to prevent false positives on bash loop
  // variables ($i, $j, $n) that look like PowerShell variables.
  if (/\bdone\b/.test(command) && /\b(do|for|while|until)\b/.test(command)) return 'bash'

  // PowerShell cmdlet pattern (Verb-Noun)
  const cmdletRE =
    /\b(Write-(?:Host|Output|Error|Warning|Verbose|Debug|Progress|Information)|Get-\w+|Set-\w+|New-\w+|Remove-\w+|Start-\w+|Stop-\w+|Invoke-\w+|ForEach-Object|Where-Object|Select-Object|Out-\w+|Export-\w+|Import-\w+|ConvertTo-\w+|ConvertFrom-\w+|Test-\w+|Measure-\w+|Format-\w+|Receive-\w+|Send-\w+|Read-\w+|Clear-\w+|Copy-\w+|Move-\w+|Rename-\w+|Enable-\w+|Disable-\w+|Register-\w+|Unregister-\w+|Wait-\w+|Tee-Object|Group-Object|Sort-Object)\b/

  // PowerShell variable: $name or $env:NAME but NOT $(…) bash subshell
  const psVarRE = /\$(?![({?])[a-zA-Z_]\w*/

  // PowerShell comparison operators (surrounded by whitespace)
  const psOpRE =
    /\s-(le|ge|eq|ne|lt|gt|like|match|notmatch|contains|notcontains|in|notin|replace|creplace|ireplace|split|csplit|isplit|join|cjoin|ijoin)\s/

  if (cmdletRE.test(command)) return 'powershell'
  if (psVarRE.test(command)) return 'powershell'
  if (psOpRE.test(command)) return 'powershell'

  return 'bash'
}
