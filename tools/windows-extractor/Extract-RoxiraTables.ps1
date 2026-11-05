<#
 STUB (issue #353). Untested on Windows. Spec: tools/windows-extractor/README.md
 Usage:  .\Extract-RoxiraTables.ps1 -Server "localhost\HOLOO" -Database "Holoo1" -OutDir "C:\RoxiraExport" `
                                   -UploadCode "<one-time code from the Roxira portal>"
 Read-only: only SELECT statements are issued. Amounts leave as strings, never as doubles.
 Uploads the output to the same resumable part upload the web import uses. The upload code is a secret: pass it
 on the command line or read it from the portal, never commit it, and it is never written to any log.
#>
param(
  [Parameter(Mandatory)] [string] $Server,
  [Parameter(Mandatory)] [string] $Database,
  [Parameter(Mandatory)] [string] $OutDir,
  [string] $SqlUser,
  [string] $SqlPassword,  # prefer Windows authentication; never log this value
  [string] $UploadCode,   # one-time code from the portal; never log this value
  [string] $ApiBase = 'https://roxira.ir/api/backend'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$cs = if ($SqlUser) { "Server=$Server;Database=$Database;User ID=$SqlUser;Password=$SqlPassword;Encrypt=False" } else { "Server=$Server;Database=$Database;Integrated Security=True;Encrypt=False" }
$conn = New-Object System.Data.SqlClient.SqlConnection $cs
$conn.Open()

function Quote([string] $n) { '[' + $n.Replace(']', ']]') + ']' }
$asText = @('decimal','numeric','money','smallmoney','float','real','bigint')

$major = [int]($conn.ServerVersion.Split('.')[0])
$collation = (New-Object System.Data.SqlClient.SqlCommand "SELECT CONVERT(nvarchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation'))", $conn).ExecuteScalar()
$tables = New-Object System.Collections.ArrayList
$list = (New-Object System.Data.SqlClient.SqlCommand "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY 1, 2", $conn).ExecuteReader()
$names = @(); while ($list.Read()) { $names += ,@($list[0], $list[1]) }; $list.Close()

$n = 0
foreach ($t in $names) {
  $n++; $schema = $t[0]; $name = $t[1]; $file = "t$n.ndjson.gz"; $path = Join-Path $OutDir $file
  $colCmd = New-Object System.Data.SqlClient.SqlCommand "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @s AND TABLE_NAME = @t ORDER BY ORDINAL_POSITION", $conn
  [void]$colCmd.Parameters.AddWithValue('@s', $schema); [void]$colCmd.Parameters.AddWithValue('@t', $name)
  $r = $colCmd.ExecuteReader(); $cols = @(); while ($r.Read()) { $cols += ,@($r[0], $r[1]) }; $r.Close()
  $select = ($cols | ForEach-Object { if ($asText -contains $_[1]) { "CAST($(Quote $_[0]) AS nvarchar(64)) AS $(Quote $_[0])" } elseif (@('xml','text','ntext','sql_variant','hierarchyid','geography','geometry') -contains $_[1]) { "CAST($(Quote $_[0]) AS nvarchar(max)) AS $(Quote $_[0])" } else { Quote $_[0] } }) -join ', '
  $cmd = New-Object System.Data.SqlClient.SqlCommand "SELECT $select FROM $(Quote $schema).$(Quote $name)", $conn
  $cmd.CommandTimeout = 0
  $reader = $cmd.ExecuteReader([System.Data.CommandBehavior]::SequentialAccess)
  $fs = [System.IO.File]::Create($path)
  $gz = New-Object System.IO.Compression.GZipStream($fs, [System.IO.Compression.CompressionMode]::Compress)
  $sw = New-Object System.IO.StreamWriter($gz, (New-Object System.Text.UTF8Encoding($false)))
  $rows = 0
  while ($reader.Read()) {
    $o = [ordered]@{}
    for ($i = 0; $i -lt $reader.FieldCount; $i++) {
      $v = $reader.GetValue($i)
      $o[$reader.GetName($i)] = if ($v -is [DBNull]) { $null } elseif ($v -is [byte[]]) { [Convert]::ToBase64String($v) } elseif ($v -is [datetime]) { $v.ToString('yyyy-MM-ddTHH:mm:ss.fff') } else { $v }
    }
    $sw.WriteLine(($o | ConvertTo-Json -Compress -Depth 3)); $rows++
  }
  $sw.Dispose(); $reader.Close()
  $sha = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
  [void]$tables.Add(@{ schema = $schema; name = $name; rows = $rows; file = $file; sha256 = $sha; columns = @($cols | ForEach-Object { @{ name = $_[0]; type = $_[1] } }) })
  Write-Host "$schema.$name $rows rows"
}
$manifest = @{ version = 1; source = @{ kind = 'extractor'; sqlMajor = $major; databaseName = $Database; collation = $collation; createdAt = (Get-Date).ToUniversalTime().ToString('o') }; tables = $tables }
$manifestJson = $manifest | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText((Join-Path $OutDir 'manifest.json'), $manifestJson, (New-Object System.Text.UTF8Encoding($false)))

# ---- Upload (resumable multipart, the same protocol as frontend/src/lib/upload/resumable-upload.ts) ----
# One object per file (manifest.json and each tN.ndjson.gz); 64 MiB parts are PUT straight to storage and only the
# parts the server is still missing are sent, so a stopped or interrupted run resumes by passing -UploadCode again.
$script:headers = @{}
if ($UploadCode) { $script:headers = @{ Authorization = "Bearer $UploadCode" } }

function Send-RoxiraJson([string] $Method, [string] $Url, $Body) {
  $json = if ($null -eq $Body) { $null } else { $Body | ConvertTo-Json -Compress -Depth 5 }
  Invoke-RestMethod -Method $Method -Uri $Url -Headers $script:headers -ContentType 'application/json; charset=utf-8' -Body $json
}

function Upload-RoxiraFile([string] $Path, [string] $Name) {
  $size = [long](Get-Item -LiteralPath $Path).Length
  $base = "$ApiBase/enterprise-hub/data-import/bulk"
  $start = Send-RoxiraJson Post "$base/uploads" @{ fileName = $Name; size = $size }
  $jobId = $start.jobId; $partBytes = [long]$start.partBytes; $totalParts = [int]$start.totalParts
  $direct = [bool]$start.direct; $proxyParts = [bool]$start.proxyParts; $checksums = [bool]$start.checksums
  if (-not $direct -and -not $proxyParts) { throw "the server cannot accept an upload right now" }

  $have = @{}
  try {
    $parts = Invoke-RestMethod -Method Get -Uri "$base/uploads/$jobId/parts" -Headers $script:headers
    foreach ($p in $parts.uploaded) { $have[[int]$p.partNumber] = [long]$p.size }
  } catch { $have = @{} }

  $fs = [System.IO.File]::OpenRead($Path)
  try {
    for ($n = 1; $n -le $totalParts; $n++) {
      $len = if ($n -lt $totalParts) { $partBytes } else { $size - $partBytes * ($totalParts - 1) }
      if ($have.ContainsKey($n) -and $have[$n] -eq $len) { continue }
      $buf = [byte[]]::new([int]$len)
      $fs.Position = [long]($n - 1) * $partBytes
      $read = 0
      while ($read -lt $len) {
        $got = $fs.Read($buf, $read, [int]($len - $read))
        if ($got -le 0) { break }
        $read += $got
      }
      $checks = @{}
      if ($checksums) {
        $digest = [System.Security.Cryptography.SHA256]::Create().ComputeHash($buf, 0, $read)
        $checks["$n"] = [Convert]::ToBase64String($digest)
      }
      if ($direct) {
        $signed = Send-RoxiraJson Post "$base/uploads/$jobId/sign" @{ partNumbers = @($n); checksums = $checks }
        $url = $signed.urls."$n"
        if (-not $url) { throw "the server returned no URL for part $n" }
        $putHeaders = @{}
        if ($signed.headers -and $signed.headers."$n") { foreach ($k in $signed.headers."$n".PSObject.Properties.Name) { $putHeaders[$k] = $signed.headers."$n".$k } }
        Invoke-WebRequest -Method Put -Uri $url -Headers $putHeaders -Body $buf -TimeoutSec 3600 | Out-Null
      } else {
        $extra = @{ 'Content-Type' = 'application/octet-stream' }
        if ($checksums -and $checks.ContainsKey("$n")) { $extra['x-amz-checksum-sha256'] = $checks["$n"] }
        Invoke-WebRequest -Method Put -Uri "$base/uploads/$jobId/parts/$n" -Headers ($script:headers + $extra) -Body $buf -TimeoutSec 3600 | Out-Null
      }
    }
  } finally {
    $fs.Dispose()
  }
  Send-RoxiraJson Post "$base/uploads/$jobId/complete" $null | Out-Null
  Write-Host "uploaded $Name ($size bytes, $totalParts parts)"
}

$conn.Close()
if ($UploadCode) {
  foreach ($t in $tables) { Upload-RoxiraFile (Join-Path $OutDir $t.file) $t.file }
  Upload-RoxiraFile (Join-Path $OutDir 'manifest.json') 'manifest.json'
  Write-Host "Done. Uploaded from $OutDir."
} else {
  Write-Host "Done. No -UploadCode given, so nothing was uploaded; the export is in $OutDir."
}
