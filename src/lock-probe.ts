import {probeLockBrowser,unknownBrowser} from './lock-browser.js';
try {console.log(JSON.stringify(await probeLockBrowser()));}catch{console.log(JSON.stringify(unknownBrowser));}
process.exit(0);
