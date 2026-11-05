#requires -Version 5.1
# Pester 5 tests for tools/windows-extractor/Extract-RoxiraTables.ps1.
#
#   Install-Module Pester -Scope CurrentUser      # once, if it is missing
#   Invoke-Pester tools/windows-extractor/Extract-RoxiraTables.Tests.ps1
#
# The upload is exercised against a mock HTTP server (System.Net.HttpListener) that answers the resumable part
# protocol. The extractor's own functions are parsed out of the script, so no SQL Server is contacted and the
# Windows-only database path stays a manual step. On Windows a standard user may need a one-time
# `netsh http add urlacl url=http://127.0.0.1:20000/ user=Everyone` for the loopback prefix.

BeforeAll {
  $script:ScriptPath = Join-Path $PSScriptRoot 'Extract-RoxiraTables.ps1'
  $script:ScriptSource = Get-Content -Raw -LiteralPath $script:ScriptPath

  $tokens = $null
  $parseErrors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($script:ScriptPath, [ref]$tokens, [ref]$parseErrors)
  foreach ($fn in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    Invoke-Expression $fn.Extent.Text
  }
}

Describe 'Extract-RoxiraTables.ps1 safety' {
  It 'takes every secret from the caller, with no default' {
    $script:ScriptSource | Should -Not -Match 'UploadCode\s*='
    $script:ScriptSource | Should -Not -Match 'SqlPassword\s*='
  }

  It 'issues SELECT statements only' {
    foreach ($verb in 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC', 'MERGE') {
      [regex]::IsMatch($script:ScriptSource, "\b$verb\b", 'None') | Should -BeFalse -Because "$verb is never issued"
    }
    [regex]::IsMatch($script:ScriptSource, '\bSELECT\b', 'None') | Should -BeTrue
  }

  It 'never writes the upload code or the password to any output' {
    $script:ScriptSource | Should -Not -Match 'Write-\w+.*(UploadCode|SqlPassword)'
    $script:ScriptSource | Should -Not -Match 'ConvertTo-Json.*(UploadCode|SqlPassword)'
  }
}

Describe 'resumable upload against a mock HTTP server' {
  It 'sends start, parts, sign, PUT and complete for one file' {
    $port = Get-Random -Minimum 20000 -Maximum 40000
    $logPath = Join-Path ([System.IO.Path]::GetTempPath()) ("roxira-upload-{0}.log" -f $port)
    $filePath = Join-Path ([System.IO.Path]::GetTempPath()) ("roxira-part-{0}.bin" -f $port)
    [System.IO.File]::WriteAllBytes($filePath, [byte[]](1, 2, 3, 4))

    $server = Start-Job -ArgumentList $port, $logPath -ScriptBlock {
      param($listenPort, $logFile)
      $listener = [System.Net.HttpListener]::new()
      $listener.Prefixes.Add("http://127.0.0.1:$listenPort/")
      $listener.Start()
      $seen = New-Object System.Collections.Generic.List[string]
      try {
        for ($i = 0; $i -lt 5; $i++) {
          $context = $listener.GetContext()
          $request = $context.Request
          $response = $context.Response
          $path = $request.Url.AbsolutePath
          $seen.Add("$($request.HttpMethod) $path")
          $payload = '{}'
          if ($request.HttpMethod -eq 'POST' -and $path -like '*/uploads') {
            $payload = '{"jobId":"11111111-1111-4111-8111-111111111111","partBytes":4,"totalParts":1,"direct":true,"proxyParts":false,"checksums":false}'
          } elseif ($request.HttpMethod -eq 'GET') {
            $payload = '{"partBytes":4,"totalParts":1,"uploaded":[]}'
          } elseif ($path -like '*/sign') {
            $payload = "{`"urls`":{`"1`":`"http://127.0.0.1:$listenPort/put/1`"}}"
          }
          $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
          $response.StatusCode = 200
          $response.ContentType = 'application/json'
          $response.ContentLength64 = $bytes.Length
          $response.OutputStream.Write($bytes, 0, $bytes.Length)
          $response.Close()
        }
      } finally {
        $listener.Stop()
        $listener.Close()
        [System.IO.File]::WriteAllLines($logFile, $seen)
      }
    }

    try {
      $script:headers = @{ Authorization = 'Bearer test-code' }
      $ApiBase = "http://127.0.0.1:$port"
      { Upload-RoxiraFile $filePath 't1.ndjson.gz' } | Should -Not -Throw
    } finally {
      Wait-Job $server -Timeout 30 | Out-Null
      Remove-Job $server -Force
    }

    $seen = Get-Content -LiteralPath $logPath
    $seen.Count | Should -Be 5
    $seen[0] | Should -Match '^POST /enterprise-hub/data-import/bulk/uploads$'
    $seen[1] | Should -Match '^GET /enterprise-hub/data-import/bulk/uploads/.+/parts$'
    $seen[2] | Should -Match '^POST /enterprise-hub/data-import/bulk/uploads/.+/sign$'
    $seen[3] | Should -Match '^PUT /put/1$'
    $seen[4] | Should -Match '^POST /enterprise-hub/data-import/bulk/uploads/.+/complete$'
  }
}
