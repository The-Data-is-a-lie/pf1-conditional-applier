#Requires -Version 5.1
<#
    release.ps1 - cut and publish a new version of the pf1-conditional-applier Foundry module.

    One command does the whole release: bump module.json, roll the changelog, rebuild the
    distributable zip from source, commit + tag, push to GitHub (main + tag), create a GitHub
    Release, then submit the version to the FoundryVTT package registry via the Package Release API.

    The download URL is pinned to the new tag's release asset, and the immutable per-version
    manifest URL is what gets submitted to the Foundry registry -- so a given release always
    resolves to exactly the code that shipped with it. The "manifest" field inside module.json
    itself stays on main, because that is the URL Foundry re-checks for updates.

    Prerequisites (one-time):
      gh auth login               # the GitHub CLI creates the Release
      .env next to this script (git-ignored):
        FOUNDRY_PACKAGE_TOKEN=... # per-package "Package Release Token" (fvttp_...) from the
                                  #   package's edit page on foundryvtt.com (above "Save Package").
                                  #   The package must be registered there first; until it is, use
                                  #   -NoPublish.

    Usage:
      ./release.ps1 -Version 1.0.0                 # full release + publish to Foundry
      ./release.ps1 -Version 1.0.0 -Verified 13    # also bump compatibility.verified
      ./release.ps1 -Version 1.0.0 -NoPublish      # push + GitHub release, but DON'T submit to Foundry
      ./release.ps1 -Version 1.0.0 -DryRun         # local only: apply edits + build zip, touch nothing remote
      ./release.ps1 -Version 1.0.0 -AllowDirty     # skip the clean-tree / fast-forward preconditions

    A real run always submits a Foundry dry-run (dry-run:true) FIRST and only publishes if it passes,
    so every publish is pre-flighted. -DryRun is a fully local rehearsal that makes no remote changes.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [string]$Verified,
    [string]$Maximum,
    [switch]$DryRun,
    [switch]$NoPublish,
    [switch]$AllowDirty
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false   # we check $LASTEXITCODE ourselves

# ---- constants ----
# Unlike the generator repo, the module IS the repo root here -- the zip is staged into a folder
# named after the module so the archive still unpacks as modules/<id>/.
$Root           = $PSScriptRoot
$ModName        = 'pf1-conditional-applier'
$ManifestRel    = 'module.json'
$ChangelogRel   = 'changelog.md'
$ManifestPath   = Join-Path $Root 'module.json'
$ChangelogPath  = Join-Path $Root 'changelog.md'
# downloads/ is gitignored: the zip is a build artifact, published as a GitHub release asset rather
# than committed. Keeping it out of git is what stops the repo growing ~500 KB per release forever.
$ZipPath        = Join-Path $Root "downloads\$ModName.zip"
$EnvPath        = Join-Path $Root '.env'
$Repo           = 'The-Data-is-a-lie/pf1-conditional-applier'
$FoundryId      = $ModName          # already the hyphenated slug Foundry registers
$RawBase        = "https://raw.githubusercontent.com/$Repo/v$Version"
$PinnedManifest = "$RawBase/module.json"
# The release asset uploaded by `gh release create` in step 7 -- immutable per tag, and served by
# GitHub's asset CDN rather than raw.githubusercontent (a source-file endpoint, not a binary host).
$PinnedDownload = "https://github.com/$Repo/releases/download/v$Version/$ModName.zip"
$FoundryApi     = 'https://foundryvtt.com/_api/packages/release_version/'
$PkgUrl         = "https://foundryvtt.com/packages/$FoundryId"

Set-Location $Root

function Fail($m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "    $m" -ForegroundColor Green }
function Note($m) { Write-Host "    $m" -ForegroundColor Yellow }

function Read-EnvVar($key, $path) {
    $line = Get-Content $path -ErrorAction SilentlyContinue | Where-Object { $_ -like "$key=*" } | Select-Object -First 1
    if ($line) { $line.Substring("$key=".Length).Trim() }
}
function Write-Utf8NoBom($path, $text) {
    [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

$mode = if ($DryRun) { 'DRY-RUN (local only, no remote changes)' }
        elseif ($NoPublish) { 'NO-PUBLISH (push + GitHub release, no Foundry submit)' }
        else { 'FULL RELEASE (+ Foundry publish)' }
Step "release.ps1  ->  v$Version   [$mode]"

# ---- 1. preconditions ----------------------------------------------------------------------------
Step 'Checking preconditions'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git not found on PATH.' }
if (-not $DryRun -and -not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Fail 'gh (GitHub CLI) not found on PATH -- needed to create the release.'
}

$FoundryToken = Read-EnvVar 'FOUNDRY_PACKAGE_TOKEN' $EnvPath
if (-not $DryRun -and -not $NoPublish -and -not $FoundryToken) {
    Fail "FOUNDRY_PACKAGE_TOKEN missing from $EnvPath (needed to publish to Foundry). Use -NoPublish to skip publishing."
}

if (& git tag -l "v$Version") { Fail "Tag v$Version already exists locally. Pick a new version, or 'git tag -d v$Version' to redo." }

if (-not $AllowDirty) {
    $porcelain = (& git status --porcelain)
    if ($porcelain) { Fail "Working tree is not clean. Commit or stash first, or pass -AllowDirty.`n$porcelain" }
    & git merge-base --is-ancestor origin/main HEAD
    if ($LASTEXITCODE -ne 0) {
        Fail "origin/main is not an ancestor of HEAD -- 'git push origin HEAD:main' would not fast-forward. Reconcile with main first (or pass -AllowDirty)."
    }
}
Ok 'Preconditions OK.'

# ---- 2. tests + a freshly built macro pack --------------------------------------------------------
# The pack is the module's only generated artifact. Rebuilding it here would need Foundry closed
# (LevelDB lock), so instead just refuse to ship if it is missing.
Step 'Running the spec suite'
& node build/verify_specs.mjs
if ($LASTEXITCODE -ne 0) { Fail 'build/verify_specs.mjs failed -- not releasing.' }
if (-not (Test-Path (Join-Path $Root 'packs\macros\CURRENT'))) {
    Fail "packs/macros is not a built LevelDB pack. Close Foundry and run: npm run pack:macros"
}
Ok 'Specs pass, macro pack present.'

# ---- 3. bump module.json (version, compat, download URL) ------------------------------------------
Step "Bumping $ManifestRel -> version $Version"
$mj  = [System.IO.File]::ReadAllText($ManifestPath)
$nlM = if ($mj -match "`r`n") { "`r`n" } else { "`n" }
$mj  = $mj -creplace '("version"\s*:\s*")[^"]*(")', ('${1}' + $Version + '${2}')
if ($Verified) { $mj = $mj -creplace '("verified"\s*:\s*")[^"]*(")', ('${1}' + $Verified + '${2}') }
if ($Maximum) {
    if ($mj -match '"maximum"\s*:') {
        $mj = $mj -creplace '("maximum"\s*:\s*")[^"]*(")', ('${1}' + $Maximum + '${2}')
    } else {
        $mj = $mj -creplace '("verified"\s*:\s*"[^"]*")', ('${1},' + $nlM + '    "maximum": "' + $Maximum + '"')
    }
}
# "manifest" is deliberately NOT rewritten to the tag. Foundry re-fetches whatever URL is stored in
# an installed module's manifest field to check for updates, so pinning it to v$Version would freeze
# every manifest-URL install at the version they first installed -- they would never be offered an
# update again. It stays on main, which always describes the current release. The REGISTRY still
# gets the immutable per-version URL: $PinnedManifest is sent in the Package Release API payload in
# step 8, which is where Foundry's "manifests must be immutable per release" guidance actually applies.
$mj = $mj -creplace '("download"\s*:\s*")[^"]*(")', ('${1}' + $PinnedDownload + '${2}')

try { $mjObj = $mj | ConvertFrom-Json } catch { Fail "module.json no longer parses after edit: $($_.Exception.Message)" }
if ($mjObj.version -ne $Version) { Fail "version did not update as expected (got '$($mjObj.version)')." }
Write-Utf8NoBom $ManifestPath $mj
Ok "version=$($mjObj.version)  minimum=$($mjObj.compatibility.minimum)  verified=$($mjObj.compatibility.verified)"

# ---- 4. roll the changelog -----------------------------------------------------------------------
Step 'Rolling changelog.md (Unreleased -> versioned)'
$cl  = [System.IO.File]::ReadAllText($ChangelogPath)
$nlC = if ($cl -match "`r`n") { "`r`n" } else { "`n" }
# Stop at the first line that BEGINS with "## Version " (multiline ^) so an empty Unreleased section
# cannot swallow the previous release's notes. A lookahead rather than a match, so end-of-file also
# terminates the section -- that is the very first release, where there is no earlier version yet.
# The "### Added/Changed/Fixed" subheadings inside a section are carried along in $body untouched.
$m   = [regex]::Match($cl, '(?sm)^## Unreleased\r?\n(.*?)(?=^## Version |\z)')
if (-not $m.Success) { Fail "changelog.md: couldn't find a '## Unreleased' section -- roll aborted." }
$body = $m.Groups[1].Value.Trim()
# Require an actual entry, not just leftover "### Added" scaffolding with nothing under it.
if ($body -notmatch '(?m)^\s*-') { Fail 'The Unreleased section has no entries -- nothing to release.' }
$date     = Get-Date -Format 'yyyy-MM-dd'
# Everything above the Unreleased heading -- the "# Changelog" title block. Preserved explicitly:
# $newCl is rebuilt from the heading down, so anything before it would otherwise be dropped.
$head     = $cl.Substring(0, $m.Index)
$rest     = $cl.Substring($m.Index + $m.Length)      # previous releases; "" on a first release
$newCl    = $head + "## Unreleased$nlC$nlC" + "## Version $Version ($date)$nlC$nlC" + $body + "$nlC$nlC" + $rest
Write-Utf8NoBom $ChangelogPath ($newCl.TrimEnd() + $nlC)
$ReleaseNotes = $body
$entryCount   = ($body -split "`n" | Where-Object { $_ -match '^\s*-' }).Count
Ok "Rolled to 'Version $Version ($date)'  ($entryCount entries)."

# ---- 5. rebuild the distributable zip ------------------------------------------------------------
Step 'Rebuilding the distributable zip (from current source)'
$zipTarget = if ($DryRun) { Join-Path $env:TEMP "$ModName-v$Version-dryrun.zip" } else { $ZipPath }
$stageRoot = Join-Path $env:TEMP "pf1ca_stage_$Version"
$stageMod  = Join-Path $stageRoot $ModName
if (Test-Path $stageRoot) { Remove-Item $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

# Copy in exactly what ships -- an ALLOWLIST, not a mirror-minus-exclusions. A denylist silently
# ships anything new that lands in a shipped directory (a stray 0-byte scripts/image did exactly
# that once); an allowlist cannot. The failure mode flips from "junk ships quietly" to "a forgotten
# entry here fails the $RequiredFiles check below loudly".
# /R:1 /W:1 -- robocopy's DEFAULT is a million retries 30s apart, so one file held open (Foundry on
# a pack, an editor on a JSON) would hang the release for days instead of failing the build.
# LOCK/LOG/LOG.old are LevelDB's own scratch inside packs/. They are gitignored for the same reason
# they are skipped here: LevelDB recreates them whenever it opens the pack, and robocopy cannot even
# stat LOCK (ERROR 2 while changing attributes), which fails the whole copy. The pack DATA
# (*.ldb, the numbered *.log, CURRENT, MANIFEST-*) still ships, which is all Foundry needs.
$ShipFiles = @('module.json', 'README.md', 'changelog.md', 'LICENSE')
$ShipDirs  = @('scripts', 'styles', 'data', 'packs')

New-Item -ItemType Directory -Path $stageMod -Force | Out-Null
foreach ($f in $ShipFiles) {
    $src = Join-Path $Root $f
    if (-not (Test-Path $src)) { Fail "Shipped file is missing from the working tree: $f" }
    Copy-Item $src $stageMod
}
foreach ($d in $ShipDirs) {
    $src = Join-Path $Root $d
    if (-not (Test-Path $src)) { Fail "Shipped directory is missing from the working tree: $d/" }
    & robocopy $src (Join-Path $stageMod $d) /E /R:1 /W:1 `
        /XF *.bak *.tmp LOCK LOG LOG.old `
        /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "robocopy failed on $d/ (exit $LASTEXITCODE)." }
    $global:LASTEXITCODE = 0
}

if (Test-Path $zipTarget) { Remove-Item $zipTarget -Force }
New-Item -ItemType Directory -Force -Path (Split-Path $zipTarget) | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
[System.IO.Compression.ZipFile]::CreateFromDirectory($stageMod, $zipTarget, [System.IO.Compression.CompressionLevel]::Optimal, $true)
Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue

# Every file the module loads at runtime. The data list mirrors DATA_FILES in
# scripts/apply-conditionals.js -- keep the two in sync when adding a data file. (build/verify_specs.mjs
# checks that same pairing against the working tree; this checks it against what actually shipped.)
$RequiredFiles = @(
    'module.json'
    'scripts/main.js'
    'scripts/apply-conditionals.js'
    'styles/apply-conditionals.css'
    'packs/macros/CURRENT'
    'data/spell_riders.json'
    'data/spell_changes.json'
    'data/maneuver_changes.json'
    'data/combat_talent_conditionals.json'
    'data/magic_talent_conditionals.json'
    'data/spell_damage_index.json'
    'data/feat_conditionals.json'
    'data/weapon_quality_conditionals.json'
    'data/class_feature_conditionals.json'
    'data/item_changes.json'
)

# sanity: right root, no forbidden files, every runtime file present, plausible size
$zi = [System.IO.Compression.ZipFile]::OpenRead($zipTarget)
try { $names = @($zi.Entries | ForEach-Object { $_.FullName }) } finally { $zi.Dispose() }
$bad = $names | Where-Object { $_ -match '\.bak$' -or $_ -match '/\.claude/' -or $_ -match '(^|/)\.env$' -or $_ -match '/node_modules/' }
if ($bad) { Fail "Zip contains files that must not ship:`n$($bad -join "`n")" }
$nameSet = [System.Collections.Generic.HashSet[string]]::new([string[]]$names)
$missing = $RequiredFiles | Where-Object { -not $nameSet.Contains("$ModName/$_") }
if ($missing) { Fail "Zip is missing files the module loads at runtime:`n$($missing -join "`n")" }
Ok "All $($RequiredFiles.Count) runtime files present."
$zipKB = [math]::Round((Get-Item $zipTarget).Length / 1KB, 0)
if ($zipKB -lt 200) { Fail "Rebuilt zip is only ${zipKB} KB (<200 KB) -- the data/ snapshots are likely missing." }
Ok "Zip: $zipTarget  (${zipKB} KB, $($names.Count) entries)"

# ---- DRY-RUN stops here --------------------------------------------------------------------------
if ($DryRun) {
    Write-Host ''
    Step 'DRY-RUN summary (no commit / tag / push / publish performed)'
    Note "module.json + changelog.md were edited in place; the zip was built to TEMP, so downloads/ is untouched."
    Note "Inspect:  git --no-pager diff -- $ManifestRel $ChangelogRel"
    Note "Revert:   git restore -- $ManifestRel $ChangelogRel"
    Write-Host ''
    Step 'Foundry payload that a real run would submit (dry-run:true, then dry-run:false):'
    $preview = @{ id = $FoundryId; 'dry-run' = $true; release = @{
        version = $Version; manifest = $PinnedManifest
        notes = '(the GitHub release URL, created at publish time)'
        compatibility = @{ minimum = $mjObj.compatibility.minimum; verified = $mjObj.compatibility.verified } } }
    if ($mjObj.compatibility.maximum) { $preview.release.compatibility.maximum = $mjObj.compatibility.maximum }
    ($preview | ConvertTo-Json -Depth 6) | Write-Host
    Write-Host ''
    Ok 'Dry-run complete. No remote changes were made.'
    exit 0
}

# ---- 6. commit + tag + push ----------------------------------------------------------------------
Step "Committing release + tagging v$Version"
& git add -- $ManifestRel $ChangelogRel
if ($LASTEXITCODE -ne 0) { Fail 'git add failed.' }
& git commit -q -m "chore(release): v$Version"
if ($LASTEXITCODE -ne 0) { Fail 'git commit failed (nothing staged?).' }
& git tag -a "v$Version" -m "Release v$Version"
if ($LASTEXITCODE -ne 0) { Fail 'git tag failed.' }

Step 'Pushing to GitHub (main + tag)'
& git push origin HEAD:main
if ($LASTEXITCODE -ne 0) { Fail "Push to main failed. Local commit+tag exist -- fix, then re-run: git push origin HEAD:main && git push origin v$Version" }
& git push origin "v$Version"
if ($LASTEXITCODE -ne 0) { Fail "Tag push failed. Re-run: git push origin v$Version" }
Ok 'Pushed main + tag.'

# ---- 7. GitHub release ---------------------------------------------------------------------------
Step 'Creating GitHub release'
$notesFile = Join-Path $env:TEMP "pf1ca-notes-$Version.md"
Write-Utf8NoBom $notesFile $ReleaseNotes
& gh release create "v$Version" $zipTarget --repo $Repo --title "v$Version" --notes-file $notesFile
if ($LASTEXITCODE -ne 0) {
    Note 'gh release create failed (already exists?) -- continuing; the tag itself is the release.'
    $GitHubReleaseUrl = "https://github.com/$Repo/releases/tag/v$Version"
} else {
    $GitHubReleaseUrl = (& gh release view "v$Version" --repo $Repo --json url --jq .url)
    if ($LASTEXITCODE -ne 0 -or -not $GitHubReleaseUrl) { $GitHubReleaseUrl = "https://github.com/$Repo/releases/tag/v$Version" }
}
Remove-Item $notesFile -Force -ErrorAction SilentlyContinue
Ok "Release notes URL: $GitHubReleaseUrl"

# ---- NO-PUBLISH stops here -----------------------------------------------------------------------
if ($NoPublish) {
    Write-Host ''
    Step 'NO-PUBLISH: stopping before Foundry submission'
    Note "Publish manually at $PkgUrl (Release Version), or re-run without -NoPublish:"
    Note "  version:  $Version"
    Note "  manifest: $PinnedManifest"
    Note "  notes:    $GitHubReleaseUrl"
    Write-Host ''
    Ok 'Pushed + released on GitHub. Not submitted to Foundry.'
    exit 0
}

# ---- 8. Foundry: dry-run, then publish -----------------------------------------------------------
$compat = @{ minimum = $mjObj.compatibility.minimum; verified = $mjObj.compatibility.verified }
if ($mjObj.compatibility.maximum) { $compat.maximum = $mjObj.compatibility.maximum }

function Invoke-FoundryRelease([bool]$dry) {
    $payload = @{ id = $FoundryId; 'dry-run' = $dry; release = @{
        version = $Version; manifest = $PinnedManifest; notes = $GitHubReleaseUrl; compatibility = $compat } }
    $json = $payload | ConvertTo-Json -Depth 6
    try {
        # -SkipHeaderValidation: Foundry wants the raw fvttp_ token as the Authorization value with no
        # scheme; .NET otherwise rejects a scheme-less Authorization header with a FormatException.
        return Invoke-RestMethod -Method Post -Uri $FoundryApi -Headers @{ Authorization = $FoundryToken } -ContentType 'application/json' -Body $json -SkipHeaderValidation
    } catch {
        $code = $null; try { $code = [int]$_.Exception.Response.StatusCode } catch {}
        if ($code -eq 429) {
            $ra = '60'; try { $ra = ($_.Exception.Response.Headers.GetValues('Retry-After') | Select-Object -First 1) } catch {}
            Fail "Foundry rate limit (429): wait ${ra}s (one release per package per 60s) and re-run (tag + GitHub release already exist)."
        }
        Fail "Foundry API error ($code): $($_.ErrorDetails.Message)"
    }
}

Step 'Foundry: validating (dry-run:true)'
$dr = Invoke-FoundryRelease $true
Ok "dry-run OK: $($dr | ConvertTo-Json -Compress -Depth 6)"

Step 'Foundry: publishing (dry-run:false)'
$pub = Invoke-FoundryRelease $false
Ok "published: $($pub | ConvertTo-Json -Compress -Depth 6)"

# ---- 9. summary ----------------------------------------------------------------------------------
Write-Host ''
Write-Host "Published $ModName v$Version" -ForegroundColor Green
Write-Host "  Foundry:  $PkgUrl" -ForegroundColor Green
Write-Host "  GitHub:   $GitHubReleaseUrl" -ForegroundColor Green
Write-Host "  Manifest: $PinnedManifest" -ForegroundColor Green
