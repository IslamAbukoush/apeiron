param(
    [string]$BrowserPath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
)

$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot 'Fantasy_RPG_Game_Plan.html'
$pdfPath = Join-Path $PSScriptRoot 'Fantasy_RPG_Game_Plan.pdf'
$renderPath = Join-Path $PSScriptRoot '.render'
if (-not (Test-Path -LiteralPath $BrowserPath)) { throw "Browser not found: $BrowserPath" }
if (-not (Test-Path -LiteralPath $sourcePath)) { throw "Source not found: $sourcePath" }
New-Item -ItemType Directory -Path $renderPath -Force | Out-Null
$profilePath = Join-Path $renderPath 'chrome-profile'
$sourceUri = ([System.Uri]$sourcePath).AbsoluteUri
$browserArguments = @(
    '--headless', '--disable-gpu', '--disable-background-networking',
    '--disable-component-update', '--disable-extensions',
    '--no-first-run', '--no-default-browser-check',
    '--no-pdf-header-footer', '--virtual-time-budget=2000',
    "--user-data-dir=$profilePath", "--print-to-pdf=$pdfPath",
    '--dump-dom', $sourceUri
)
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $BrowserPath
$startInfo.Arguments = ($browserArguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$process = New-Object System.Diagnostics.Process
$process.StartInfo = $startInfo
try {
    if (-not $process.Start()) { throw 'Could not start headless PDF export.' }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(45000)) {
        $process.Kill()
        throw 'PDF export exceeded 45 seconds.'
    }
    $dom = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    [System.IO.File]::WriteAllText((Join-Path $renderPath 'layout.html'), $dom)
    [System.IO.File]::WriteAllText((Join-Path $renderPath 'browser.log'), $stderr)
    if ($process.ExitCode -ne 0) { throw "Browser failed with code $($process.ExitCode). See .render/browser.log." }
    if (-not (Test-Path -LiteralPath $pdfPath)) { throw 'Browser did not produce a PDF.' }
    $match = [regex]::Match($dom, '<script type="application/json" id="layout-report">(.*?)</script>', 'Singleline')
    if (-not $match.Success) { throw 'Missing browser layout report.' }
    $report = $match.Groups[1].Value | ConvertFrom-Json
    if ($report.overflow.Count -gt 0) {
        $report.overflow | Format-Table | Out-Host
        throw 'Some document sections overflow their allocated page.'
    }
    $pdfBytes = [System.IO.File]::ReadAllBytes($pdfPath)
    $pdfText = [System.Text.Encoding]::ASCII.GetString($pdfBytes)
    if (-not $pdfText.StartsWith('%PDF-')) { throw 'Output is not a PDF.' }
    $pageCount = [regex]::Matches($pdfText, '/Type\s*/Page\b').Count
    if ($pageCount -ne $report.pages) { throw "PDF has $pageCount pages; expected $($report.pages)." }
    [ordered]@{
        pdf = $pdfPath
        pages = $pageCount
        bytes = $pdfBytes.Length
        layoutOverflow = $report.overflow.Count
        linksInSource = $report.links
        generatedUtc = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Tee-Object -FilePath (Join-Path $renderPath 'validation.json')
} finally {
    $process.Dispose()
}
