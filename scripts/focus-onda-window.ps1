param(
  [ValidateRange(1024,65535)][int]$Port,
  [ValidatePattern('^THIRSTY BOT [A-H]$')][string]$TitlePrefix
)
$ErrorActionPreference = 'Stop'
# Only a closed diagnostic code crosses the process boundary. Never print metadata.
# Chrome's own CDP cannot raise a window above other applications, so the dedicated
# worker window is restored, maximized on the monitor it already occupies, and given
# the foreground here. The window is never moved between monitors.

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ThirstyFocus
{
    delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

    const int SW_RESTORE = 9, SW_MAXIMIZE = 3;
    static readonly IntPtr HWND_TOPMOST = new IntPtr(-1), HWND_NOTOPMOST = new IntPtr(-2);
    const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_SHOWWINDOW = 0x40;

    static string Title(IntPtr window)
    {
        StringBuilder text = new StringBuilder(512);
        GetWindowTextW(window, text, text.Capacity);
        return text.ToString();
    }

    public static string Raise(int processId, string titlePrefix)
    {
        List<IntPtr> candidates = new List<IntPtr>();
        EnumWindows(delegate(IntPtr window, IntPtr unused)
        {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner == (uint)processId && IsWindowVisible(window) && Title(window).Length > 0) candidates.Add(window);
            return true;
        }, IntPtr.Zero);
        if (candidates.Count == 0) return "WINDOW_NOT_FOUND";

        // The caption follows the active tab, which CDP already selected. Fall back to a
        // lone window so a caption that has not repainted yet still resolves.
        IntPtr target = IntPtr.Zero;
        foreach (IntPtr window in candidates)
            if (Title(window).StartsWith(titlePrefix, StringComparison.Ordinal)) { target = window; break; }
        if (target == IntPtr.Zero)
        {
            if (candidates.Count != 1) return "WINDOW_AMBIGUOUS";
            target = candidates[0];
        }

        if (IsIconic(target)) ShowWindow(target, SW_RESTORE);
        // Lift above every other window, then release the pin so it does not stay on top.
        SetWindowPos(target, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        SetWindowPos(target, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        BringWindowToTop(target);

        // Windows refuses a foreground change from a background process unless the calling
        // thread shares an input queue with the current foreground thread.
        uint self = GetCurrentThreadId();
        uint foregroundPid;
        uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out foregroundPid);
        bool attached = foregroundThread != 0 && foregroundThread != self && AttachThreadInput(self, foregroundThread, true);
        SetForegroundWindow(target);
        if (attached) AttachThreadInput(self, foregroundThread, false);

        // Maximize last: SetWindowPos clears the zoomed state even with SWP_NOSIZE, so
        // asserting it earlier leaves the window merely screen-sized instead of maximized.
        ShowWindow(target, SW_MAXIMIZE);

        return GetForegroundWindow() == target ? "WINDOW_FOCUSED" : "WINDOW_RAISED";
    }
}
'@

function Get-ListenerProcessId {
  # netstat costs ~40 ms where Get-NetTCPConnection costs ~1.4 s loading NetTCPIP. A
  # listener is matched by its 0.0.0.0:0 remote address, because the state column is
  # localized on non-English Windows. The caller has already verified this endpoint.
  $owners = @()
  foreach ($row in (& netstat.exe -ano -p TCP)) {
    $fields = @($row -split '\s+' | Where-Object { $_ })
    if ($fields.Count -lt 5 -or $fields[0] -ne 'TCP') { continue }
    if ($fields[1] -notmatch ":$Port`$") { continue }
    if ($fields[1] -notlike '127.0.0.1:*' -and $fields[1] -notlike '`[::1`]:*') { continue }
    if ($fields[2] -ne '0.0.0.0:0' -and $fields[2] -ne '[::]:0') { continue }
    $owners += [int]$fields[4]
  }
  return @($owners | Select-Object -Unique)
}

function Get-FocusCode {
  try { $owners = Get-ListenerProcessId } catch { return 'WINDOW_NOT_FOUND' }
  if ($owners.Count -ne 1) { return 'WINDOW_NOT_FOUND' }
  return [ThirstyFocus]::Raise($owners[0], $TitlePrefix)
}
Get-FocusCode
