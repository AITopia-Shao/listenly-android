param(
    [string]$SdkPath = 'C:\Program Files (x86)\Android\android-sdk',
    [string]$JdkPath = 'C:\Program Files\Android\openjdk\jdk-21.0.8',
    [string]$OutputPath = '',
    [string]$GradleInitScript = '',
    [switch]$Lite,
    [switch]$Demo
)
$ErrorActionPreference = 'Stop'
$SdkPath = [IO.Path]::GetFullPath($SdkPath)
$JdkPath = [IO.Path]::GetFullPath($JdkPath)
if ($Demo -and $Lite) { throw '-Demo and -Lite cannot be combined.' }
function Invoke-BuildTool([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Build command failed ($LASTEXITCODE): $Executable" }
}
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskBuild = Join-Path ([IO.Path]::GetTempPath()) ('listenly-build-' + [guid]::NewGuid().ToString('N'))
$taskSavedBuild = Join-Path $taskRoot '.build\android'
$taskAppConfig = Get-Content -LiteralPath (Join-Path $taskRoot 'app\build.gradle') -Raw -Encoding UTF8
if ($taskAppConfig -notmatch '\bversionCode\s+(\d+)') { throw 'Android app versionCode not found' }
$taskVersionCode = $Matches[1]
if ($taskAppConfig -notmatch "\bversionName\s+'([^']+)'") { throw 'Android app versionName not found' }
$taskVersionName = $Matches[1]
if (!$OutputPath) {
    $OutputPath = Join-Path $taskRoot $(if ($Demo) { "dist\listenly-demo-$taskVersionName.apk" } elseif ($Lite) { 'dist\拾听-轻量版.apk' } else { 'dist\拾听.apk' })
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$taskTools = Get-ChildItem -LiteralPath (Join-Path $SdkPath 'build-tools') -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'aapt2.exe') } |
    Sort-Object { [version]($_.Name -replace '-.*$', '') } -Descending | Select-Object -First 1
$taskPlatform = Get-ChildItem -LiteralPath (Join-Path $SdkPath 'platforms') -Directory |
    Where-Object { $_.Name -match '^android-\d+(?:\.\d+)?$' } |
    Sort-Object { [version](($_.Name -replace '^android-', '') + $(if ($_.Name -notmatch '\.') { '.0' } else { '' })) } -Descending | Select-Object -First 1
if (!$taskTools -or !$taskPlatform) { throw 'Android SDK platforms / build-tools not found.' }
$taskJar = Join-Path $taskPlatform.FullName 'android.jar'
$taskJava = Join-Path $JdkPath 'bin\java.exe'
$taskJavac = Join-Path $JdkPath 'bin\javac.exe'
$taskKeytool = Join-Path $JdkPath 'bin\keytool.exe'
foreach ($taskExe in @($taskJava,$taskJavac,$taskKeytool)) {
    if (!(Test-Path -LiteralPath $taskExe)) { throw "Required JDK executable missing: $taskExe" }
}
$taskNpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (!$taskNpmCommand) { throw 'npm.cmd not found; install Node.js and run npm ci in the project first.' }
$taskPythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (!$taskPythonCommand) { throw 'Python 3.10 or newer is required to create Android-compatible APK ZIP entries.' }
# Generate the classic Chromium 58 entry before taking the Android asset snapshot.
# This prevents APKs from shipping an outdated bundle after source changes.
Push-Location -LiteralPath $taskRoot
try { Invoke-BuildTool $taskNpmCommand.Source @('run','build:web') }
finally { Pop-Location }
$taskCompatPath = Join-Path $taskRoot 'app\src\main\assets\web\app.compat.js'
if (!(Test-Path -LiteralPath $taskCompatPath -PathType Leaf) -or (Get-Item -LiteralPath $taskCompatPath).Length -le 0) {
    throw 'build:web did not produce app.compat.js'
}
foreach ($taskDir in @($taskBuild,$taskSavedBuild,(Join-Path $taskBuild 'gen'),(Join-Path $taskBuild 'classes'),(Join-Path $taskBuild 'dex'),[IO.Path]::GetDirectoryName($OutputPath))) {
    New-Item -ItemType Directory -Force -Path $taskDir | Out-Null
}
# Keep compiler paths simple and stage a consistent snapshot. Demo edition uses
# only public original examples. Lite edition also copies the latest complete paper.
$taskMainSource = Join-Path $taskRoot 'app\src\main'
if ($Demo) {
    $taskDemoMain = Join-Path $taskRoot '.build\demo\main'
    Invoke-BuildTool $taskPythonCommand.Source @((Join-Path $taskRoot 'tools\prepare-demo-assets.py'),'--output',$taskDemoMain)
    $taskMainSource = $taskDemoMain
}
$taskWebSource = Join-Path $taskMainSource 'assets\web'
$taskAudioPattern = '\.(mp3|m4a|aac|wav|ogg|opus|flac|mp4)$'
$taskKeepAudio = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
function Add-ReferencedAudio($Node) {
    if ($null -eq $Node) { return }
    if ($Node -is [string]) {
        $taskRef = $Node -replace '^https://listenly\.local/assets/', '' -replace '^\./', ''
        if ($taskRef.StartsWith('media/') -and $taskRef -match $taskAudioPattern) {
            $taskAudioPath = [IO.Path]::GetFullPath((Join-Path $taskWebSource $taskRef.Replace('/','\')))
            if (!$taskAudioPath.StartsWith($taskWebSource + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe bundled audio path' }
            [void]$taskKeepAudio.Add($taskAudioPath)
        }
    } elseif ($Node -is [System.Collections.IDictionary]) {
        foreach ($taskChild in $Node.Values) { Add-ReferencedAudio $taskChild }
    } elseif ($Node -is [PSCustomObject]) {
        foreach ($taskProperty in $Node.PSObject.Properties) { Add-ReferencedAudio $taskProperty.Value }
    } elseif ($Node -is [System.Collections.IEnumerable]) {
        foreach ($taskChild in $Node) { Add-ReferencedAudio $taskChild }
    }
}
$taskBundlePath = Join-Path $taskWebSource 'bundled-library.json'
if (!(Test-Path -LiteralPath $taskBundlePath)) { throw 'Build requires bundled-library.json' }
$taskBundle = Get-Content -LiteralPath $taskBundlePath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Lite) {
    $taskPaperOrder = @{}
    $taskOrder = 0
    foreach ($taskPaper in $taskBundle.papers) { $taskPaperOrder[[string]$taskPaper.id] = $taskOrder; $taskOrder++ }
    $taskComplete = @($taskBundle.papers | Where-Object {
        $taskQuestionCount = 0
        foreach ($taskArticle in $_.articles) { if ($taskArticle.questions) { $taskQuestionCount += @($taskArticle.questions).Count } }
        $taskQuestionCount -ge 25
    } | Sort-Object @{Expression={ [int]$_.year };Descending=$true},
        @{Expression={ if ($_.id -match '(?:^|[-_])(\d{4})[-_](\d{1,2})(?:[-_]|$)') { [int]$Matches[2] } elseif ($_.month) { [int]$_.month } else { 0 } };Descending=$true},
        @{Expression={ @($_.articles).Count };Descending=$true},
        @{Expression={ $taskPaperOrder[[string]$_.id] };Descending=$false})
    if (!$taskComplete.Count) { throw 'No complete paper with at least 25 questions is available for Lite build' }
    $taskSelected = $taskComplete[0]
    $taskBundle.papers = @($taskSelected)
}
Add-ReferencedAudio $taskBundle.papers
if ($Lite) {
    $taskLiteQuestions = 0
    foreach ($taskArticle in $taskSelected.articles) { if ($taskArticle.questions) { $taskLiteQuestions += @($taskArticle.questions).Count } }
    [long]$taskLiteAudioBytes = 0
    foreach ($taskAudioPath in $taskKeepAudio) {
        if (!(Test-Path -LiteralPath $taskAudioPath -PathType Leaf)) { throw "Missing bundled audio: $taskAudioPath" }
        $taskLiteAudioBytes += (Get-Item -LiteralPath $taskAudioPath).Length
    }
    $taskBundle.summary = [PSCustomObject]@{
        papers = 1
        articles = @($taskSelected.articles).Count
        questions = $taskLiteQuestions
        audioBytes = $taskLiteAudioBytes
    }
}
Add-ReferencedAudio (Get-Content -LiteralPath (Join-Path $taskWebSource 'demo.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
foreach ($taskAudioPath in $taskKeepAudio) {
    if (!(Test-Path -LiteralPath $taskAudioPath -PathType Leaf)) { throw "Missing bundled audio: $taskAudioPath" }
}
if ($Lite) { Write-Host "Lite edition: $($taskSelected.title); $($taskKeepAudio.Count) recordings" }
if ($Demo) { Write-Host "Public demo edition: original examples only; $($taskKeepAudio.Count) recordings" }
$taskCorpusPrefix = (Join-Path $taskWebSource 'media\cet6') + '\'
foreach ($taskSource in Get-ChildItem -LiteralPath $taskMainSource -File -Recurse) {
    $taskRelative = $taskSource.FullName.Substring($taskMainSource.Length + 1)
    if ($taskSource.Name -match '\.fingerprint$|^\..*tmp$|\.tmp$' -or $taskRelative -match '(?:^|[\\/])\.?cache[\\/]') { continue }
    if ($taskSource.Name -match $taskAudioPattern -and !$taskKeepAudio.Contains($taskSource.FullName)) {
        continue
    }
    $taskDestination = Join-Path (Join-Path $taskBuild 'main') $taskRelative
    New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($taskDestination)) | Out-Null
    Copy-Item -LiteralPath $taskSource.FullName -Destination $taskDestination
}
if ($Lite) {
    [IO.File]::WriteAllText((Join-Path $taskBuild 'main\assets\web\bundled-library.json'),
        ($taskBundle | ConvertTo-Json -Depth 100 -Compress), (New-Object Text.UTF8Encoding($false)))
}
$taskStagedWeb = Join-Path $taskBuild 'main\assets\web'
foreach ($taskNotice in @(@('LICENSE','LICENSE.txt'), @('THIRD_PARTY_NOTICES.md','THIRD_PARTY_NOTICES.txt'))) {
    $taskNoticeSource = Join-Path $taskRoot $taskNotice[0]
    if (Test-Path -LiteralPath $taskNoticeSource -PathType Leaf) {
        Copy-Item -LiteralPath $taskNoticeSource -Destination (Join-Path $taskStagedWeb $taskNotice[1]) -Force
    }
}
$taskLicenses = Join-Path $taskRoot 'LICENSES'
if (Test-Path -LiteralPath $taskLicenses -PathType Container) {
    $taskStagedLicenses = Join-Path $taskStagedWeb 'licenses'
    New-Item -ItemType Directory -Force -Path $taskStagedLicenses | Out-Null
    foreach ($taskLicense in Get-ChildItem -LiteralPath $taskLicenses -File) {
        Copy-Item -LiteralPath $taskLicense.FullName -Destination (Join-Path $taskStagedLicenses $taskLicense.Name) -Force
    }
}
# The two user-supplied wallpapers remain in a local build cache. Public demo
# assets always retain the original vector backgrounds shipped in the repo.
$taskWallpaperCache = Join-Path $taskRoot '.build\personal-wallpapers'
if (!$Demo -and (Test-Path -LiteralPath ($taskWallpaperCache + '.lock'))) { throw 'Personal wallpaper cache is being updated; retry after the download finishes.' }
if (!$Demo -and (Test-Path -LiteralPath (Join-Path $taskWallpaperCache 'sources.json'))) {
    Invoke-BuildTool $taskPythonCommand.Source @((Join-Path $taskRoot 'tools\fetch-personal-wallpapers.py'), '--stage-web', (Join-Path $taskBuild 'main\assets\web'))
}
# Compile the actual native Kotlin/Compose/Miuix UI and the unchanged Java engine.
# Assets stay in this edition-specific staging directory, so Gradle's public
# default can never pull the private corpus into CI/demo builds.
$taskGradle = Join-Path $taskRoot 'gradlew.bat'
$taskOldJavaHome = $env:JAVA_HOME
$taskOldAndroidHome = $env:ANDROID_HOME
$taskOldSdkRoot = $env:ANDROID_SDK_ROOT
$taskOldGradleHome = $env:GRADLE_USER_HOME
$taskOldJavaOptions = $env:JAVA_TOOL_OPTIONS
try {
    $env:JAVA_HOME = $JdkPath
    $env:ANDROID_HOME = $SdkPath
    $env:ANDROID_SDK_ROOT = $SdkPath
    $env:GRADLE_USER_HOME = Join-Path $taskRoot '.build\miuix-gradle-user'
    # MSIX sandbox path virtualization does not support JDK AF_UNIX wake pipes.
    # A nonexistent socket directory makes the JDK use its built-in TCP fallback.
    # This changes only the build process; it is never part of the Android app.
    if ($env:CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY) {
        $taskSocketFallback = Join-Path $taskRoot '.build\gradle-no-unix-sockets'
        if (Test-Path -LiteralPath $taskSocketFallback) { throw 'The Gradle socket fallback path must remain absent.' }
        $env:JAVA_TOOL_OPTIONS = (($taskOldJavaOptions + ' "-Djdk.net.unixdomain.tmpdir=' + $taskSocketFallback + '"').Trim())
    }
    Push-Location -LiteralPath $taskRoot
    try {
        $taskGradleArgs = @(':app:assembleDebug','--no-daemon',
            ('-PlistenlyAssetsDir=' + (Join-Path $taskBuild 'main\assets')),
            '-PlistenlySkipAssetPreparation=true')
        if ($taskRoot -match '[^\x00-\x7F]') { $taskGradleArgs += '-Pandroid.overridePathCheck=true' }
        if ($GradleInitScript) {
            $taskInit = [IO.Path]::GetFullPath($GradleInitScript)
            if (!(Test-Path -LiteralPath $taskInit -PathType Leaf)) { throw 'Gradle init script does not exist.' }
            $taskGradleArgs += @('--init-script',$taskInit)
        }
        Invoke-BuildTool $taskGradle $taskGradleArgs
    } finally { Pop-Location }
} finally {
    $env:JAVA_HOME = $taskOldJavaHome
    $env:ANDROID_HOME = $taskOldAndroidHome
    $env:ANDROID_SDK_ROOT = $taskOldSdkRoot
    $env:GRADLE_USER_HOME = $taskOldGradleHome
    $env:JAVA_TOOL_OPTIONS = $taskOldJavaOptions
}
$taskBase = Join-Path $taskRoot 'app\build\outputs\apk\debug\app-debug.apk'
if (!(Test-Path -LiteralPath $taskBase -PathType Leaf)) { throw 'Gradle did not produce the native UI APK.' }
$taskNormalizedApk = Join-Path $taskBuild 'normalized.apk'
# Stream the complete Gradle APK, preserving all dex/resources/native libraries.
# Normalize before 16 KiB ZIP alignment and signing with the existing local key.
$taskNormalizeTool = Join-Path $taskRoot 'tools\normalize-apk.py'
Invoke-BuildTool $taskPythonCommand.Source @($taskNormalizeTool,$taskBase,$taskNormalizedApk)
$taskAligned = Join-Path $taskBuild 'aligned.apk'
Invoke-BuildTool (Join-Path $taskTools.FullName 'zipalign.exe') @('-P','16','-f','4',$taskNormalizedApk,$taskAligned)
$taskKeystore = Join-Path $taskSavedBuild 'debug.keystore'
if (!(Test-Path -LiteralPath $taskKeystore)) {
    Invoke-BuildTool $taskKeytool @('-genkeypair','-keystore',$taskKeystore,'-storepass','android','-keypass','android','-alias','androiddebugkey','-dname','CN=Listenly Debug,O=Local,C=CN','-keyalg','RSA','-keysize','2048','-validity','10000')
}
$taskSigned = Join-Path $taskBuild 'signed.apk'
Invoke-BuildTool $taskJava @('-jar',(Join-Path $taskTools.FullName 'lib\apksigner.jar'),'sign','--ks',$taskKeystore,'--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--key-pass','pass:android','--out',$taskSigned,$taskAligned)
Invoke-BuildTool $taskJava @('-jar',(Join-Path $taskTools.FullName 'lib\apksigner.jar'),'verify','--verbose',$taskSigned)
Invoke-BuildTool $taskPythonCommand.Source @($taskNormalizeTool,'--verify',$taskSigned)
Invoke-BuildTool (Join-Path $taskTools.FullName 'zipalign.exe') @('-c','-P','16','4',$taskSigned)
Copy-Item -LiteralPath $taskSigned -Destination $OutputPath -Force
Write-Host "APK ready: $OutputPath"
$taskTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$taskCleanup = [IO.Path]::GetFullPath($taskBuild)
if (!$taskCleanup.StartsWith($taskTempRoot,[StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($taskCleanup) -notmatch '^listenly-build-[a-f0-9]{32}$') {
    throw 'Refusing to remove a temporary build directory outside the expected location.'
}
Remove-Item -LiteralPath $taskCleanup -Recurse -Force
