import { browserA, browserB } from './browser.js';
import { probeLockBrowser, unknownBrowser } from './lock-browser.js';
try {
    console.log(JSON.stringify(await probeLockBrowser(process.argv.includes('--worker-b') ? browserB : browserA)));
}
catch {
    console.log(JSON.stringify(unknownBrowser));
}
process.exit(0);
//# sourceMappingURL=lock-probe.js.map