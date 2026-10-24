param([string]$ProcessIds = '')
$ErrorActionPreference = 'Stop'
# Test observer only. Never export command lines, environments, user names or URLs.
$query = @{}
if ($ProcessIds) {
    if ($ProcessIds -notmatch '^\d+(,\d+)*$') { throw 'Invalid process identity filter' }
    $query.Filter = (($ProcessIds.Split(',') | ForEach-Object { "ProcessId = $([uint32]$_)" }) -join ' OR ')
}
$rows = @(Get-CimInstance Win32_Process @query | Where-Object { $_.ProcessId -gt 0 -and $_.CreationDate } | ForEach-Object {
    $role = if ($_.CommandLine -match '--type=([^\s"]+)') { $Matches[1] } else { 'main-or-cli' }
    [ordered]@{
        pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId
        created = $_.CreationDate.ToUniversalTime().ToString('o')
        creationFileTime = $_.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)
        name = $_.Name; role = $role
        cpuMs = ([double]$_.KernelModeTime + [double]$_.UserModeTime) / 10000
        privateBytes = [double]$_.PrivatePageCount; workingBytes = [double]$_.WorkingSetSize
        readBytes = [double]$_.ReadTransferCount; writeBytes = [double]$_.WriteTransferCount
        handles = [int]$_.HandleCount
    }
})
[ordered]@{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); processes = $rows } | ConvertTo-Json -Depth 5 -Compress
