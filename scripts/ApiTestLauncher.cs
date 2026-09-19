using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class ApiTestLauncher
{
    [STAThread]
    private static int Main()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            foreach (string file in new[] { "scripts/run-api-test-ui.mjs", "dist/ui/main.js", "node_modules/electron/dist/electron.exe", ".local/runtime/node.exe" })
                if (!File.Exists(Path.Combine(root, file)))
                    throw new InvalidOperationException("The API Test application folder is incomplete. Rebuild its separate installation.");
            var start = new ProcessStartInfo(Path.Combine(root, ".local/runtime/node.exe"), "\"scripts/run-api-test-ui.mjs\"");
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
                    throw new InvalidOperationException("The API Test app exited unexpectedly. Check its private installation and runtime assets.");
            }
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Thirsty Bot API Test", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
