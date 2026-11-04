<#
 STUB (issue #353). Untested on Windows. Spec: tools/windows-extractor/README.md
 Usage:  .\Extract-RoxiraTables.ps1 -Server "localhost\HOLOO" -Database "Holoo1" -OutDir "C:\RoxiraExport"
 Read-only: only SELECT statements are issued. Amounts leave as strings, never as doubles.
#>
param(
  [Parameter(Mandatory)] [string] $Server,
  [Parameter(Mandatory)] [string] $Database,
  [Parameter(Mandatory)] [string] $OutDir,
  [string] $SqlUser,
  [string] $SqlPassword  # prefer Windows authentication; never log this value
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
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $OutDir 'manifest.json')
$conn.Close()
# TODO(#353): upload $OutDir with the resumable part protocol (/enterprise-hub/data-import/bulk/uploads, upload code from the portal).
Write-Host "Done. Upload is not implemented in this stub."
