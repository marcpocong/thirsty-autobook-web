using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class ThirstyPickleBotLauncher
{
    [STAThread]
    private static int Main()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            foreach (string file in new[] { "scripts/run-thirsty-pickle-bot.mjs", "dist/ui/main.js", "node_modules/electron/dist/electron.exe", ".local/runtime/node.exe" })
                if (!File.Exists(Path.Combine(root, file)))
                    throw new InvalidOperationException("The Thirsty Pickle Bot application folder is incomplete. Rebuild the self-contained installation.");
            var start = new ProcessStartInfo(Path.Combine(root, ".local/runtime/node.exe"), "\"scripts/run-thirsty-pickle-bot.mjs\"");
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            using (Process process = Process.Start(start))
            {
                process.OutputDataReceived += delegate { };
                process.ErrorDataReceived += delegate { };
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                if (process.ExitCode != 0)
                    throw new InvalidOperationException("Thirsty Pickle Bot exited unexpectedly. Check its private installation and runtime assets.");
            }
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Thirsty Pickle Bot", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
