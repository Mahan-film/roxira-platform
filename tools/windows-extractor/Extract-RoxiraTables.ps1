<#
 STUB (issue #353 / #395). Untested on Windows. Spec: tools/windows-extractor/README.md
 Usage:  .\Extract-RoxiraTables.ps1 -Server "localhost\HOLOO" -Database "Holoo1" -OutDir "C:\RoxiraExport" [-ApiBaseUrl "https://app.roxira.ir/api/backend" -UploadCode "<code-from-portal>"]
 Read-only: only SELECT statements are issued. Amounts leave as strings, never as doubles.
 Never logs or echoes -SqlPassword or -UploadCode.
#>
param(
  [Parameter(Mandatory)] [string] $Server,
  [Parameter(Mandatory)] [string] $Database,
  [Parameter(Mandatory)] [string] $OutDir,
  [string] $SqlUser,
  [string] $SqlPassword,  # prefer Windows authentication; never log this value
  [string] $ApiBaseUrl,
  [string] $UploadCode,   # one-time upload token from the portal; never log this value
  [string] $ResumeJobId,
  [int] $MaxRetries = 6,
  [int] $FallbackAfter = 3
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

function Invoke-RoxiraApi {
  param(
    [string] $Method,
    [string] $Uri,
    [string] $Token,
    [object] $Body
  )
  $headers = @{ Authorization = "Bearer $Token"; Accept = 'application/json' }
  $params = @{ Method = $Method; Uri = $Uri; Headers = $headers; UseBasicParsing = $true }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json; charset=utf-8'
    $params.Body = ($Body | ConvertTo-Json -Compress -Depth 6)
  }
  Invoke-RestMethod @params
}

function Get-PartSha256Base64 {
  param([byte[]] $Buffer, [int] $Count)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha256.ComputeHash($Buffer, 0, $Count)
    return [Convert]::ToBase64String($hash)
  } finally {
    $sha256.Dispose()
  }
}

function Send-ResumableBundle {
  param(
    [string] $ArchivePath,
    [string] $BaseUrl,
    [string] $Token,
    [string] $ExistingJobId,
    [int] $Retries,
    [int] $DirectFallbackThreshold
  )
  $root = $BaseUrl.TrimEnd('/')
  $uploadsBase = "$root/enterprise-hub/data-import/bulk/uploads"
  $configUrl = "$root/enterprise-hub/data-import/bulk/config"
  $fileInfo = Get-Item -LiteralPath $ArchivePath
  $fileSize = [long]$fileInfo.Length

  if ($ExistingJobId) {
    $jobId = $ExistingJobId
    $partsResp = Invoke-RoxiraApi -Method 'GET' -Uri "$uploadsBase/$jobId/parts" -Token $Token -Body $null
    $cfgResp = Invoke-RoxiraApi -Method 'GET' -Uri $configUrl -Token $Token -Body $null
    $partBytes = [long]$partsResp.partBytes
    $totalParts = [int]$partsResp.totalParts
    $direct = [bool]$cfgResp.direct
    $proxyParts = [bool]$cfgResp.proxyParts
    $checksumsEnabled = [bool]$cfgResp.checksums
  } else {
    $startResp = Invoke-RoxiraApi -Method 'POST' -Uri $uploadsBase -Token $Token -Body @{
      fileName = $fileInfo.Name
      size = $fileSize
    }
    $jobId = [string]$startResp.jobId
    $partBytes = [long]$startResp.partBytes
    $totalParts = [int]$startResp.totalParts
    $direct = [bool]$startResp.direct
    $proxyParts = [bool]$startResp.proxyParts
    $checksumsEnabled = [bool]$startResp.checksums
    $partsResp = Invoke-RoxiraApi -Method 'GET' -Uri "$uploadsBase/$jobId/parts" -Token $Token -Body $null
  }

  $have = @{}
  foreach ($p in $partsResp.uploaded) {
    $have[[int]$p.partNumber] = [long]$p.size
  }

  $useApi = (-not $direct) -and $proxyParts
  if ((-not $direct) -and (-not $proxyParts)) {
    throw 'Server has neither direct storage upload nor API part relay enabled.'
  }

  $networkFailures = 0
  $stream = [System.IO.File]::OpenRead($ArchivePath)
  $http = New-Object System.Net.Http.HttpClient
  $http.Timeout = [TimeSpan]::FromMinutes(10)
  try {
    for ($partNumber = 1; $partNumber -le $totalParts; $partNumber++) {
      $expectedSize = if ($partNumber -lt $totalParts) { $partBytes } else { $fileSize - ($partBytes * ($totalParts - 1)) }
      if ($have.ContainsKey($partNumber) -and $have[$partNumber] -eq $expectedSize) {
        Write-Host "Part $partNumber/$totalParts already uploaded (resumed)"
        continue
      }

      $offset = ($partNumber - 1) * $partBytes
      [void]$stream.Seek($offset, [System.IO.SeekOrigin]::Begin)
      $buffer = New-Object byte[] $expectedSize
      $readTotal = 0
      while ($readTotal -lt $expectedSize) {
        $readNow = $stream.Read($buffer, $readTotal, [int]($expectedSize - $readTotal))
        if ($readNow -le 0) { throw "Unexpected EOF reading part $partNumber" }
        $readTotal += $readNow
      }

      $checksumMap = @{}
      $checksumB64 = $null
      if ($checksumsEnabled) {
        $checksumB64 = Get-PartSha256Base64 -Buffer $buffer -Count $readTotal
        $checksumMap["$partNumber"] = $checksumB64
      }

      $uploaded = $false
      for ($attempt = 0; $attempt -le $Retries; $attempt++) {
        try {
          if (-not $useApi) {
            $signResp = Invoke-RoxiraApi -Method 'POST' -Uri "$uploadsBase/$jobId/sign" -Token $Token -Body @{
              partNumbers = @($partNumber)
              checksums = $checksumMap
            }
            $putUrl = [string]$signResp.urls."$partNumber"
            $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Put, $putUrl)
            $req.Content = New-Object System.Net.Http.ByteArrayContent($buffer, 0, $readTotal)
            if ($signResp.headers -and $signResp.headers."$partNumber") {
              foreach ($prop in $signResp.headers."$partNumber".PSObject.Properties) {
                if ($prop.Name -ieq 'Content-Type') {
                  $req.Content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse([string]$prop.Value)
                } else {
                  [void]$req.Headers.TryAddWithoutValidation($prop.Name, [string]$prop.Value)
                }
              }
            }
            $res = $http.SendAsync($req).GetAwaiter().GetResult()
            if (-not $res.IsSuccessStatusCode) {
              throw "Direct PUT failed with HTTP $([int]$res.StatusCode)"
            }
            $networkFailures = 0
            $uploaded = $true
            break
          } else {
            $proxyUrl = "$uploadsBase/$jobId/parts/$partNumber"
            $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Put, $proxyUrl)
            [void]$req.Headers.TryAddWithoutValidation('Authorization', "Bearer $Token")
            if ($checksumB64) {
              [void]$req.Headers.TryAddWithoutValidation('x-amz-checksum-sha256', $checksumB64)
            }
            $req.Content = New-Object System.Net.Http.ByteArrayContent($buffer, 0, $readTotal)
            $req.Content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/octet-stream')
            $res = $http.SendAsync($req).GetAwaiter().GetResult()
            if (-not $res.IsSuccessStatusCode) {
              throw "Proxy PUT failed with HTTP $([int]$res.StatusCode)"
            }
            $uploaded = $true
            break
          }
        } catch {
          if (-not $useApi -and $proxyParts) {
            $networkFailures++
            if ($networkFailures -ge $DirectFallbackThreshold) {
              Write-Host "Switching part upload to API relay after $networkFailures direct failures."
              $useApi = $true
              continue
            }
          }
          if ($attempt -ge $Retries) {
            throw
          }
          Start-Sleep -Seconds ([Math]::Min(30, [Math]::Pow(2, $attempt)))
        }
      }
      if (-not $uploaded) {
        throw "Failed uploading part $partNumber"
      }
      Write-Host "Uploaded part $partNumber/$totalParts"
    }
  } finally {
    $stream.Dispose()
    $http.Dispose()
  }

  [void](Invoke-RoxiraApi -Method 'POST' -Uri "$uploadsBase/$jobId/complete" -Token $Token -Body @{})
  Write-Host "Upload complete. Job ID: $jobId"
}

if ($UploadCode) {
  if (-not $ApiBaseUrl) {
    throw '-ApiBaseUrl is required when -UploadCode is provided.'
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $bundlePath = Join-Path ([System.IO.Path]::GetTempPath()) ("roxira-export-" + [Guid]::NewGuid().ToString('N') + '.zip')
  try {
    [System.IO.Compression.ZipFile]::CreateFromDirectory($OutDir, $bundlePath, [System.IO.Compression.CompressionLevel]::NoCompression, $false)
    Send-ResumableBundle -ArchivePath $bundlePath -BaseUrl $ApiBaseUrl -Token $UploadCode -ExistingJobId $ResumeJobId -Retries $MaxRetries -DirectFallbackThreshold $FallbackAfter
  } finally {
    if (Test-Path -LiteralPath $bundlePath) {
      Remove-Item -LiteralPath $bundlePath -Force -ErrorAction SilentlyContinue
    }
  }
} else {
  Write-Host "Export written to $OutDir. Pass -ApiBaseUrl and -UploadCode to upload."
}
