using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class ThirstyLauncher
{
    [STAThread]
    private static int Main()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            foreach (string file in new[] { "scripts/run-ui.mjs", "dist/ui/main.js", "node_modules/electron/dist/electron.exe" })
                if (!File.Exists(Path.Combine(root, file)))
                    throw new InvalidOperationException("Keep Thirsty Bot.exe in the thirsty-bot project folder. To rebuild the app, run npm ci and npm run exe:build there.");

            string node = FindNode(root);
            var start = new ProcessStartInfo(node, "\"scripts/run-ui.mjs\"");
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            using (Process process = Process.Start(start))
            {
                // Drain output without saving potentially sensitive local diagnostics.
                process.OutputDataReceived += delegate { };
                process.ErrorDataReceived += delegate { };
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                if (process.ExitCode != 0)
                    throw new InvalidOperationException("The desktop app could not start or exited unexpectedly. Run npm run ui in the project folder to see its diagnostics.");
            }
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Thirsty Bot", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static string FindNode(string root)
    {
        string localRuntime = Path.Combine(root, ".local", "launcher-node.txt");
        if (File.Exists(localRuntime))
        {
            string configured = File.ReadAllText(localRuntime).Trim();
            if (Path.IsPathRooted(configured) && File.Exists(configured) &&
                String.Equals(Path.GetFileName(configured), "node.exe", StringComparison.OrdinalIgnoreCase))
                return configured;
        }
        foreach (string directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            if (String.IsNullOrWhiteSpace(directory)) continue;
            string candidate = Path.Combine(directory.Trim().Trim('"'), "node.exe");
            if (File.Exists(candidate)) return candidate;
        }
        throw new InvalidOperationException("Node.js was not found. Install Node.js 24, then run npm run exe:build in the project folder.");
    }
}
