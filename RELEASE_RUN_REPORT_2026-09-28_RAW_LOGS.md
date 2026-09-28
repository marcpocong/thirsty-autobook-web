# Raw logs for the 28 September 2026 release (target Wednesday 30 September)

Companion to [RELEASE_RUN_REPORT_2026-09-28.md](RELEASE_RUN_REPORT_2026-09-28.md). Every line below is copied from the install folder's logs. Each line was passed through the same rules as `scripts/export-sanitized-diagnostics.mjs`: keys naming identities, tokens, cookies, fingerprints, authorization, pid or hostname become `[REDACTED]`, and email addresses, phone numbers and local `C:\Users\…` paths are replaced. A line that needed no change is copied byte for byte; a line that did is re-serialized with the same key order.

## 1. Slot Watch log, every line (216 lines)

Source: `.local/slot-watch/2026-09-30_ffe896ed-9c1f-43c7-9ce9-7767b6d12d49.ndjson`. Lines are in response order; `seq` is request order. Offsets are ms after 08:00:00.000 on the observer clock (observer − dispatch = −4.2 ms).

```json
{"type":"header","version":2,"id":"ffe896ed-9c1f-43c7-9ce9-7767b6d12d49","date":"2026-09-30","releaseAt":"2026-09-28T00:00:00.000Z","releaseMs":1790553600000,"releaseManila":"2026-09-28 08:00:00.000","startedAt":"2026-09-27T23:35:25.369Z","clockOffsetMs":22.545654296875,"clockSynced":true,"schedule":{"availability":[-60000,-50000,-40000,-30000,-20000,-10000,-2000,0,250,500,1000,2000,5000,6000,7000,8000,9000,10000,11000,12000,13000,14000,15000,16000,17000,18000,19000,20000,21000,22000,23000,24000,25000,26000,27000,28000,29000,30000,31000,32000,33000,34000,35000,36000,37000,38000,39000,40000,41000,42000,43000,44000,45000,46000,47000,48000,49000,50000,51000,52000,53000,54000,55000,56000,57000,58000,59000,60000,65000,70000,75000,80000,85000,90000,95000,100000,105000,110000,115000,120000,125000,130000,135000,140000,145000,150000,155000,160000,165000,170000,175000,180000,185000,190000,195000,200000,205000,210000,215000,220000,225000,230000,235000,240000,245000,250000,255000,260000,265000,270000,275000,280000,285000,290000,295000,300000,330000,360000,390000,420000,450000,480000,510000,540000,570000,595000,596000,597000,598000,599000,600000,601000,602000,603000,604000,605000,606000,607000,608000,609000,610000,611000,612000,613000,614000,615000,616000,617000,618000,619000,620000,621000,622000,623000,624000,625000,626000,627000,628000,629000,630000,631000,632000,633000,634000,635000,636000,637000,638000,639000,640000,641000,642000,643000,644000,645000,646000,647000,648000,649000,650000,651000,652000,653000,654000,655000,656000,657000,658000,659000,660000,661000,662000,663000,664000,665000,690000,720000,750000,780000,810000,840000,870000,900000],"bookings":[-60000,2000,10000,30000,60000,120000,300000,600000,900000],"maxInFlight":6,"readTimeoutMs":15000,"bookingTimeoutMs":10000},"legend":{"O":"open","X":"unavailable","U":"date not published","?":"unknown (cell missing or read failed)"},"note":"Offsets are ms since release on the observer network clock. A read reflects Onda at an unknown moment between its request and its response. Lines are written in response order; seq is request order."}
{"type":"clock","at":"2026-09-27T23:59:00.012Z","offsetMs":34.8}
{"type":"availability","seq":1,"scheduledOffsetMs":-60000,"requestOffsetMs":-59987.2,"responseOffsetMs":-59715.2,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"MISS","ageS":0},"durationMs":272,"inFlightAtLaunch":1,"requestedAt":"2026-09-27T23:59:00.012Z","respondedAt":"2026-09-27T23:59:00.284Z","requestedManila":"2026-09-28 07:59:00.012","respondedManila":"2026-09-28 07:59:00.284","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"bookings","seq":1,"scheduledOffsetMs":-60000,"requestOffsetMs":-59982.2,"responseOffsetMs":-59602.2,"outcome":"ok","failedCourts":[],"cells":[],"durationMs":380,"requestedAt":"2026-09-27T23:59:00.017Z","respondedAt":"2026-09-27T23:59:00.397Z"}
{"type":"availability","seq":2,"scheduledOffsetMs":-50000,"requestOffsetMs":-49994.2,"responseOffsetMs":-49839.2,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":10},"durationMs":155,"inFlightAtLaunch":1,"requestedAt":"2026-09-27T23:59:10.005Z","respondedAt":"2026-09-27T23:59:10.160Z","requestedManila":"2026-09-28 07:59:10.005","respondedManila":"2026-09-28 07:59:10.160","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":3,"scheduledOffsetMs":-40000,"requestOffsetMs":-39986.2,"responseOffsetMs":-39828.2,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":10},"durationMs":158,"inFlightAtLaunch":1,"requestedAt":"2026-09-27T23:59:20.013Z","respondedAt":"2026-09-27T23:59:20.171Z","requestedManila":"2026-09-28 07:59:20.013","respondedManila":"2026-09-28 07:59:20.171","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":4,"scheduledOffsetMs":-30000,"requestOffsetMs":-29993.2,"responseOffsetMs":-29828.2,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":10},"durationMs":165,"inFlightAtLaunch":1,"requestedAt":"2026-09-27T23:59:30.006Z","respondedAt":"2026-09-27T23:59:30.171Z","requestedManila":"2026-09-28 07:59:30.006","respondedManila":"2026-09-28 07:59:30.171","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":5,"scheduledOffsetMs":-20000,"requestOffsetMs":-19985.2,"responseOffsetMs":-19810.2,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":10},"durationMs":175,"inFlightAtLaunch":1,"requestedAt":"2026-09-27T23:59:40.014Z","respondedAt":"2026-09-27T23:59:40.189Z","requestedManila":"2026-09-28 07:59:40.014","respondedManila":"2026-09-28 07:59:40.189","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":6,"scheduledOffsetMs":-10000,"requestOffsetMs":-9991.2,"responseOffsetMs":-9835.2,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":10},"durationMs":156,"inFlightAtLaunch":1,"requestedAt":"2026-09-27T23:59:50.008Z","respondedAt":"2026-09-27T23:59:50.164Z","requestedManila":"2026-09-28 07:59:50.008","respondedManila":"2026-09-28 07:59:50.164","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":7,"scheduledOffsetMs":-2000,"requestOffsetMs":-1991.2,"responseOffsetMs":-1840.2,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"HIT","ageS":8},"durationMs":151,"inFlightAtLaunch":1,"requestedAt":"2026-09-27T23:59:58.008Z","respondedAt":"2026-09-27T23:59:58.159Z","requestedManila":"2026-09-28 07:59:58.008","respondedManila":"2026-09-28 07:59:58.159","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":8,"scheduledOffsetMs":0,"requestOffsetMs":9.8,"responseOffsetMs":261.8,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":10},"durationMs":252,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:00.009Z","respondedAt":"2026-09-28T00:00:00.261Z","requestedManila":"2026-09-28 08:00:00.009","respondedManila":"2026-09-28 08:00:00.261","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":9,"scheduledOffsetMs":250,"requestOffsetMs":258.8,"responseOffsetMs":412.8,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":10},"durationMs":154,"inFlightAtLaunch":2,"requestedAt":"2026-09-28T00:00:00.258Z","respondedAt":"2026-09-28T00:00:00.412Z","requestedManila":"2026-09-28 08:00:00.258","respondedManila":"2026-09-28 08:00:00.412","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":10,"scheduledOffsetMs":500,"requestOffsetMs":510.8,"responseOffsetMs":585.8,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":10},"durationMs":75,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:00.510Z","respondedAt":"2026-09-28T00:00:00.585Z","requestedManila":"2026-09-28 08:00:00.510","respondedManila":"2026-09-28 08:00:00.585","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":11,"scheduledOffsetMs":1000,"requestOffsetMs":1001.8,"responseOffsetMs":1079.8,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":11},"durationMs":78,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:01.001Z","respondedAt":"2026-09-28T00:00:01.079Z","requestedManila":"2026-09-28 08:00:01.001","respondedManila":"2026-09-28 08:00:01.079","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":12,"scheduledOffsetMs":2000,"requestOffsetMs":2013.8,"responseOffsetMs":2076.8,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":12},"durationMs":63,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:02.013Z","respondedAt":"2026-09-28T00:00:02.076Z","requestedManila":"2026-09-28 08:00:02.013","respondedManila":"2026-09-28 08:00:02.076","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"bookings","seq":2,"scheduledOffsetMs":2000,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/19:00","1/21:00","2/20:00","3/19:00","3/21:00","3/22:00","4/18:00","4/22:00","5/20:00","6/19:00","6/20:00","7/18:00"],"durationMs":831,"requestedAt":"2026-09-28T00:00:02.013Z","respondedAt":"2026-09-28T00:00:02.844Z"}
{"type":"availability","seq":13,"scheduledOffsetMs":5000,"requestOffsetMs":5002.8,"responseOffsetMs":5082.8,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":15},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:05.002Z","respondedAt":"2026-09-28T00:00:05.082Z","requestedManila":"2026-09-28 08:00:05.002","respondedManila":"2026-09-28 08:00:05.082","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":14,"scheduledOffsetMs":6000,"requestOffsetMs":6013.8,"responseOffsetMs":6093.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXOXOO,2:OOOOOOOOOOXOXXOO,3:XXXXOOOOOXXXOXXO,4:XXXXOOOOOXXOXOXO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOXO,7:OOOOOOOOOOXOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:06.013Z","respondedAt":"2026-09-28T00:00:06.093Z","requestedManila":"2026-09-28 08:00:06.013","respondedManila":"2026-09-28 08:00:06.093","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":15,"scheduledOffsetMs":7000,"requestOffsetMs":7016.8,"responseOffsetMs":7103.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXOXOO,2:OOOOOOOOOOXOXXOO,3:XXXXOOOOOXXXOXXO,4:XXXXOOOOOXXOXOXO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOXO,7:OOOOOOOOOOXOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":2},"durationMs":87,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:07.016Z","respondedAt":"2026-09-28T00:00:07.103Z","requestedManila":"2026-09-28 08:00:07.016","respondedManila":"2026-09-28 08:00:07.103","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":16,"scheduledOffsetMs":8000,"requestOffsetMs":8001.8,"responseOffsetMs":8094.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXOXOO,2:OOOOOOOOOOXOXXOO,3:XXXXOOOOOXXXOXXO,4:XXXXOOOOOXXOXOXO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOXO,7:OOOOOOOOOOXOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":3},"durationMs":93,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:08.001Z","respondedAt":"2026-09-28T00:00:08.094Z","requestedManila":"2026-09-28 08:00:08.001","respondedManila":"2026-09-28 08:00:08.094","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":17,"scheduledOffsetMs":9000,"requestOffsetMs":9002.8,"responseOffsetMs":9078.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXOXOO,2:OOOOOOOOOOXOXXOO,3:XXXXOOOOOXXXOXXO,4:XXXXOOOOOXXOXOXO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOXO,7:OOOOOOOOOOXOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":4},"durationMs":76,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:09.002Z","respondedAt":"2026-09-28T00:00:09.078Z","requestedManila":"2026-09-28 08:00:09.002","respondedManila":"2026-09-28 08:00:09.078","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":18,"scheduledOffsetMs":10000,"requestOffsetMs":10015.8,"responseOffsetMs":10081.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXOXOO,2:OOOOOOOOOOXOXXOO,3:XXXXOOOOOXXXOXXO,4:XXXXOOOOOXXOXOXO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOXO,7:OOOOOOOOOOXOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":66,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:10.015Z","respondedAt":"2026-09-28T00:00:10.081Z","requestedManila":"2026-09-28 08:00:10.015","respondedManila":"2026-09-28 08:00:10.081","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"bookings","seq":3,"scheduledOffsetMs":10000,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/18:00","1/19:00","1/20:00","1/21:00","1/22:00","2/17:00","2/18:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/19:00","3/20:00","3/21:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","6/21:00","6/22:00","7/18:00"],"durationMs":737,"requestedAt":"2026-09-28T00:00:10.015Z","respondedAt":"2026-09-28T00:00:10.752Z"}
{"type":"availability","seq":19,"scheduledOffsetMs":11000,"requestOffsetMs":11015.8,"responseOffsetMs":11079.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXOXOO,2:OOOOOOOOOOXOXXOO,3:XXXXOOOOOXXXOXXO,4:XXXXOOOOOXXOXOXO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOXO,7:OOOOOOOOOOXOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":6},"durationMs":64,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:11.015Z","respondedAt":"2026-09-28T00:00:11.079Z","requestedManila":"2026-09-28 08:00:11.015","respondedManila":"2026-09-28 08:00:11.079","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":20,"scheduledOffsetMs":12000,"requestOffsetMs":12015.8,"responseOffsetMs":12090.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXOXOO,2:OOOOOOOOOOXOXXOO,3:XXXXOOOOOXXXOXXO,4:XXXXOOOOOXXOXOXO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOXO,7:OOOOOOOOOOXOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":7},"durationMs":75,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:12.015Z","respondedAt":"2026-09-28T00:00:12.090Z","requestedManila":"2026-09-28 08:00:12.015","respondedManila":"2026-09-28 08:00:12.090","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":21,"scheduledOffsetMs":13000,"requestOffsetMs":13013.8,"responseOffsetMs":13085.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXOXOO,2:OOOOOOOOOOXOXXOO,3:XXXXOOOOOXXXOXXO,4:XXXXOOOOOXXOXOXO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOXO,7:OOOOOOOOOOXOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":8},"durationMs":72,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:13.013Z","respondedAt":"2026-09-28T00:00:13.085Z","requestedManila":"2026-09-28 08:00:13.013","respondedManila":"2026-09-28 08:00:13.085","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":22,"scheduledOffsetMs":14000,"requestOffsetMs":14015.8,"responseOffsetMs":14090.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXOXOO,2:OOOOOOOOOOXOXXOO,3:XXXXOOOOOXXXOXXO,4:XXXXOOOOOXXOXOXO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOXO,7:OOOOOOOOOOXOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":9},"durationMs":75,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:14.015Z","respondedAt":"2026-09-28T00:00:14.090Z","requestedManila":"2026-09-28 08:00:14.015","respondedManila":"2026-09-28 08:00:14.090","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":23,"scheduledOffsetMs":15000,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXOXOO,2:OOOOOOOOOOXOXXOO,3:XXXXOOOOOXXXOXXO,4:XXXXOOOOOXXOXOXO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOXO,7:OOOOOOOOOOXOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":83,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:15.014Z","respondedAt":"2026-09-28T00:00:15.097Z","requestedManila":"2026-09-28 08:00:15.014","respondedManila":"2026-09-28 08:00:15.097","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":24,"scheduledOffsetMs":16000,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":89,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:16.009Z","respondedAt":"2026-09-28T00:00:16.098Z","requestedManila":"2026-09-28 08:00:16.009","respondedManila":"2026-09-28 08:00:16.098","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":25,"scheduledOffsetMs":17000,"requestOffsetMs":17005.8,"responseOffsetMs":17092.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":2},"durationMs":87,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:17.005Z","respondedAt":"2026-09-28T00:00:17.092Z","requestedManila":"2026-09-28 08:00:17.005","respondedManila":"2026-09-28 08:00:17.092","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":26,"scheduledOffsetMs":18000,"requestOffsetMs":18015.8,"responseOffsetMs":18071.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":3},"durationMs":56,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:18.015Z","respondedAt":"2026-09-28T00:00:18.071Z","requestedManila":"2026-09-28 08:00:18.015","respondedManila":"2026-09-28 08:00:18.071","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":27,"scheduledOffsetMs":19000,"requestOffsetMs":19001.8,"responseOffsetMs":19068.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":4},"durationMs":67,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:19.001Z","respondedAt":"2026-09-28T00:00:19.068Z","requestedManila":"2026-09-28 08:00:19.001","respondedManila":"2026-09-28 08:00:19.068","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":28,"scheduledOffsetMs":20000,"requestOffsetMs":20013.8,"responseOffsetMs":20092.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":79,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:20.013Z","respondedAt":"2026-09-28T00:00:20.092Z","requestedManila":"2026-09-28 08:00:20.013","respondedManila":"2026-09-28 08:00:20.092","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":29,"scheduledOffsetMs":21000,"requestOffsetMs":21013.8,"responseOffsetMs":21148.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":6},"durationMs":135,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:21.013Z","respondedAt":"2026-09-28T00:00:21.148Z","requestedManila":"2026-09-28 08:00:21.013","respondedManila":"2026-09-28 08:00:21.148","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":30,"scheduledOffsetMs":22000,"requestOffsetMs":22010.8,"responseOffsetMs":22086.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":7},"durationMs":76,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:22.010Z","respondedAt":"2026-09-28T00:00:22.086Z","requestedManila":"2026-09-28 08:00:22.010","respondedManila":"2026-09-28 08:00:22.086","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":31,"scheduledOffsetMs":23000,"requestOffsetMs":23013.8,"responseOffsetMs":23096.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":8},"durationMs":83,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:23.013Z","respondedAt":"2026-09-28T00:00:23.096Z","requestedManila":"2026-09-28 08:00:23.013","respondedManila":"2026-09-28 08:00:23.096","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":32,"scheduledOffsetMs":24000,"requestOffsetMs":24011.8,"responseOffsetMs":24096.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":9},"durationMs":85,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:24.011Z","respondedAt":"2026-09-28T00:00:24.096Z","requestedManila":"2026-09-28 08:00:24.011","respondedManila":"2026-09-28 08:00:24.096","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":33,"scheduledOffsetMs":25000,"requestOffsetMs":25009.8,"responseOffsetMs":25073.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":64,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:25.009Z","respondedAt":"2026-09-28T00:00:25.073Z","requestedManila":"2026-09-28 08:00:25.009","respondedManila":"2026-09-28 08:00:25.073","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":34,"scheduledOffsetMs":26000,"requestOffsetMs":26010.8,"responseOffsetMs":26084.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":74,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:26.010Z","respondedAt":"2026-09-28T00:00:26.084Z","requestedManila":"2026-09-28 08:00:26.010","respondedManila":"2026-09-28 08:00:26.084","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":35,"scheduledOffsetMs":27000,"requestOffsetMs":27006.8,"responseOffsetMs":27090.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":2},"durationMs":84,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:27.006Z","respondedAt":"2026-09-28T00:00:27.090Z","requestedManila":"2026-09-28 08:00:27.006","respondedManila":"2026-09-28 08:00:27.090","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":36,"scheduledOffsetMs":28000,"requestOffsetMs":28004.8,"responseOffsetMs":28086.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":3},"durationMs":82,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:28.004Z","respondedAt":"2026-09-28T00:00:28.086Z","requestedManila":"2026-09-28 08:00:28.004","respondedManila":"2026-09-28 08:00:28.086","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":37,"scheduledOffsetMs":29000,"requestOffsetMs":29000.8,"responseOffsetMs":29081.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":4},"durationMs":81,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:29.000Z","respondedAt":"2026-09-28T00:00:29.081Z","requestedManila":"2026-09-28 08:00:29.000","respondedManila":"2026-09-28 08:00:29.081","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":38,"scheduledOffsetMs":30000,"requestOffsetMs":30011.8,"responseOffsetMs":30091.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:30.011Z","respondedAt":"2026-09-28T00:00:30.091Z","requestedManila":"2026-09-28 08:00:30.011","respondedManila":"2026-09-28 08:00:30.091","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"bookings","seq":4,"scheduledOffsetMs":30000,"requestOffsetMs":30012.8,"responseOffsetMs":30296.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/18:00","1/19:00","1/20:00","1/21:00","1/22:00","2/17:00","2/18:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/19:00","3/20:00","3/21:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","6/21:00","6/22:00","7/17:00","7/18:00","7/19:00","7/20:00","7/21:00","7/22:00"],"durationMs":284,"requestedAt":"2026-09-28T00:00:30.012Z","respondedAt":"2026-09-28T00:00:30.296Z"}
{"type":"availability","seq":39,"scheduledOffsetMs":31000,"requestOffsetMs":31011.8,"responseOffsetMs":31085.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":6},"durationMs":74,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:31.011Z","respondedAt":"2026-09-28T00:00:31.085Z","requestedManila":"2026-09-28 08:00:31.011","respondedManila":"2026-09-28 08:00:31.085","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":40,"scheduledOffsetMs":32000,"requestOffsetMs":32005.8,"responseOffsetMs":32091.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":7},"durationMs":86,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:32.005Z","respondedAt":"2026-09-28T00:00:32.091Z","requestedManila":"2026-09-28 08:00:32.005","respondedManila":"2026-09-28 08:00:32.091","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":41,"scheduledOffsetMs":33000,"requestOffsetMs":33005.8,"responseOffsetMs":33199.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":8},"durationMs":194,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:33.005Z","respondedAt":"2026-09-28T00:00:33.199Z","requestedManila":"2026-09-28 08:00:33.005","respondedManila":"2026-09-28 08:00:33.199","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":42,"scheduledOffsetMs":34000,"requestOffsetMs":34002.8,"responseOffsetMs":34076.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":9},"durationMs":74,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:34.002Z","respondedAt":"2026-09-28T00:00:34.076Z","requestedManila":"2026-09-28 08:00:34.002","respondedManila":"2026-09-28 08:00:34.076","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":43,"scheduledOffsetMs":35000,"requestOffsetMs":35000.8,"responseOffsetMs":35064.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":64,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:35.000Z","respondedAt":"2026-09-28T00:00:35.064Z","requestedManila":"2026-09-28 08:00:35.000","respondedManila":"2026-09-28 08:00:35.064","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":44,"scheduledOffsetMs":36000,"requestOffsetMs":36014.8,"responseOffsetMs":36107.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":93,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:36.014Z","respondedAt":"2026-09-28T00:00:36.107Z","requestedManila":"2026-09-28 08:00:36.014","respondedManila":"2026-09-28 08:00:36.107","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":45,"scheduledOffsetMs":37000,"requestOffsetMs":37001.8,"responseOffsetMs":37078.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":2},"durationMs":77,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:37.001Z","respondedAt":"2026-09-28T00:00:37.078Z","requestedManila":"2026-09-28 08:00:37.001","respondedManila":"2026-09-28 08:00:37.078","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":46,"scheduledOffsetMs":38000,"requestOffsetMs":38003.8,"responseOffsetMs":38062.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":3},"durationMs":59,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:38.003Z","respondedAt":"2026-09-28T00:00:38.062Z","requestedManila":"2026-09-28 08:00:38.003","respondedManila":"2026-09-28 08:00:38.062","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":47,"scheduledOffsetMs":39000,"requestOffsetMs":39000.8,"responseOffsetMs":39077.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":4},"durationMs":77,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:39.000Z","respondedAt":"2026-09-28T00:00:39.077Z","requestedManila":"2026-09-28 08:00:39.000","respondedManila":"2026-09-28 08:00:39.077","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":48,"scheduledOffsetMs":40000,"requestOffsetMs":40014.8,"responseOffsetMs":40092.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":78,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:40.014Z","respondedAt":"2026-09-28T00:00:40.092Z","requestedManila":"2026-09-28 08:00:40.014","respondedManila":"2026-09-28 08:00:40.092","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":49,"scheduledOffsetMs":41000,"requestOffsetMs":41008.8,"responseOffsetMs":41094.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":6},"durationMs":86,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:41.008Z","respondedAt":"2026-09-28T00:00:41.094Z","requestedManila":"2026-09-28 08:00:41.008","respondedManila":"2026-09-28 08:00:41.094","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":50,"scheduledOffsetMs":42000,"requestOffsetMs":42007.8,"responseOffsetMs":42083.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":7},"durationMs":76,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:42.007Z","respondedAt":"2026-09-28T00:00:42.083Z","requestedManila":"2026-09-28 08:00:42.007","respondedManila":"2026-09-28 08:00:42.083","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":51,"scheduledOffsetMs":43000,"requestOffsetMs":43008.8,"responseOffsetMs":43101.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":8},"durationMs":93,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:43.008Z","respondedAt":"2026-09-28T00:00:43.101Z","requestedManila":"2026-09-28 08:00:43.008","respondedManila":"2026-09-28 08:00:43.101","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":52,"scheduledOffsetMs":44000,"requestOffsetMs":44009.8,"responseOffsetMs":44087.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":9},"durationMs":78,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:44.009Z","respondedAt":"2026-09-28T00:00:44.087Z","requestedManila":"2026-09-28 08:00:44.009","respondedManila":"2026-09-28 08:00:44.087","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":53,"scheduledOffsetMs":45000,"requestOffsetMs":45011.8,"responseOffsetMs":45074.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":63,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:45.011Z","respondedAt":"2026-09-28T00:00:45.074Z","requestedManila":"2026-09-28 08:00:45.011","respondedManila":"2026-09-28 08:00:45.074","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":54,"scheduledOffsetMs":46000,"requestOffsetMs":46009.8,"responseOffsetMs":46090.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":81,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:46.009Z","respondedAt":"2026-09-28T00:00:46.090Z","requestedManila":"2026-09-28 08:00:46.009","respondedManila":"2026-09-28 08:00:46.090","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":55,"scheduledOffsetMs":47000,"requestOffsetMs":47013.8,"responseOffsetMs":47094.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":2},"durationMs":81,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:47.013Z","respondedAt":"2026-09-28T00:00:47.094Z","requestedManila":"2026-09-28 08:00:47.013","respondedManila":"2026-09-28 08:00:47.094","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":56,"scheduledOffsetMs":48000,"requestOffsetMs":48015.8,"responseOffsetMs":48084.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":3},"durationMs":69,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:48.015Z","respondedAt":"2026-09-28T00:00:48.084Z","requestedManila":"2026-09-28 08:00:48.015","respondedManila":"2026-09-28 08:00:48.084","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":57,"scheduledOffsetMs":49000,"requestOffsetMs":49003.8,"responseOffsetMs":49084.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":4},"durationMs":81,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:49.003Z","respondedAt":"2026-09-28T00:00:49.084Z","requestedManila":"2026-09-28 08:00:49.003","respondedManila":"2026-09-28 08:00:49.084","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":58,"scheduledOffsetMs":50000,"requestOffsetMs":50001.8,"responseOffsetMs":50071.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":70,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:50.001Z","respondedAt":"2026-09-28T00:00:50.071Z","requestedManila":"2026-09-28 08:00:50.001","respondedManila":"2026-09-28 08:00:50.071","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":59,"scheduledOffsetMs":51000,"requestOffsetMs":51015.8,"responseOffsetMs":51091.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":6},"durationMs":76,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:51.015Z","respondedAt":"2026-09-28T00:00:51.091Z","requestedManila":"2026-09-28 08:00:51.015","respondedManila":"2026-09-28 08:00:51.091","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":60,"scheduledOffsetMs":52000,"requestOffsetMs":52015.8,"responseOffsetMs":52081.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":7},"durationMs":66,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:52.015Z","respondedAt":"2026-09-28T00:00:52.081Z","requestedManila":"2026-09-28 08:00:52.015","respondedManila":"2026-09-28 08:00:52.081","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":61,"scheduledOffsetMs":53000,"requestOffsetMs":53016.8,"responseOffsetMs":53090.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":8},"durationMs":74,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:53.016Z","respondedAt":"2026-09-28T00:00:53.090Z","requestedManila":"2026-09-28 08:00:53.016","respondedManila":"2026-09-28 08:00:53.090","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":62,"scheduledOffsetMs":54000,"requestOffsetMs":54013.8,"responseOffsetMs":54078.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":9},"durationMs":65,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:54.013Z","respondedAt":"2026-09-28T00:00:54.078Z","requestedManila":"2026-09-28 08:00:54.013","respondedManila":"2026-09-28 08:00:54.078","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":63,"scheduledOffsetMs":55000,"requestOffsetMs":55000.8,"responseOffsetMs":55091.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":91,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:55.000Z","respondedAt":"2026-09-28T00:00:55.091Z","requestedManila":"2026-09-28 08:00:55.000","respondedManila":"2026-09-28 08:00:55.091","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":64,"scheduledOffsetMs":56000,"requestOffsetMs":56015.8,"responseOffsetMs":56107.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":92,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:56.015Z","respondedAt":"2026-09-28T00:00:56.107Z","requestedManila":"2026-09-28 08:00:56.015","respondedManila":"2026-09-28 08:00:56.107","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":65,"scheduledOffsetMs":57000,"requestOffsetMs":57003.8,"responseOffsetMs":57082.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":2},"durationMs":79,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:57.003Z","respondedAt":"2026-09-28T00:00:57.082Z","requestedManila":"2026-09-28 08:00:57.003","respondedManila":"2026-09-28 08:00:57.082","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":66,"scheduledOffsetMs":58000,"requestOffsetMs":58015.8,"responseOffsetMs":58110.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":3},"durationMs":95,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:58.015Z","respondedAt":"2026-09-28T00:00:58.110Z","requestedManila":"2026-09-28 08:00:58.015","respondedManila":"2026-09-28 08:00:58.110","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":67,"scheduledOffsetMs":59000,"requestOffsetMs":59012.8,"responseOffsetMs":59090.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":4},"durationMs":78,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:59.012Z","respondedAt":"2026-09-28T00:00:59.090Z","requestedManila":"2026-09-28 08:00:59.012","respondedManila":"2026-09-28 08:00:59.090","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":68,"scheduledOffsetMs":60000,"requestOffsetMs":60008.8,"responseOffsetMs":60080.8,"outcome":"failed","code":"AVAILABILITY_HTTP_FAILED","targetDatePresent":false,"durationMs":72,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:00.008Z","respondedAt":"2026-09-28T00:01:00.080Z","requestedManila":"2026-09-28 08:01:00.008","respondedManila":"2026-09-28 08:01:00.080","responseComplete":false}
{"type":"bookings","seq":5,"scheduledOffsetMs":60000,"requestOffsetMs":60009.8,"responseOffsetMs":60264.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/18:00","1/19:00","1/20:00","1/21:00","1/22:00","2/17:00","2/18:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/19:00","3/20:00","3/21:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","6/21:00","6/22:00","7/17:00","7/18:00","7/19:00","7/20:00","7/21:00","7/22:00"],"durationMs":255,"requestedAt":"2026-09-28T00:01:00.009Z","respondedAt":"2026-09-28T00:01:00.264Z"}
{"type":"availability","seq":69,"scheduledOffsetMs":65000,"requestOffsetMs":65003.8,"responseOffsetMs":65165.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":162,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:05.003Z","respondedAt":"2026-09-28T00:01:05.165Z","requestedManila":"2026-09-28 08:01:05.003","respondedManila":"2026-09-28 08:01:05.165","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":70,"scheduledOffsetMs":70000,"requestOffsetMs":70007.8,"responseOffsetMs":70163.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":156,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:10.007Z","respondedAt":"2026-09-28T00:01:10.163Z","requestedManila":"2026-09-28 08:01:10.007","respondedManila":"2026-09-28 08:01:10.163","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":71,"scheduledOffsetMs":75000,"requestOffsetMs":75009.8,"responseOffsetMs":75168.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":159,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:15.009Z","respondedAt":"2026-09-28T00:01:15.168Z","requestedManila":"2026-09-28 08:01:15.009","respondedManila":"2026-09-28 08:01:15.168","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":72,"scheduledOffsetMs":80000,"requestOffsetMs":80014.8,"responseOffsetMs":80187.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":173,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:20.014Z","respondedAt":"2026-09-28T00:01:20.187Z","requestedManila":"2026-09-28 08:01:20.014","respondedManila":"2026-09-28 08:01:20.187","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":73,"scheduledOffsetMs":85000,"requestOffsetMs":85016.8,"responseOffsetMs":85185.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":169,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:25.016Z","respondedAt":"2026-09-28T00:01:25.185Z","requestedManila":"2026-09-28 08:01:25.016","respondedManila":"2026-09-28 08:01:25.185","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":74,"scheduledOffsetMs":90000,"requestOffsetMs":90008.8,"responseOffsetMs":90169.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXOOOXO,5:XXXXOOOOOXXOOOXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":161,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:30.008Z","respondedAt":"2026-09-28T00:01:30.169Z","requestedManila":"2026-09-28 08:01:30.008","respondedManila":"2026-09-28 08:01:30.169","dateFlag":"published","responseComplete":true,"counts":{"OPEN":64,"TAKEN":48,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":75,"scheduledOffsetMs":95000,"requestOffsetMs":95003.8,"responseOffsetMs":95174.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXOOOXO,5:XXXXOOOOOXXOOOXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":171,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:35.003Z","respondedAt":"2026-09-28T00:01:35.174Z","requestedManila":"2026-09-28 08:01:35.003","respondedManila":"2026-09-28 08:01:35.174","dateFlag":"published","responseComplete":true,"counts":{"OPEN":64,"TAKEN":48,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":76,"scheduledOffsetMs":100000,"requestOffsetMs":100004.8,"responseOffsetMs":100173.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":169,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:40.004Z","respondedAt":"2026-09-28T00:01:40.173Z","requestedManila":"2026-09-28 08:01:40.004","respondedManila":"2026-09-28 08:01:40.173","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":77,"scheduledOffsetMs":105000,"requestOffsetMs":105003.8,"responseOffsetMs":105172.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":0},"durationMs":169,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:45.003Z","respondedAt":"2026-09-28T00:01:45.172Z","requestedManila":"2026-09-28 08:01:45.003","respondedManila":"2026-09-28 08:01:45.172","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":78,"scheduledOffsetMs":110000,"requestOffsetMs":110014.8,"responseOffsetMs":110186.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":172,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:50.014Z","respondedAt":"2026-09-28T00:01:50.186Z","requestedManila":"2026-09-28 08:01:50.014","respondedManila":"2026-09-28 08:01:50.186","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":79,"scheduledOffsetMs":115000,"requestOffsetMs":115003.8,"responseOffsetMs":115167.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":164,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:55.003Z","respondedAt":"2026-09-28T00:01:55.167Z","requestedManila":"2026-09-28 08:01:55.003","respondedManila":"2026-09-28 08:01:55.167","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":80,"scheduledOffsetMs":120000,"requestOffsetMs":120011.8,"responseOffsetMs":120167.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":156,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:02:00.011Z","respondedAt":"2026-09-28T00:02:00.167Z","requestedManila":"2026-09-28 08:02:00.011","respondedManila":"2026-09-28 08:02:00.167","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"bookings","seq":6,"scheduledOffsetMs":120000,"requestOffsetMs":120012.8,"responseOffsetMs":120239.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/18:00","1/19:00","1/20:00","1/21:00","1/22:00","2/17:00","2/18:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/19:00","3/20:00","3/21:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","6/21:00","6/22:00","7/17:00","7/18:00","7/19:00","7/20:00","7/21:00","7/22:00"],"durationMs":227,"requestedAt":"2026-09-28T00:02:00.012Z","respondedAt":"2026-09-28T00:02:00.239Z"}
{"type":"availability","seq":81,"scheduledOffsetMs":125000,"requestOffsetMs":125006.8,"responseOffsetMs":125168.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":162,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:02:05.006Z","respondedAt":"2026-09-28T00:02:05.168Z","requestedManila":"2026-09-28 08:02:05.006","respondedManila":"2026-09-28 08:02:05.168","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":82,"scheduledOffsetMs":130000,"requestOffsetMs":130013.8,"responseOffsetMs":130167.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":154,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:02:10.013Z","respondedAt":"2026-09-28T00:02:10.167Z","requestedManila":"2026-09-28 08:02:10.013","respondedManila":"2026-09-28 08:02:10.167","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":83,"scheduledOffsetMs":135000,"requestOffsetMs":135001.8,"responseOffsetMs":135153.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":152,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:02:15.001Z","respondedAt":"2026-09-28T00:02:15.153Z","requestedManila":"2026-09-28 08:02:15.001","respondedManila":"2026-09-28 08:02:15.153","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":84,"scheduledOffsetMs":140000,"requestOffsetMs":140002.8,"responseOffsetMs":140190.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":188,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:02:20.002Z","respondedAt":"2026-09-28T00:02:20.190Z","requestedManila":"2026-09-28 08:02:20.002","respondedManila":"2026-09-28 08:02:20.190","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":85,"scheduledOffsetMs":145000,"requestOffsetMs":145013.8,"responseOffsetMs":145180.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":167,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:02:25.013Z","respondedAt":"2026-09-28T00:02:25.180Z","requestedManila":"2026-09-28 08:02:25.013","respondedManila":"2026-09-28 08:02:25.180","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":86,"scheduledOffsetMs":150000,"requestOffsetMs":150001.8,"responseOffsetMs":150165.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":164,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:02:30.001Z","respondedAt":"2026-09-28T00:02:30.165Z","requestedManila":"2026-09-28 08:02:30.001","respondedManila":"2026-09-28 08:02:30.165","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":87,"scheduledOffsetMs":155000,"requestOffsetMs":155002.8,"responseOffsetMs":155167.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":0},"durationMs":165,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:02:35.002Z","respondedAt":"2026-09-28T00:02:35.167Z","requestedManila":"2026-09-28 08:02:35.002","respondedManila":"2026-09-28 08:02:35.167","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":88,"scheduledOffsetMs":160000,"requestOffsetMs":160010.8,"responseOffsetMs":160217.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":207,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:02:40.010Z","respondedAt":"2026-09-28T00:02:40.217Z","requestedManila":"2026-09-28 08:02:40.010","respondedManila":"2026-09-28 08:02:40.217","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":89,"scheduledOffsetMs":165000,"requestOffsetMs":165003.8,"responseOffsetMs":165168.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":165,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:02:45.003Z","respondedAt":"2026-09-28T00:02:45.168Z","requestedManila":"2026-09-28 08:02:45.003","respondedManila":"2026-09-28 08:02:45.168","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":90,"scheduledOffsetMs":170000,"requestOffsetMs":170000.8,"responseOffsetMs":170178.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":178,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:02:50.000Z","respondedAt":"2026-09-28T00:02:50.178Z","requestedManila":"2026-09-28 08:02:50.000","respondedManila":"2026-09-28 08:02:50.178","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":91,"scheduledOffsetMs":175000,"requestOffsetMs":175003.8,"responseOffsetMs":175175.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":172,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:02:55.003Z","respondedAt":"2026-09-28T00:02:55.175Z","requestedManila":"2026-09-28 08:02:55.003","respondedManila":"2026-09-28 08:02:55.175","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":92,"scheduledOffsetMs":180000,"requestOffsetMs":180006.8,"responseOffsetMs":180178.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":172,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:03:00.006Z","respondedAt":"2026-09-28T00:03:00.178Z","requestedManila":"2026-09-28 08:03:00.006","respondedManila":"2026-09-28 08:03:00.178","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":93,"scheduledOffsetMs":185000,"requestOffsetMs":185011.8,"responseOffsetMs":185205.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":194,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:03:05.011Z","respondedAt":"2026-09-28T00:03:05.205Z","requestedManila":"2026-09-28 08:03:05.011","respondedManila":"2026-09-28 08:03:05.205","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":94,"scheduledOffsetMs":190000,"requestOffsetMs":190008.8,"responseOffsetMs":190185.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":177,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:03:10.008Z","respondedAt":"2026-09-28T00:03:10.185Z","requestedManila":"2026-09-28 08:03:10.008","respondedManila":"2026-09-28 08:03:10.185","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":95,"scheduledOffsetMs":195000,"requestOffsetMs":195012.8,"responseOffsetMs":195170.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":158,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:03:15.012Z","respondedAt":"2026-09-28T00:03:15.170Z","requestedManila":"2026-09-28 08:03:15.012","respondedManila":"2026-09-28 08:03:15.170","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":96,"scheduledOffsetMs":200000,"requestOffsetMs":200014.8,"responseOffsetMs":200177.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":163,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:03:20.014Z","respondedAt":"2026-09-28T00:03:20.177Z","requestedManila":"2026-09-28 08:03:20.014","respondedManila":"2026-09-28 08:03:20.177","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":97,"scheduledOffsetMs":205000,"requestOffsetMs":205010.8,"responseOffsetMs":205172.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":162,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:03:25.010Z","respondedAt":"2026-09-28T00:03:25.172Z","requestedManila":"2026-09-28 08:03:25.010","respondedManila":"2026-09-28 08:03:25.172","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":98,"scheduledOffsetMs":210000,"requestOffsetMs":210012.8,"responseOffsetMs":210167.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":155,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:03:30.012Z","respondedAt":"2026-09-28T00:03:30.167Z","requestedManila":"2026-09-28 08:03:30.012","respondedManila":"2026-09-28 08:03:30.167","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":99,"scheduledOffsetMs":215000,"requestOffsetMs":215016.8,"responseOffsetMs":215174.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":158,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:03:35.016Z","respondedAt":"2026-09-28T00:03:35.174Z","requestedManila":"2026-09-28 08:03:35.016","respondedManila":"2026-09-28 08:03:35.174","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":100,"scheduledOffsetMs":220000,"requestOffsetMs":220009.8,"responseOffsetMs":220168.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":159,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:03:40.009Z","respondedAt":"2026-09-28T00:03:40.168Z","requestedManila":"2026-09-28 08:03:40.009","respondedManila":"2026-09-28 08:03:40.168","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":101,"scheduledOffsetMs":225000,"requestOffsetMs":225001.8,"responseOffsetMs":225180.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":179,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:03:45.001Z","respondedAt":"2026-09-28T00:03:45.180Z","requestedManila":"2026-09-28 08:03:45.001","respondedManila":"2026-09-28 08:03:45.180","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":102,"scheduledOffsetMs":230000,"requestOffsetMs":230008.8,"responseOffsetMs":230167.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":159,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:03:50.008Z","respondedAt":"2026-09-28T00:03:50.167Z","requestedManila":"2026-09-28 08:03:50.008","respondedManila":"2026-09-28 08:03:50.167","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":103,"scheduledOffsetMs":235000,"requestOffsetMs":235005.8,"responseOffsetMs":235174.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":169,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:03:55.005Z","respondedAt":"2026-09-28T00:03:55.174Z","requestedManila":"2026-09-28 08:03:55.005","respondedManila":"2026-09-28 08:03:55.174","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":104,"scheduledOffsetMs":240000,"requestOffsetMs":240001.8,"responseOffsetMs":240194.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":193,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:04:00.001Z","respondedAt":"2026-09-28T00:04:00.194Z","requestedManila":"2026-09-28 08:04:00.001","respondedManila":"2026-09-28 08:04:00.194","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":105,"scheduledOffsetMs":245000,"requestOffsetMs":245011.8,"responseOffsetMs":245196.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":0},"durationMs":185,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:04:05.011Z","respondedAt":"2026-09-28T00:04:05.196Z","requestedManila":"2026-09-28 08:04:05.011","respondedManila":"2026-09-28 08:04:05.196","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":106,"scheduledOffsetMs":250000,"requestOffsetMs":250013.8,"responseOffsetMs":250181.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":168,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:04:10.013Z","respondedAt":"2026-09-28T00:04:10.181Z","requestedManila":"2026-09-28 08:04:10.013","respondedManila":"2026-09-28 08:04:10.181","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":107,"scheduledOffsetMs":255000,"requestOffsetMs":255009.8,"responseOffsetMs":255168.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":159,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:04:15.009Z","respondedAt":"2026-09-28T00:04:15.168Z","requestedManila":"2026-09-28 08:04:15.009","respondedManila":"2026-09-28 08:04:15.168","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":108,"scheduledOffsetMs":260000,"requestOffsetMs":260007.8,"responseOffsetMs":260162.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":155,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:04:20.007Z","respondedAt":"2026-09-28T00:04:20.162Z","requestedManila":"2026-09-28 08:04:20.007","respondedManila":"2026-09-28 08:04:20.162","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":109,"scheduledOffsetMs":265000,"requestOffsetMs":265011.8,"responseOffsetMs":265185.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":174,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:04:25.011Z","respondedAt":"2026-09-28T00:04:25.185Z","requestedManila":"2026-09-28 08:04:25.011","respondedManila":"2026-09-28 08:04:25.185","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":110,"scheduledOffsetMs":270000,"requestOffsetMs":270004.8,"responseOffsetMs":270187.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":183,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:04:30.004Z","respondedAt":"2026-09-28T00:04:30.187Z","requestedManila":"2026-09-28 08:04:30.004","respondedManila":"2026-09-28 08:04:30.187","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":111,"scheduledOffsetMs":275000,"requestOffsetMs":275011.8,"responseOffsetMs":275177.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":166,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:04:35.011Z","respondedAt":"2026-09-28T00:04:35.177Z","requestedManila":"2026-09-28 08:04:35.011","respondedManila":"2026-09-28 08:04:35.177","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":112,"scheduledOffsetMs":280000,"requestOffsetMs":280015.8,"responseOffsetMs":280174.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":159,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:04:40.015Z","respondedAt":"2026-09-28T00:04:40.174Z","requestedManila":"2026-09-28 08:04:40.015","respondedManila":"2026-09-28 08:04:40.174","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":113,"scheduledOffsetMs":285000,"requestOffsetMs":285001.8,"responseOffsetMs":285161.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":160,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:04:45.001Z","respondedAt":"2026-09-28T00:04:45.161Z","requestedManila":"2026-09-28 08:04:45.001","respondedManila":"2026-09-28 08:04:45.161","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":114,"scheduledOffsetMs":290000,"requestOffsetMs":290006.8,"responseOffsetMs":290167.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":161,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:04:50.006Z","respondedAt":"2026-09-28T00:04:50.167Z","requestedManila":"2026-09-28 08:04:50.006","respondedManila":"2026-09-28 08:04:50.167","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":115,"scheduledOffsetMs":295000,"requestOffsetMs":295008.8,"responseOffsetMs":295191.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":183,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:04:55.008Z","respondedAt":"2026-09-28T00:04:55.191Z","requestedManila":"2026-09-28 08:04:55.008","respondedManila":"2026-09-28 08:04:55.191","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":116,"scheduledOffsetMs":300000,"requestOffsetMs":300007.8,"responseOffsetMs":300174.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":167,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:05:00.007Z","respondedAt":"2026-09-28T00:05:00.174Z","requestedManila":"2026-09-28 08:05:00.007","respondedManila":"2026-09-28 08:05:00.174","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"bookings","seq":7,"scheduledOffsetMs":300000,"requestOffsetMs":300008.8,"responseOffsetMs":300232.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/18:00","1/19:00","1/20:00","1/21:00","1/22:00","2/17:00","2/18:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","6/21:00","6/22:00","7/17:00","7/18:00","7/19:00","7/20:00","7/21:00","7/22:00"],"durationMs":224,"requestedAt":"2026-09-28T00:05:00.008Z","respondedAt":"2026-09-28T00:05:00.232Z"}
{"type":"availability","seq":117,"scheduledOffsetMs":330000,"requestOffsetMs":330015.8,"responseOffsetMs":330184.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":169,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:05:30.015Z","respondedAt":"2026-09-28T00:05:30.184Z","requestedManila":"2026-09-28 08:05:30.015","respondedManila":"2026-09-28 08:05:30.184","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":118,"scheduledOffsetMs":360000,"requestOffsetMs":360006.8,"responseOffsetMs":360162.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXOOO,2:OOOOOOOOOXXXXOOO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":156,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:06:00.006Z","respondedAt":"2026-09-28T00:06:00.162Z","requestedManila":"2026-09-28 08:06:00.006","respondedManila":"2026-09-28 08:06:00.162","dateFlag":"published","responseComplete":true,"counts":{"OPEN":65,"TAKEN":47,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":119,"scheduledOffsetMs":390000,"requestOffsetMs":390014.8,"responseOffsetMs":390182.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXOOO,2:OOOOOOOOOXXXXOOO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":168,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:06:30.014Z","respondedAt":"2026-09-28T00:06:30.182Z","requestedManila":"2026-09-28 08:06:30.014","respondedManila":"2026-09-28 08:06:30.182","dateFlag":"published","responseComplete":true,"counts":{"OPEN":65,"TAKEN":47,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":120,"scheduledOffsetMs":420000,"requestOffsetMs":420008.8,"responseOffsetMs":420186.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXOOO,2:OOOOOOOOOXXXXOOO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":178,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:07:00.008Z","respondedAt":"2026-09-28T00:07:00.186Z","requestedManila":"2026-09-28 08:07:00.008","respondedManila":"2026-09-28 08:07:00.186","dateFlag":"published","responseComplete":true,"counts":{"OPEN":65,"TAKEN":47,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":121,"scheduledOffsetMs":450000,"requestOffsetMs":450006.8,"responseOffsetMs":450163.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXOOO,2:OOOOOOOOOXXXXOOO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":157,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:07:30.006Z","respondedAt":"2026-09-28T00:07:30.163Z","requestedManila":"2026-09-28 08:07:30.006","respondedManila":"2026-09-28 08:07:30.163","dateFlag":"published","responseComplete":true,"counts":{"OPEN":65,"TAKEN":47,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":122,"scheduledOffsetMs":480000,"requestOffsetMs":480002.8,"responseOffsetMs":480179.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXOOO,2:OOOOOOOOOXXXXOOO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":177,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:08:00.002Z","respondedAt":"2026-09-28T00:08:00.179Z","requestedManila":"2026-09-28 08:08:00.002","respondedManila":"2026-09-28 08:08:00.179","dateFlag":"published","responseComplete":true,"counts":{"OPEN":65,"TAKEN":47,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":123,"scheduledOffsetMs":510000,"requestOffsetMs":510013.8,"responseOffsetMs":510206.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXOOO,2:OOOOOOOOOOOXXOOO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":193,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:08:30.013Z","respondedAt":"2026-09-28T00:08:30.206Z","requestedManila":"2026-09-28 08:08:30.013","respondedManila":"2026-09-28 08:08:30.206","dateFlag":"published","responseComplete":true,"counts":{"OPEN":69,"TAKEN":43,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":124,"scheduledOffsetMs":540000,"requestOffsetMs":540011.8,"responseOffsetMs":540178.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXOOO,2:OOOOOOOOOOOXXOOO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":167,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:09:00.011Z","respondedAt":"2026-09-28T00:09:00.178Z","requestedManila":"2026-09-28 08:09:00.011","respondedManila":"2026-09-28 08:09:00.178","dateFlag":"published","responseComplete":true,"counts":{"OPEN":69,"TAKEN":43,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":125,"scheduledOffsetMs":570000,"requestOffsetMs":570002.8,"responseOffsetMs":570197.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXOOO,2:OOOOOOOOOOOXXOOO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":195,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:09:30.002Z","respondedAt":"2026-09-28T00:09:30.197Z","requestedManila":"2026-09-28 08:09:30.002","respondedManila":"2026-09-28 08:09:30.197","dateFlag":"published","responseComplete":true,"counts":{"OPEN":69,"TAKEN":43,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":126,"scheduledOffsetMs":595000,"requestOffsetMs":595007.8,"responseOffsetMs":595177.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":170,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:09:55.007Z","respondedAt":"2026-09-28T00:09:55.177Z","requestedManila":"2026-09-28 08:09:55.007","respondedManila":"2026-09-28 08:09:55.177","dateFlag":"published","responseComplete":true,"counts":{"OPEN":63,"TAKEN":49,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":127,"scheduledOffsetMs":596000,"requestOffsetMs":596002.8,"responseOffsetMs":596103.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":101,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:09:56.002Z","respondedAt":"2026-09-28T00:09:56.103Z","requestedManila":"2026-09-28 08:09:56.002","respondedManila":"2026-09-28 08:09:56.103","dateFlag":"published","responseComplete":true,"counts":{"OPEN":63,"TAKEN":49,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":128,"scheduledOffsetMs":597000,"requestOffsetMs":597001.8,"responseOffsetMs":597069.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":2},"durationMs":68,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:09:57.001Z","respondedAt":"2026-09-28T00:09:57.069Z","requestedManila":"2026-09-28 08:09:57.001","respondedManila":"2026-09-28 08:09:57.069","dateFlag":"published","responseComplete":true,"counts":{"OPEN":63,"TAKEN":49,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":129,"scheduledOffsetMs":598000,"requestOffsetMs":598003.8,"responseOffsetMs":598084.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":3},"durationMs":81,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:09:58.003Z","respondedAt":"2026-09-28T00:09:58.084Z","requestedManila":"2026-09-28 08:09:58.003","respondedManila":"2026-09-28 08:09:58.084","dateFlag":"published","responseComplete":true,"counts":{"OPEN":63,"TAKEN":49,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":130,"scheduledOffsetMs":599000,"requestOffsetMs":599005.8,"responseOffsetMs":599099.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":4},"durationMs":94,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:09:59.005Z","respondedAt":"2026-09-28T00:09:59.099Z","requestedManila":"2026-09-28 08:09:59.005","respondedManila":"2026-09-28 08:09:59.099","dateFlag":"published","responseComplete":true,"counts":{"OPEN":63,"TAKEN":49,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":131,"scheduledOffsetMs":600000,"requestOffsetMs":600006.8,"responseOffsetMs":600086.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:00.006Z","respondedAt":"2026-09-28T00:10:00.086Z","requestedManila":"2026-09-28 08:10:00.006","respondedManila":"2026-09-28 08:10:00.086","dateFlag":"published","responseComplete":true,"counts":{"OPEN":63,"TAKEN":49,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"bookings","seq":8,"scheduledOffsetMs":600000,"requestOffsetMs":600007.8,"responseOffsetMs":600366.8,"outcome":"ok","failedCourts":[],"cells":["1/19:00","1/20:00","1/21:00","1/22:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/19:00","3/20:00","3/21:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","7/17:00","7/18:00","7/19:00","7/20:00","7/21:00"],"durationMs":359,"requestedAt":"2026-09-28T00:10:00.007Z","respondedAt":"2026-09-28T00:10:00.366Z"}
{"type":"availability","seq":132,"scheduledOffsetMs":601000,"requestOffsetMs":601001.8,"responseOffsetMs":601081.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":6},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:01.001Z","respondedAt":"2026-09-28T00:10:01.081Z","requestedManila":"2026-09-28 08:10:01.001","respondedManila":"2026-09-28 08:10:01.081","dateFlag":"published","responseComplete":true,"counts":{"OPEN":63,"TAKEN":49,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":133,"scheduledOffsetMs":602000,"requestOffsetMs":602001.8,"responseOffsetMs":602088.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":7},"durationMs":87,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:02.001Z","respondedAt":"2026-09-28T00:10:02.088Z","requestedManila":"2026-09-28 08:10:02.001","respondedManila":"2026-09-28 08:10:02.088","dateFlag":"published","responseComplete":true,"counts":{"OPEN":63,"TAKEN":49,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":134,"scheduledOffsetMs":603000,"requestOffsetMs":603000.8,"responseOffsetMs":603067.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":8},"durationMs":67,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:03.000Z","respondedAt":"2026-09-28T00:10:03.067Z","requestedManila":"2026-09-28 08:10:03.000","respondedManila":"2026-09-28 08:10:03.067","dateFlag":"published","responseComplete":true,"counts":{"OPEN":63,"TAKEN":49,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":135,"scheduledOffsetMs":604000,"requestOffsetMs":604002.8,"responseOffsetMs":604083.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":9},"durationMs":81,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:04.002Z","respondedAt":"2026-09-28T00:10:04.083Z","requestedManila":"2026-09-28 08:10:04.002","respondedManila":"2026-09-28 08:10:04.083","dateFlag":"published","responseComplete":true,"counts":{"OPEN":63,"TAKEN":49,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":136,"scheduledOffsetMs":605000,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":87,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:05.002Z","respondedAt":"2026-09-28T00:10:05.089Z","requestedManila":"2026-09-28 08:10:05.002","respondedManila":"2026-09-28 08:10:05.089","dateFlag":"published","responseComplete":true,"counts":{"OPEN":63,"TAKEN":49,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":137,"scheduledOffsetMs":606000,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOOXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOXXXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":76,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:06.014Z","respondedAt":"2026-09-28T00:10:06.090Z","requestedManila":"2026-09-28 08:10:06.014","respondedManila":"2026-09-28 08:10:06.090","dateFlag":"published","responseComplete":true,"counts":{"OPEN":78,"TAKEN":34,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":138,"scheduledOffsetMs":607000,"requestOffsetMs":607014.8,"responseOffsetMs":607084.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOOXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOXXXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":2},"durationMs":70,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:07.014Z","respondedAt":"2026-09-28T00:10:07.084Z","requestedManila":"2026-09-28 08:10:07.014","respondedManila":"2026-09-28 08:10:07.084","dateFlag":"published","responseComplete":true,"counts":{"OPEN":78,"TAKEN":34,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":139,"scheduledOffsetMs":608000,"requestOffsetMs":608013.8,"responseOffsetMs":608096.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOOXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOXXXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":3},"durationMs":83,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:08.013Z","respondedAt":"2026-09-28T00:10:08.096Z","requestedManila":"2026-09-28 08:10:08.013","respondedManila":"2026-09-28 08:10:08.096","dateFlag":"published","responseComplete":true,"counts":{"OPEN":78,"TAKEN":34,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":140,"scheduledOffsetMs":609000,"requestOffsetMs":609000.8,"responseOffsetMs":609080.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOOXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOXXXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":4},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:09.000Z","respondedAt":"2026-09-28T00:10:09.080Z","requestedManila":"2026-09-28 08:10:09.000","respondedManila":"2026-09-28 08:10:09.080","dateFlag":"published","responseComplete":true,"counts":{"OPEN":78,"TAKEN":34,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":141,"scheduledOffsetMs":610000,"requestOffsetMs":610015.8,"responseOffsetMs":610109.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOOXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOXXXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":94,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:10.015Z","respondedAt":"2026-09-28T00:10:10.109Z","requestedManila":"2026-09-28 08:10:10.015","respondedManila":"2026-09-28 08:10:10.109","dateFlag":"published","responseComplete":true,"counts":{"OPEN":78,"TAKEN":34,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":142,"scheduledOffsetMs":611000,"requestOffsetMs":611014.8,"responseOffsetMs":611090.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOOXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOXXXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":6},"durationMs":76,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:11.014Z","respondedAt":"2026-09-28T00:10:11.090Z","requestedManila":"2026-09-28 08:10:11.014","respondedManila":"2026-09-28 08:10:11.090","dateFlag":"published","responseComplete":true,"counts":{"OPEN":78,"TAKEN":34,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":143,"scheduledOffsetMs":612000,"requestOffsetMs":612013.8,"responseOffsetMs":612100.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOOXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOXXXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":7},"durationMs":87,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:12.013Z","respondedAt":"2026-09-28T00:10:12.100Z","requestedManila":"2026-09-28 08:10:12.013","respondedManila":"2026-09-28 08:10:12.100","dateFlag":"published","responseComplete":true,"counts":{"OPEN":78,"TAKEN":34,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":144,"scheduledOffsetMs":613000,"requestOffsetMs":613008.8,"responseOffsetMs":613089.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOOXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOXXXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":8},"durationMs":81,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:13.008Z","respondedAt":"2026-09-28T00:10:13.089Z","requestedManila":"2026-09-28 08:10:13.008","respondedManila":"2026-09-28 08:10:13.089","dateFlag":"published","responseComplete":true,"counts":{"OPEN":78,"TAKEN":34,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":145,"scheduledOffsetMs":614000,"requestOffsetMs":614004.8,"responseOffsetMs":614111.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOOXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOXXXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":9},"durationMs":107,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:14.004Z","respondedAt":"2026-09-28T00:10:14.111Z","requestedManila":"2026-09-28 08:10:14.004","respondedManila":"2026-09-28 08:10:14.111","dateFlag":"published","responseComplete":true,"counts":{"OPEN":78,"TAKEN":34,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":146,"scheduledOffsetMs":615000,"requestOffsetMs":615000.8,"responseOffsetMs":615065.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOOXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOXXXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":65,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:15.000Z","respondedAt":"2026-09-28T00:10:15.065Z","requestedManila":"2026-09-28 08:10:15.000","respondedManila":"2026-09-28 08:10:15.065","dateFlag":"published","responseComplete":true,"counts":{"OPEN":78,"TAKEN":34,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":147,"scheduledOffsetMs":616000,"requestOffsetMs":616002.8,"responseOffsetMs":616067.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":65,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:16.002Z","respondedAt":"2026-09-28T00:10:16.067Z","requestedManila":"2026-09-28 08:10:16.002","respondedManila":"2026-09-28 08:10:16.067","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":148,"scheduledOffsetMs":617000,"requestOffsetMs":617000.8,"responseOffsetMs":617080.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":2},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:17.000Z","respondedAt":"2026-09-28T00:10:17.080Z","requestedManila":"2026-09-28 08:10:17.000","respondedManila":"2026-09-28 08:10:17.080","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":149,"scheduledOffsetMs":618000,"requestOffsetMs":618006.8,"responseOffsetMs":618105.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":3},"durationMs":99,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:18.006Z","respondedAt":"2026-09-28T00:10:18.105Z","requestedManila":"2026-09-28 08:10:18.006","respondedManila":"2026-09-28 08:10:18.105","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":150,"scheduledOffsetMs":619000,"requestOffsetMs":619006.8,"responseOffsetMs":619084.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":4},"durationMs":78,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:19.006Z","respondedAt":"2026-09-28T00:10:19.084Z","requestedManila":"2026-09-28 08:10:19.006","respondedManila":"2026-09-28 08:10:19.084","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":151,"scheduledOffsetMs":620000,"requestOffsetMs":620002.8,"responseOffsetMs":620076.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":74,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:20.002Z","respondedAt":"2026-09-28T00:10:20.076Z","requestedManila":"2026-09-28 08:10:20.002","respondedManila":"2026-09-28 08:10:20.076","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":152,"scheduledOffsetMs":621000,"requestOffsetMs":621001.8,"responseOffsetMs":621069.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":6},"durationMs":68,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:21.001Z","respondedAt":"2026-09-28T00:10:21.069Z","requestedManila":"2026-09-28 08:10:21.001","respondedManila":"2026-09-28 08:10:21.069","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":153,"scheduledOffsetMs":622000,"requestOffsetMs":622014.8,"responseOffsetMs":622097.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":7},"durationMs":83,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:22.014Z","respondedAt":"2026-09-28T00:10:22.097Z","requestedManila":"2026-09-28 08:10:22.014","respondedManila":"2026-09-28 08:10:22.097","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":154,"scheduledOffsetMs":623000,"requestOffsetMs":623014.8,"responseOffsetMs":623094.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":8},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:23.014Z","respondedAt":"2026-09-28T00:10:23.094Z","requestedManila":"2026-09-28 08:10:23.014","respondedManila":"2026-09-28 08:10:23.094","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":155,"scheduledOffsetMs":624000,"requestOffsetMs":624008.8,"responseOffsetMs":624088.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":9},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:24.008Z","respondedAt":"2026-09-28T00:10:24.088Z","requestedManila":"2026-09-28 08:10:24.008","respondedManila":"2026-09-28 08:10:24.088","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":156,"scheduledOffsetMs":625000,"requestOffsetMs":625005.8,"responseOffsetMs":625083.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":78,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:25.005Z","respondedAt":"2026-09-28T00:10:25.083Z","requestedManila":"2026-09-28 08:10:25.005","respondedManila":"2026-09-28 08:10:25.083","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":157,"scheduledOffsetMs":626000,"requestOffsetMs":626006.8,"responseOffsetMs":626078.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":72,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:26.006Z","respondedAt":"2026-09-28T00:10:26.078Z","requestedManila":"2026-09-28 08:10:26.006","respondedManila":"2026-09-28 08:10:26.078","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":158,"scheduledOffsetMs":627000,"requestOffsetMs":627008.8,"responseOffsetMs":627095.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":2},"durationMs":87,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:27.008Z","respondedAt":"2026-09-28T00:10:27.095Z","requestedManila":"2026-09-28 08:10:27.008","respondedManila":"2026-09-28 08:10:27.095","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":159,"scheduledOffsetMs":628000,"requestOffsetMs":628006.8,"responseOffsetMs":628091.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":3},"durationMs":85,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:28.006Z","respondedAt":"2026-09-28T00:10:28.091Z","requestedManila":"2026-09-28 08:10:28.006","respondedManila":"2026-09-28 08:10:28.091","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":160,"scheduledOffsetMs":629000,"requestOffsetMs":629000.8,"responseOffsetMs":629080.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":4},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:29.000Z","respondedAt":"2026-09-28T00:10:29.080Z","requestedManila":"2026-09-28 08:10:29.000","respondedManila":"2026-09-28 08:10:29.080","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":161,"scheduledOffsetMs":630000,"requestOffsetMs":630004.8,"responseOffsetMs":630090.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":86,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:30.004Z","respondedAt":"2026-09-28T00:10:30.090Z","requestedManila":"2026-09-28 08:10:30.004","respondedManila":"2026-09-28 08:10:30.090","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":162,"scheduledOffsetMs":631000,"requestOffsetMs":631003.8,"responseOffsetMs":631098.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":6},"durationMs":95,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:31.003Z","respondedAt":"2026-09-28T00:10:31.098Z","requestedManila":"2026-09-28 08:10:31.003","respondedManila":"2026-09-28 08:10:31.098","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":163,"scheduledOffsetMs":632000,"requestOffsetMs":632004.8,"responseOffsetMs":632083.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":7},"durationMs":79,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:32.004Z","respondedAt":"2026-09-28T00:10:32.083Z","requestedManila":"2026-09-28 08:10:32.004","respondedManila":"2026-09-28 08:10:32.083","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":164,"scheduledOffsetMs":633000,"requestOffsetMs":633014.8,"responseOffsetMs":633094.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":8},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:33.014Z","respondedAt":"2026-09-28T00:10:33.094Z","requestedManila":"2026-09-28 08:10:33.014","respondedManila":"2026-09-28 08:10:33.094","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":165,"scheduledOffsetMs":634000,"requestOffsetMs":634001.8,"responseOffsetMs":634083.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":9},"durationMs":82,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:34.001Z","respondedAt":"2026-09-28T00:10:34.083Z","requestedManila":"2026-09-28 08:10:34.001","respondedManila":"2026-09-28 08:10:34.083","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":166,"scheduledOffsetMs":635000,"requestOffsetMs":635015.8,"responseOffsetMs":635109.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":94,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:35.015Z","respondedAt":"2026-09-28T00:10:35.109Z","requestedManila":"2026-09-28 08:10:35.015","respondedManila":"2026-09-28 08:10:35.109","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":167,"scheduledOffsetMs":636000,"requestOffsetMs":636012.8,"responseOffsetMs":636094.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":82,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:36.012Z","respondedAt":"2026-09-28T00:10:36.094Z","requestedManila":"2026-09-28 08:10:36.012","respondedManila":"2026-09-28 08:10:36.094","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":168,"scheduledOffsetMs":637000,"requestOffsetMs":637001.8,"responseOffsetMs":637095.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":2},"durationMs":94,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:37.001Z","respondedAt":"2026-09-28T00:10:37.095Z","requestedManila":"2026-09-28 08:10:37.001","respondedManila":"2026-09-28 08:10:37.095","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":169,"scheduledOffsetMs":638000,"requestOffsetMs":638006.8,"responseOffsetMs":638084.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":3},"durationMs":78,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:38.006Z","respondedAt":"2026-09-28T00:10:38.084Z","requestedManila":"2026-09-28 08:10:38.006","respondedManila":"2026-09-28 08:10:38.084","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":170,"scheduledOffsetMs":639000,"requestOffsetMs":639003.8,"responseOffsetMs":639083.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":4},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:39.003Z","respondedAt":"2026-09-28T00:10:39.083Z","requestedManila":"2026-09-28 08:10:39.003","respondedManila":"2026-09-28 08:10:39.083","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":171,"scheduledOffsetMs":640000,"requestOffsetMs":640004.8,"responseOffsetMs":640073.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":69,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:40.004Z","respondedAt":"2026-09-28T00:10:40.073Z","requestedManila":"2026-09-28 08:10:40.004","respondedManila":"2026-09-28 08:10:40.073","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":172,"scheduledOffsetMs":641000,"requestOffsetMs":641002.8,"responseOffsetMs":641095.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":6},"durationMs":93,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:41.002Z","respondedAt":"2026-09-28T00:10:41.095Z","requestedManila":"2026-09-28 08:10:41.002","respondedManila":"2026-09-28 08:10:41.095","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":173,"scheduledOffsetMs":642000,"requestOffsetMs":642000.8,"responseOffsetMs":642079.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":7},"durationMs":79,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:42.000Z","respondedAt":"2026-09-28T00:10:42.079Z","requestedManila":"2026-09-28 08:10:42.000","respondedManila":"2026-09-28 08:10:42.079","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":174,"scheduledOffsetMs":643000,"requestOffsetMs":643006.8,"responseOffsetMs":643112.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":8},"durationMs":106,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:43.006Z","respondedAt":"2026-09-28T00:10:43.112Z","requestedManila":"2026-09-28 08:10:43.006","respondedManila":"2026-09-28 08:10:43.112","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":175,"scheduledOffsetMs":644000,"requestOffsetMs":644004.8,"responseOffsetMs":644086.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":9},"durationMs":82,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:44.004Z","respondedAt":"2026-09-28T00:10:44.086Z","requestedManila":"2026-09-28 08:10:44.004","respondedManila":"2026-09-28 08:10:44.086","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":176,"scheduledOffsetMs":645000,"requestOffsetMs":645004.8,"responseOffsetMs":645080.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":76,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:45.004Z","respondedAt":"2026-09-28T00:10:45.080Z","requestedManila":"2026-09-28 08:10:45.004","respondedManila":"2026-09-28 08:10:45.080","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":177,"scheduledOffsetMs":646000,"requestOffsetMs":646003.8,"responseOffsetMs":646072.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":69,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:46.003Z","respondedAt":"2026-09-28T00:10:46.072Z","requestedManila":"2026-09-28 08:10:46.003","respondedManila":"2026-09-28 08:10:46.072","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":178,"scheduledOffsetMs":647000,"requestOffsetMs":647002.8,"responseOffsetMs":647070.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":2},"durationMs":68,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:47.002Z","respondedAt":"2026-09-28T00:10:47.070Z","requestedManila":"2026-09-28 08:10:47.002","respondedManila":"2026-09-28 08:10:47.070","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":179,"scheduledOffsetMs":648000,"requestOffsetMs":648009.8,"responseOffsetMs":648094.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":3},"durationMs":85,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:48.009Z","respondedAt":"2026-09-28T00:10:48.094Z","requestedManila":"2026-09-28 08:10:48.009","respondedManila":"2026-09-28 08:10:48.094","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":180,"scheduledOffsetMs":649000,"requestOffsetMs":649001.8,"responseOffsetMs":649108.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":4},"durationMs":107,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:49.001Z","respondedAt":"2026-09-28T00:10:49.108Z","requestedManila":"2026-09-28 08:10:49.001","respondedManila":"2026-09-28 08:10:49.108","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":181,"scheduledOffsetMs":650000,"requestOffsetMs":650013.8,"responseOffsetMs":650096.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":83,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:50.013Z","respondedAt":"2026-09-28T00:10:50.096Z","requestedManila":"2026-09-28 08:10:50.013","respondedManila":"2026-09-28 08:10:50.096","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":182,"scheduledOffsetMs":651000,"requestOffsetMs":651001.8,"responseOffsetMs":651068.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":6},"durationMs":67,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:51.001Z","respondedAt":"2026-09-28T00:10:51.068Z","requestedManila":"2026-09-28 08:10:51.001","respondedManila":"2026-09-28 08:10:51.068","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":183,"scheduledOffsetMs":652000,"requestOffsetMs":652013.8,"responseOffsetMs":652093.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":7},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:52.013Z","respondedAt":"2026-09-28T00:10:52.093Z","requestedManila":"2026-09-28 08:10:52.013","respondedManila":"2026-09-28 08:10:52.093","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":184,"scheduledOffsetMs":653000,"requestOffsetMs":653012.8,"responseOffsetMs":653087.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":8},"durationMs":75,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:53.012Z","respondedAt":"2026-09-28T00:10:53.087Z","requestedManila":"2026-09-28 08:10:53.012","respondedManila":"2026-09-28 08:10:53.087","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":185,"scheduledOffsetMs":654000,"requestOffsetMs":654009.8,"responseOffsetMs":654090.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":9},"durationMs":81,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:54.009Z","respondedAt":"2026-09-28T00:10:54.090Z","requestedManila":"2026-09-28 08:10:54.009","respondedManila":"2026-09-28 08:10:54.090","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":186,"scheduledOffsetMs":655000,"requestOffsetMs":655009.8,"responseOffsetMs":655084.8,"outcome":"failed","code":"AVAILABILITY_HTTP_FAILED","targetDatePresent":false,"durationMs":75,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:55.009Z","respondedAt":"2026-09-28T00:10:55.084Z","requestedManila":"2026-09-28 08:10:55.009","respondedManila":"2026-09-28 08:10:55.084","responseComplete":false}
{"type":"availability","seq":187,"scheduledOffsetMs":656000,"requestOffsetMs":656005.8,"responseOffsetMs":656093.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":88,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:56.005Z","respondedAt":"2026-09-28T00:10:56.093Z","requestedManila":"2026-09-28 08:10:56.005","respondedManila":"2026-09-28 08:10:56.093","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":188,"scheduledOffsetMs":657000,"requestOffsetMs":657015.8,"responseOffsetMs":657123.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":2},"durationMs":108,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:57.015Z","respondedAt":"2026-09-28T00:10:57.123Z","requestedManila":"2026-09-28 08:10:57.015","respondedManila":"2026-09-28 08:10:57.123","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":189,"scheduledOffsetMs":658000,"requestOffsetMs":658011.8,"responseOffsetMs":658100.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":3},"durationMs":89,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:58.011Z","respondedAt":"2026-09-28T00:10:58.100Z","requestedManila":"2026-09-28 08:10:58.011","respondedManila":"2026-09-28 08:10:58.100","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":190,"scheduledOffsetMs":659000,"requestOffsetMs":659007.8,"responseOffsetMs":659079.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":4},"durationMs":72,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:59.007Z","respondedAt":"2026-09-28T00:10:59.079Z","requestedManila":"2026-09-28 08:10:59.007","respondedManila":"2026-09-28 08:10:59.079","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":191,"scheduledOffsetMs":660000,"requestOffsetMs":660006.8,"responseOffsetMs":660087.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":81,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:11:00.006Z","respondedAt":"2026-09-28T00:11:00.087Z","requestedManila":"2026-09-28 08:11:00.006","respondedManila":"2026-09-28 08:11:00.087","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":192,"scheduledOffsetMs":661000,"requestOffsetMs":661000.8,"responseOffsetMs":661073.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":6},"durationMs":73,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:11:01.000Z","respondedAt":"2026-09-28T00:11:01.073Z","requestedManila":"2026-09-28 08:11:01.000","respondedManila":"2026-09-28 08:11:01.073","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":193,"scheduledOffsetMs":662000,"requestOffsetMs":662007.8,"responseOffsetMs":662088.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":7},"durationMs":81,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:11:02.007Z","respondedAt":"2026-09-28T00:11:02.088Z","requestedManila":"2026-09-28 08:11:02.007","respondedManila":"2026-09-28 08:11:02.088","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":194,"scheduledOffsetMs":663000,"requestOffsetMs":663003.8,"responseOffsetMs":663103.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":8},"durationMs":100,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:11:03.003Z","respondedAt":"2026-09-28T00:11:03.103Z","requestedManila":"2026-09-28 08:11:03.003","respondedManila":"2026-09-28 08:11:03.103","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":195,"scheduledOffsetMs":664000,"requestOffsetMs":664001.8,"responseOffsetMs":664103.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":9},"durationMs":102,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:11:04.001Z","respondedAt":"2026-09-28T00:11:04.103Z","requestedManila":"2026-09-28 08:11:04.001","respondedManila":"2026-09-28 08:11:04.103","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":196,"scheduledOffsetMs":665000,"requestOffsetMs":665004.8,"responseOffsetMs":665073.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":69,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:11:05.004Z","respondedAt":"2026-09-28T00:11:05.073Z","requestedManila":"2026-09-28 08:11:05.004","respondedManila":"2026-09-28 08:11:05.073","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":197,"scheduledOffsetMs":690000,"requestOffsetMs":690010.8,"responseOffsetMs":690198.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":188,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:11:30.010Z","respondedAt":"2026-09-28T00:11:30.198Z","requestedManila":"2026-09-28 08:11:30.010","respondedManila":"2026-09-28 08:11:30.198","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":198,"scheduledOffsetMs":720000,"requestOffsetMs":720014.8,"responseOffsetMs":720184.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":170,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:12:00.014Z","respondedAt":"2026-09-28T00:12:00.184Z","requestedManila":"2026-09-28 08:12:00.014","respondedManila":"2026-09-28 08:12:00.184","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":199,"scheduledOffsetMs":750000,"requestOffsetMs":750011.8,"responseOffsetMs":750179.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":168,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:12:30.011Z","respondedAt":"2026-09-28T00:12:30.179Z","requestedManila":"2026-09-28 08:12:30.011","respondedManila":"2026-09-28 08:12:30.179","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":200,"scheduledOffsetMs":780000,"requestOffsetMs":780014.8,"responseOffsetMs":780178.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOXOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":164,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:13:00.014Z","respondedAt":"2026-09-28T00:13:00.178Z","requestedManila":"2026-09-28 08:13:00.014","respondedManila":"2026-09-28 08:13:00.178","dateFlag":"published","responseComplete":true,"counts":{"OPEN":78,"TAKEN":34,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":201,"scheduledOffsetMs":810000,"requestOffsetMs":810005.8,"responseOffsetMs":810155.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOXXOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":150,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:13:30.005Z","respondedAt":"2026-09-28T00:13:30.155Z","requestedManila":"2026-09-28 08:13:30.005","respondedManila":"2026-09-28 08:13:30.155","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":202,"scheduledOffsetMs":840000,"requestOffsetMs":840011.8,"responseOffsetMs":840176.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOXXOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":165,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:14:00.011Z","respondedAt":"2026-09-28T00:14:00.176Z","requestedManila":"2026-09-28 08:14:00.011","respondedManila":"2026-09-28 08:14:00.176","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":203,"scheduledOffsetMs":870000,"requestOffsetMs":870008.8,"responseOffsetMs":870164.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOXXOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":156,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:14:30.008Z","respondedAt":"2026-09-28T00:14:30.164Z","requestedManila":"2026-09-28 08:14:30.008","respondedManila":"2026-09-28 08:14:30.164","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"bookings","seq":9,"scheduledOffsetMs":900000,"requestOffsetMs":900004.8,"responseOffsetMs":900448.8,"outcome":"ok","failedCourts":[],"cells":["1/19:00","1/20:00","1/21:00","1/22:00","2/19:00","2/20:00","2/21:00","2/22:00","3/19:00","3/20:00","3/21:00","4/19:00","4/20:00","4/21:00","5/19:00","5/20:00","5/21:00","6/19:00","6/20:00","7/18:00","7/19:00"],"durationMs":444,"requestedAt":"2026-09-28T00:15:00.004Z","respondedAt":"2026-09-28T00:15:00.448Z"}
{"type":"availability","seq":204,"scheduledOffsetMs":900000,"requestOffsetMs":900003.8,"responseOffsetMs":900484.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOXXOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":481,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:15:00.003Z","respondedAt":"2026-09-28T00:15:00.484Z","requestedManila":"2026-09-28 08:15:00.003","respondedManila":"2026-09-28 08:15:00.484","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"summary","version":2,"id":"ffe896ed-9c1f-43c7-9ce9-7767b6d12d49","date":"2026-09-30","releaseAt":"2026-09-28T00:00:00.000Z","releaseMs":1790553600000,"startedAt":"2026-09-27T23:35:25.369Z","endedAt":"2026-09-28T00:15:00.513Z","status":"finished","reason":"window complete","clockOffsetMs":34.798095703125,"clockSynced":true,"schedule":{"earlyOffsetsMs":[0,250,500,1000,2000,5000],"maxInFlight":6,"readTimeoutMs":15000,"bookingOffsetsMs":[-60000,2000,10000,30000,60000,120000,300000,600000,900000]},"availability":{"launched":204,"answered":202,"failed":2,"aborted":0,"notLaunched":0,"maxInFlight":2,"medianLatencyMs":87},"bookings":{"launched":9,"answered":9,"failed":0,"aborted":0,"notLaunched":0,"failedCourtQueries":0},"publication":{"lastUnpublished":{"seq":13,"requestOffsetMs":5002.8,"responseOffsetMs":5082.8},"firstPublished":{"seq":14,"requestOffsetMs":6013.8,"responseOffsetMs":6093.8,"cache":{"status":"HIT","ageS":1}},"firstPublishedResponse":{"seq":14,"requestOffsetMs":6013.8,"responseOffsetMs":6093.8}},"firstPublishedMatrix":"1:OOOOOOOOOXXXOXOO,2:OOOOOOOOOOXOXXOO,3:XXXXOOOOOXXXOXXO,4:XXXXOOOOOXXOXOXO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOXO,7:OOOOOOOOOOXOOOOO","firstPublishedCounts":{"OPEN":77,"UNAVAILABLE":35,"UNKNOWN":0},"openToUnavailable":[{"court":1,"hour":"20:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":1,"hour":"22:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":2,"hour":"17:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":2,"hour":"19:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":2,"hour":"22:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":3,"hour":"20:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":4,"hour":"19:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":4,"hour":"21:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":5,"hour":"17:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":5,"hour":"18:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":5,"hour":"22:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":6,"hour":"17:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":6,"hour":"18:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":6,"hour":"21:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":7,"hour":"17:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":4,"requestOffsetMs":30012.8,"responseOffsetMs":30296.8}},{"court":7,"hour":"19:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":4,"requestOffsetMs":30012.8,"responseOffsetMs":30296.8}},{"court":7,"hour":"20:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":4,"requestOffsetMs":30012.8,"responseOffsetMs":30296.8}},{"court":7,"hour":"21:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":4,"requestOffsetMs":30012.8,"responseOffsetMs":30296.8}},{"court":7,"hour":"22:00","before":{"seq":23,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8},"after":{"seq":24,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8},"overlapping":false,"record":{"seq":4,"requestOffsetMs":30012.8,"responseOffsetMs":30296.8}},{"court":4,"hour":"20:00","before":{"seq":75,"requestOffsetMs":95003.8,"responseOffsetMs":95174.8},"after":{"seq":76,"requestOffsetMs":100004.8,"responseOffsetMs":100173.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":5,"hour":"19:00","before":{"seq":75,"requestOffsetMs":95003.8,"responseOffsetMs":95174.8},"after":{"seq":76,"requestOffsetMs":100004.8,"responseOffsetMs":100173.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":5,"hour":"20:00","before":{"seq":75,"requestOffsetMs":95003.8,"responseOffsetMs":95174.8},"after":{"seq":76,"requestOffsetMs":100004.8,"responseOffsetMs":100173.8},"overlapping":false,"record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}},{"court":5,"hour":"21:00","before":{"seq":75,"requestOffsetMs":95003.8,"responseOffsetMs":95174.8},"after":{"seq":76,"requestOffsetMs":100004.8,"responseOffsetMs":100173.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":1,"hour":"21:00","before":{"seq":125,"requestOffsetMs":570002.8,"responseOffsetMs":570197.8},"after":{"seq":126,"requestOffsetMs":595007.8,"responseOffsetMs":595177.8},"overlapping":false,"record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}},{"court":1,"hour":"23:00","before":{"seq":125,"requestOffsetMs":570002.8,"responseOffsetMs":570197.8},"after":{"seq":126,"requestOffsetMs":595007.8,"responseOffsetMs":595177.8},"overlapping":false,"record":null},{"court":2,"hour":"21:00","before":{"seq":125,"requestOffsetMs":570002.8,"responseOffsetMs":570197.8},"after":{"seq":126,"requestOffsetMs":595007.8,"responseOffsetMs":595177.8},"overlapping":false,"record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":2,"hour":"23:00","before":{"seq":125,"requestOffsetMs":570002.8,"responseOffsetMs":570197.8},"after":{"seq":126,"requestOffsetMs":595007.8,"responseOffsetMs":595177.8},"overlapping":false,"record":null},{"court":7,"hour":"18:00","before":{"seq":200,"requestOffsetMs":780014.8,"responseOffsetMs":780178.8},"after":{"seq":201,"requestOffsetMs":810005.8,"responseOffsetMs":810155.8},"overlapping":false,"record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}}],"unavailableAtFirstPublication":[{"court":1,"hour":"17:00","record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}},{"court":1,"hour":"18:00","record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":1,"hour":"19:00","record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}},{"court":1,"hour":"21:00","record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}},{"court":2,"hour":"18:00","record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":2,"hour":"20:00","record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}},{"court":2,"hour":"21:00","record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":3,"hour":"08:00","record":null},{"court":3,"hour":"09:00","record":null},{"court":3,"hour":"10:00","record":null},{"court":3,"hour":"11:00","record":null},{"court":3,"hour":"17:00","record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":3,"hour":"18:00","record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":3,"hour":"19:00","record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}},{"court":3,"hour":"21:00","record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}},{"court":3,"hour":"22:00","record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}},{"court":4,"hour":"08:00","record":null},{"court":4,"hour":"09:00","record":null},{"court":4,"hour":"10:00","record":null},{"court":4,"hour":"11:00","record":null},{"court":4,"hour":"17:00","record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":4,"hour":"18:00","record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}},{"court":4,"hour":"20:00","record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":4,"hour":"22:00","record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}},{"court":5,"hour":"08:00","record":null},{"court":5,"hour":"09:00","record":null},{"court":5,"hour":"10:00","record":null},{"court":5,"hour":"11:00","record":null},{"court":5,"hour":"19:00","record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":5,"hour":"20:00","record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}},{"court":5,"hour":"21:00","record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":6,"hour":"19:00","record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}},{"court":6,"hour":"20:00","record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}},{"court":6,"hour":"22:00","record":{"seq":3,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8}},{"court":7,"hour":"18:00","record":{"seq":2,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8}}],"reopened":[{"court":4,"hour":"19:00","before":{"seq":73,"requestOffsetMs":85016.8,"responseOffsetMs":85185.8},"after":{"seq":74,"requestOffsetMs":90008.8,"responseOffsetMs":90169.8},"overlapping":false},{"court":4,"hour":"20:00","before":{"seq":73,"requestOffsetMs":85016.8,"responseOffsetMs":85185.8},"after":{"seq":74,"requestOffsetMs":90008.8,"responseOffsetMs":90169.8},"overlapping":false},{"court":4,"hour":"21:00","before":{"seq":73,"requestOffsetMs":85016.8,"responseOffsetMs":85185.8},"after":{"seq":74,"requestOffsetMs":90008.8,"responseOffsetMs":90169.8},"overlapping":false},{"court":5,"hour":"19:00","before":{"seq":73,"requestOffsetMs":85016.8,"responseOffsetMs":85185.8},"after":{"seq":74,"requestOffsetMs":90008.8,"responseOffsetMs":90169.8},"overlapping":false},{"court":5,"hour":"20:00","before":{"seq":73,"requestOffsetMs":85016.8,"responseOffsetMs":85185.8},"after":{"seq":74,"requestOffsetMs":90008.8,"responseOffsetMs":90169.8},"overlapping":false},{"court":5,"hour":"21:00","before":{"seq":73,"requestOffsetMs":85016.8,"responseOffsetMs":85185.8},"after":{"seq":74,"requestOffsetMs":90008.8,"responseOffsetMs":90169.8},"overlapping":false},{"court":1,"hour":"21:00","before":{"seq":117,"requestOffsetMs":330015.8,"responseOffsetMs":330184.8},"after":{"seq":118,"requestOffsetMs":360006.8,"responseOffsetMs":360162.8},"overlapping":false},{"court":1,"hour":"22:00","before":{"seq":117,"requestOffsetMs":330015.8,"responseOffsetMs":330184.8},"after":{"seq":118,"requestOffsetMs":360006.8,"responseOffsetMs":360162.8},"overlapping":false},{"court":2,"hour":"21:00","before":{"seq":117,"requestOffsetMs":330015.8,"responseOffsetMs":330184.8},"after":{"seq":118,"requestOffsetMs":360006.8,"responseOffsetMs":360162.8},"overlapping":false},{"court":2,"hour":"22:00","before":{"seq":117,"requestOffsetMs":330015.8,"responseOffsetMs":330184.8},"after":{"seq":118,"requestOffsetMs":360006.8,"responseOffsetMs":360162.8},"overlapping":false},{"court":6,"hour":"21:00","before":{"seq":117,"requestOffsetMs":330015.8,"responseOffsetMs":330184.8},"after":{"seq":118,"requestOffsetMs":360006.8,"responseOffsetMs":360162.8},"overlapping":false},{"court":6,"hour":"22:00","before":{"seq":117,"requestOffsetMs":330015.8,"responseOffsetMs":330184.8},"after":{"seq":118,"requestOffsetMs":360006.8,"responseOffsetMs":360162.8},"overlapping":false},{"court":7,"hour":"22:00","before":{"seq":117,"requestOffsetMs":330015.8,"responseOffsetMs":330184.8},"after":{"seq":118,"requestOffsetMs":360006.8,"responseOffsetMs":360162.8},"overlapping":false},{"court":1,"hour":"17:00","before":{"seq":122,"requestOffsetMs":480002.8,"responseOffsetMs":480179.8},"after":{"seq":123,"requestOffsetMs":510013.8,"responseOffsetMs":510206.8},"overlapping":false},{"court":1,"hour":"18:00","before":{"seq":122,"requestOffsetMs":480002.8,"responseOffsetMs":480179.8},"after":{"seq":123,"requestOffsetMs":510013.8,"responseOffsetMs":510206.8},"overlapping":false},{"court":2,"hour":"17:00","before":{"seq":122,"requestOffsetMs":480002.8,"responseOffsetMs":480179.8},"after":{"seq":123,"requestOffsetMs":510013.8,"responseOffsetMs":510206.8},"overlapping":false},{"court":2,"hour":"18:00","before":{"seq":122,"requestOffsetMs":480002.8,"responseOffsetMs":480179.8},"after":{"seq":123,"requestOffsetMs":510013.8,"responseOffsetMs":510206.8},"overlapping":false},{"court":2,"hour":"19:00","before":{"seq":136,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8},"after":{"seq":137,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8},"overlapping":false},{"court":3,"hour":"17:00","before":{"seq":136,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8},"after":{"seq":137,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8},"overlapping":false},{"court":3,"hour":"18:00","before":{"seq":136,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8},"after":{"seq":137,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8},"overlapping":false},{"court":3,"hour":"22:00","before":{"seq":136,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8},"after":{"seq":137,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8},"overlapping":false},{"court":4,"hour":"17:00","before":{"seq":136,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8},"after":{"seq":137,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8},"overlapping":false},{"court":4,"hour":"18:00","before":{"seq":136,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8},"after":{"seq":137,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8},"overlapping":false},{"court":4,"hour":"22:00","before":{"seq":136,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8},"after":{"seq":137,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8},"overlapping":false},{"court":5,"hour":"22:00","before":{"seq":136,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8},"after":{"seq":137,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8},"overlapping":false},{"court":6,"hour":"17:00","before":{"seq":136,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8},"after":{"seq":137,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8},"overlapping":false},{"court":6,"hour":"18:00","before":{"seq":136,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8},"after":{"seq":137,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8},"overlapping":false},{"court":7,"hour":"17:00","before":{"seq":136,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8},"after":{"seq":137,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8},"overlapping":false},{"court":7,"hour":"18:00","before":{"seq":136,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8},"after":{"seq":137,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8},"overlapping":false},{"court":7,"hour":"19:00","before":{"seq":136,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8},"after":{"seq":137,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8},"overlapping":false},{"court":7,"hour":"20:00","before":{"seq":136,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8},"after":{"seq":137,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8},"overlapping":false},{"court":7,"hour":"21:00","before":{"seq":136,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8},"after":{"seq":137,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8},"overlapping":false},{"court":5,"hour":"17:00","before":{"seq":146,"requestOffsetMs":615000.8,"responseOffsetMs":615065.8},"after":{"seq":147,"requestOffsetMs":616002.8,"responseOffsetMs":616067.8},"overlapping":false},{"court":5,"hour":"18:00","before":{"seq":146,"requestOffsetMs":615000.8,"responseOffsetMs":615065.8},"after":{"seq":147,"requestOffsetMs":616002.8,"responseOffsetMs":616067.8},"overlapping":false}],"current":{"seq":204,"requestOffsetMs":900003.8,"responseOffsetMs":900484.8},"finalMatrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOXXOOOO","stillOpen":77,"logPath":"[REDACTED_LOCAL_PATH]\\Downloads\\Thirsty Pickle Bot\\.local\\slot-watch\\2026-09-30_ffe896ed-9c1f-43c7-9ce9-7767b6d12d49.ndjson","reportPath":"[REDACTED_LOCAL_PATH]\\Downloads\\Thirsty Pickle Bot\\.local\\slot-watch\\2026-09-30_ffe896ed-9c1f-43c7-9ce9-7767b6d12d49.txt"}
```

## 2. Release forensics summary

Source: `.local/release-forensics/e3f7de87-d1d5-4949-9ddc-4cc49529cfa7/summary.json`.

```json
{
  "version": 1,
  "runId": "e3f7de87-d1d5-4949-9ddc-4cc49529cfa7",
  "mode": "live",
  "date": "2026-09-30",
  "reference": "release",
  "referenceMs": 1790553600000,
  "status": "final",
  "generatedAt": "2026-09-28T00:15:00.561Z",
  "sources": {
    "runProgress": "[REDACTED_LOCAL_PATH]\\Downloads\\Thirsty Pickle Bot\\.local\\api-booking\\run-progress\\e3f7de87-d1d5-4949-9ddc-4cc49529cfa7.ndjson",
    "observer": "[REDACTED_LOCAL_PATH]\\Downloads\\Thirsty Pickle Bot\\.local\\slot-watch\\2026-09-30_ffe896ed-9c1f-43c7-9ce9-7767b6d12d49.ndjson",
    "observerVersion": 2,
    "providerTrace": "[REDACTED_LOCAL_PATH]\\Downloads\\Thirsty Pickle Bot\\.local\\release-forensics\\e3f7de87-d1d5-4949-9ddc-4cc49529cfa7\\provider-trace.ndjson"
  },
  "clock": {
    "rounds": [
      {
        "checkpoint": "T-10M",
        "offsetMs": 35,
        "roundTripMs": 43,
        "sampleCount": 10,
        "spreadMs": 17.3,
        "uncertaintyMs": 21.9,
        "deltaMs": 12,
        "adopted": true
      },
      {
        "checkpoint": "T-60S",
        "offsetMs": 39.8,
        "roundTripMs": 42,
        "sampleCount": 10,
        "spreadMs": 8.9,
        "uncertaintyMs": 21.3,
        "deltaMs": 5,
        "adopted": true
      },
      {
        "checkpoint": "T-30S",
        "offsetMs": 39,
        "roundTripMs": 43,
        "sampleCount": 10,
        "spreadMs": 3.5,
        "uncertaintyMs": 21.9,
        "deltaMs": -0.8,
        "adopted": true
      }
    ],
    "dispatchOffsetMs": 39,
    "observerOffsetMs": 34.8,
    "observerMinusDispatchMs": -4.2
  },
  "dispatch": {
    "posts": 7,
    "firstPostOffsetMs": -45.8,
    "lastPostOffsetMs": 8.6,
    "spreadMs": 54.4
  },
  "outcome": "ALL_REJECTED_WAITING_FOR_REOPEN",
  "observer": {
    "publication": {
      "lastUnpublished": {
        "seq": 13,
        "requestOffsetMs": 5002.8,
        "responseOffsetMs": 5082.8
      },
      "firstPublished": {
        "seq": 14,
        "requestOffsetMs": 6013.8,
        "responseOffsetMs": 6093.8,
        "cache": {
          "status": "HIT",
          "ageS": 1
        }
      },
      "firstPublishedResponse": {
        "seq": 14,
        "requestOffsetMs": 6013.8,
        "responseOffsetMs": 6093.8
      }
    },
    "firstPublishedMatrix": "1:OOOOOOOOOXXXOXOO,2:OOOOOOOOOOXOXXOO,3:XXXXOOOOOXXXOXXO,4:XXXXOOOOOXXOXOXO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOXO,7:OOOOOOOOOOXOOOOO",
    "firstPublishedCounts": {
      "OPEN": 77,
      "UNAVAILABLE": 35,
      "UNKNOWN": 0
    },
    "reads": {
      "launched": 204,
      "answered": 202,
      "failed": 2,
      "notLaunched": 0,
      "maxInFlight": 6,
      "earlyOffsetsMs": [
        0,
        250,
        500,
        1000,
        2000,
        5000
      ]
    },
    "bookingReads": {
      "answered": 9,
      "failed": 0,
      "failedCourtQueries": 0,
      "itemized": true
    },
    "openToUnavailable": 28,
    "reopened": 34,
    "unavailableWithoutRecordAtFirstPublication": 12
  },
  "trace": {
    "available": true,
    "records": 7,
    "complete": 7,
    "unavailableWorkers": []
  },
  "phase3": {
    "fingerprint": "[REDACTED]",
    "candidateCount": 10,
    "maxWave2": 0,
    "maxRescue": 1,
    "maxTotal": 8,
    "attempts": [
      {
        "attemptId": "core-C-official-3",
        "candidateId": "0aafa30e010464e6b8a17e61980df60fbbbfb769640964ed4af67b15f6b6a09d",
        "workerId": "C",
        "wave": "WAVE_1",
        "court": 5,
        "startTime": "19:00",
        "endTime": "22:00",
        "evidenceSeq": null,
        "selectedEvidenceSeq": null,
        "postOffsetMs": -45.8,
        "state": "REJECTED",
        "statusCode": 409,
        "providerTrace": true,
        "fallback": {
          "type": "response-fallback",
          "workerId": "C",
          "attemptId": "core-C-official-3",
          "candidateId": "0aafa30e010464e6b8a17e61980df60fbbbfb769640964ed4af67b15f6b6a09d",
          "wave": "WAVE_1",
          "status": 409,
          "contentType": "application/json",
          "server": "Vercel",
          "cfRay": null,
          "vercelId": "sin1::sin1::5hqz4-1790553599977-373e7e3a40f2",
          "requestId": null,
          "serverTiming": null,
          "responseReceivedMs": 10373.5,
          "responseCompletedMs": 10373.7,
          "evidence": {
            "version": 1,
            "status": 409,
            "headers": {
              "content-type": "application/json",
              "server": "Vercel",
              "date": "Mon, 28 Sep 2026 00:00:10 GMT",
              "cache-control": "public, max-age=0, must-revalidate",
              "x-vercel-id": "sin1::sin1::5hqz4-1790553599977-373e7e3a40f2",
              "x-vercel-cache": "MISS",
              "x-matched-path": "/api/bookings/public-checkout"
            },
            "vercel": {
              "regions": [
                "sin1",
                "sin1"
              ],
              "edgeRegion": "sin1",
              "functionRegion": "sin1",
              "embeddedMs": 1790553599977,
              "embeddedInterpretation": "UNDOCUMENTED"
            },
            "serverDateMs": 1790553610000,
            "serverTiming": null,
            "body": {
              "version": 1,
              "byteLength": 100,
              "contentKind": "json",
              "jsonType": "object",
              "shape": [
                {
                  "path": "$",
                  "type": "object"
                },
                {
                  "path": "error",
                  "type": "string",
                  "length": 72
                },
                {
                  "path": "success",
                  "type": "boolean"
                }
              ],
              "fields": {
                "success": false,
                "error": "This booking slot is no longer available (overlaps an existing booking)."
              },
              "shapeFingerprint": "[REDACTED]",
              "sanitizedFingerprint": "[REDACTED]"
            }
          }
        }
      },
      {
        "attemptId": "core-B-official-2",
        "candidateId": "9cf2c3872f8c8c5e6867a9211f3fc9e91f9903a7451380bb72b0b187da0f0fcf",
        "workerId": "B",
        "wave": "WAVE_1",
        "court": 6,
        "startTime": "19:00",
        "endTime": "22:00",
        "evidenceSeq": null,
        "selectedEvidenceSeq": null,
        "postOffsetMs": -21.2,
        "state": "REJECTED",
        "statusCode": 409,
        "providerTrace": true,
        "fallback": {
          "type": "response-fallback",
          "workerId": "B",
          "attemptId": "core-B-official-2",
          "candidateId": "9cf2c3872f8c8c5e6867a9211f3fc9e91f9903a7451380bb72b0b187da0f0fcf",
          "wave": "WAVE_1",
          "status": 409,
          "contentType": "application/json",
          "server": "Vercel",
          "cfRay": null,
          "vercelId": "sin1::sin1::4vphp-1790553600005-eea3d5a81e4f",
          "requestId": null,
          "serverTiming": null,
          "responseReceivedMs": 8083.3,
          "responseCompletedMs": 8083.7,
          "evidence": {
            "version": 1,
            "status": 409,
            "headers": {
              "content-type": "application/json",
              "server": "Vercel",
              "date": "Mon, 28 Sep 2026 00:00:08 GMT",
              "cache-control": "public, max-age=0, must-revalidate",
              "x-vercel-id": "sin1::sin1::4vphp-1790553600005-eea3d5a81e4f",
              "x-vercel-cache": "MISS",
              "x-matched-path": "/api/bookings/public-checkout"
            },
            "vercel": {
              "regions": [
                "sin1",
                "sin1"
              ],
              "edgeRegion": "sin1",
              "functionRegion": "sin1",
              "embeddedMs": 1790553600005,
              "embeddedInterpretation": "UNDOCUMENTED"
            },
            "serverDateMs": 1790553608000,
            "serverTiming": null,
            "body": {
              "version": 1,
              "byteLength": 100,
              "contentKind": "json",
              "jsonType": "object",
              "shape": [
                {
                  "path": "$",
                  "type": "object"
                },
                {
                  "path": "error",
                  "type": "string",
                  "length": 72
                },
                {
                  "path": "success",
                  "type": "boolean"
                }
              ],
              "fields": {
                "success": false,
                "error": "This booking slot is no longer available (overlaps an existing booking)."
              },
              "shapeFingerprint": "[REDACTED]",
              "sanitizedFingerprint": "[REDACTED]"
            }
          }
        }
      },
      {
        "attemptId": "core-A-official-1",
        "candidateId": "85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032",
        "workerId": "A",
        "wave": "WAVE_1",
        "court": 7,
        "startTime": "19:00",
        "endTime": "22:00",
        "evidenceSeq": null,
        "selectedEvidenceSeq": null,
        "postOffsetMs": -6.2,
        "state": "REJECTED",
        "statusCode": 409,
        "providerTrace": true,
        "fallback": {
          "type": "response-fallback",
          "workerId": "A",
          "attemptId": "core-A-official-1",
          "candidateId": "85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032",
          "wave": "WAVE_1",
          "status": 409,
          "contentType": "application/json",
          "server": "Vercel",
          "cfRay": null,
          "vercelId": "sin1::sin1::xmblb-1790553600017-a8cface69893",
          "requestId": null,
          "serverTiming": null,
          "responseReceivedMs": 10585.1,
          "responseCompletedMs": 10585.3,
          "evidence": {
            "version": 1,
            "status": 409,
            "headers": {
              "content-type": "application/json",
              "server": "Vercel",
              "date": "Mon, 28 Sep 2026 00:00:10 GMT",
              "cache-control": "public, max-age=0, must-revalidate",
              "x-vercel-id": "sin1::sin1::xmblb-1790553600017-a8cface69893",
              "x-vercel-cache": "MISS",
              "x-matched-path": "/api/bookings/public-checkout"
            },
            "vercel": {
              "regions": [
                "sin1",
                "sin1"
              ],
              "edgeRegion": "sin1",
              "functionRegion": "sin1",
              "embeddedMs": 1790553600017,
              "embeddedInterpretation": "UNDOCUMENTED"
            },
            "serverDateMs": 1790553610000,
            "serverTiming": null,
            "body": {
              "version": 1,
              "byteLength": 100,
              "contentKind": "json",
              "jsonType": "object",
              "shape": [
                {
                  "path": "$",
                  "type": "object"
                },
                {
                  "path": "error",
                  "type": "string",
                  "length": 72
                },
                {
                  "path": "success",
                  "type": "boolean"
                }
              ],
              "fields": {
                "success": false,
                "error": "This booking slot is no longer available (overlaps an existing booking)."
              },
              "shapeFingerprint": "[REDACTED]",
              "sanitizedFingerprint": "[REDACTED]"
            }
          }
        }
      },
      {
        "attemptId": "core-D-official-4",
        "candidateId": "5dfb38082fe0d4977a10e38c4c9206b64a97e97ea8034aa93f6a7fd699d6b59a",
        "workerId": "D",
        "wave": "WAVE_1",
        "court": 4,
        "startTime": "19:00",
        "endTime": "22:00",
        "evidenceSeq": null,
        "selectedEvidenceSeq": null,
        "postOffsetMs": -1,
        "state": "REJECTED",
        "statusCode": 409,
        "providerTrace": true,
        "fallback": {
          "type": "response-fallback",
          "workerId": "D",
          "attemptId": "core-D-official-4",
          "candidateId": "5dfb38082fe0d4977a10e38c4c9206b64a97e97ea8034aa93f6a7fd699d6b59a",
          "wave": "WAVE_1",
          "status": 409,
          "contentType": "application/json",
          "server": "Vercel",
          "cfRay": null,
          "vercelId": "sin1::sin1::t7sc7-1790553600025-c8c3f7635381",
          "requestId": null,
          "serverTiming": null,
          "responseReceivedMs": 12089.6,
          "responseCompletedMs": 12089.8,
          "evidence": {
            "version": 1,
            "status": 409,
            "headers": {
              "content-type": "application/json",
              "server": "Vercel",
              "date": "Mon, 28 Sep 2026 00:00:12 GMT",
              "cache-control": "public, max-age=0, must-revalidate",
              "x-vercel-id": "sin1::sin1::t7sc7-1790553600025-c8c3f7635381",
              "x-vercel-cache": "MISS",
              "x-matched-path": "/api/bookings/public-checkout"
            },
            "vercel": {
              "regions": [
                "sin1",
                "sin1"
              ],
              "edgeRegion": "sin1",
              "functionRegion": "sin1",
              "embeddedMs": 1790553600025,
              "embeddedInterpretation": "UNDOCUMENTED"
            },
            "serverDateMs": 1790553612000,
            "serverTiming": null,
            "body": {
              "version": 1,
              "byteLength": 100,
              "contentKind": "json",
              "jsonType": "object",
              "shape": [
                {
                  "path": "$",
                  "type": "object"
                },
                {
                  "path": "error",
                  "type": "string",
                  "length": 72
                },
                {
                  "path": "success",
                  "type": "boolean"
                }
              ],
              "fields": {
                "success": false,
                "error": "This booking slot is no longer available (overlaps an existing booking)."
              },
              "shapeFingerprint": "[REDACTED]",
              "sanitizedFingerprint": "[REDACTED]"
            }
          }
        }
      },
      {
        "attemptId": "core-G-official-7",
        "candidateId": "5caf181e63715dbd31129a673fe1b463ba7602d79cf8d96902831f4196b3baeb",
        "workerId": "G",
        "wave": "WAVE_1",
        "court": 1,
        "startTime": "19:00",
        "endTime": "22:00",
        "evidenceSeq": null,
        "selectedEvidenceSeq": null,
        "postOffsetMs": 8,
        "state": "REJECTED",
        "statusCode": 409,
        "providerTrace": true,
        "fallback": {
          "type": "response-fallback",
          "workerId": "G",
          "attemptId": "core-G-official-7",
          "candidateId": "5caf181e63715dbd31129a673fe1b463ba7602d79cf8d96902831f4196b3baeb",
          "wave": "WAVE_1",
          "status": 409,
          "contentType": "application/json",
          "server": "Vercel",
          "cfRay": null,
          "vercelId": "sin1::sin1::r6dd5-1790553600031-5bbbebb72c64",
          "requestId": null,
          "serverTiming": null,
          "responseReceivedMs": 12103.7,
          "responseCompletedMs": 12103.9,
          "evidence": {
            "version": 1,
            "status": 409,
            "headers": {
              "content-type": "application/json",
              "server": "Vercel",
              "date": "Mon, 28 Sep 2026 00:00:12 GMT",
              "cache-control": "public, max-age=0, must-revalidate",
              "x-vercel-id": "sin1::sin1::r6dd5-1790553600031-5bbbebb72c64",
              "x-vercel-cache": "MISS",
              "x-matched-path": "/api/bookings/public-checkout"
            },
            "vercel": {
              "regions": [
                "sin1",
                "sin1"
              ],
              "edgeRegion": "sin1",
              "functionRegion": "sin1",
              "embeddedMs": 1790553600031,
              "embeddedInterpretation": "UNDOCUMENTED"
            },
            "serverDateMs": 1790553612000,
            "serverTiming": null,
            "body": {
              "version": 1,
              "byteLength": 100,
              "contentKind": "json",
              "jsonType": "object",
              "shape": [
                {
                  "path": "$",
                  "type": "object"
                },
                {
                  "path": "error",
                  "type": "string",
                  "length": 72
                },
                {
                  "path": "success",
                  "type": "boolean"
                }
              ],
              "fields": {
                "success": false,
                "error": "This booking slot is no longer available (overlaps an existing booking)."
              },
              "shapeFingerprint": "[REDACTED]",
              "sanitizedFingerprint": "[REDACTED]"
            }
          }
        }
      },
      {
        "attemptId": "core-E-official-5",
        "candidateId": "5589eb0cb6e51ddb891ffe17f5b7b8d0a3acbbd46ee68a9d8fe68832504154c3",
        "workerId": "E",
        "wave": "WAVE_1",
        "court": 3,
        "startTime": "19:00",
        "endTime": "22:00",
        "evidenceSeq": null,
        "selectedEvidenceSeq": null,
        "postOffsetMs": 8.5,
        "state": "REJECTED",
        "statusCode": 409,
        "providerTrace": true,
        "fallback": {
          "type": "response-fallback",
          "workerId": "E",
          "attemptId": "core-E-official-5",
          "candidateId": "5589eb0cb6e51ddb891ffe17f5b7b8d0a3acbbd46ee68a9d8fe68832504154c3",
          "wave": "WAVE_1",
          "status": 409,
          "contentType": "application/json",
          "server": "Vercel",
          "cfRay": null,
          "vercelId": "sin1::sin1::gsvmw-1790553600027-aa378ac9fbd4",
          "requestId": null,
          "serverTiming": null,
          "responseReceivedMs": 9841.1,
          "responseCompletedMs": 9841.5,
          "evidence": {
            "version": 1,
            "status": 409,
            "headers": {
              "content-type": "application/json",
              "server": "Vercel",
              "date": "Mon, 28 Sep 2026 00:00:09 GMT",
              "cache-control": "public, max-age=0, must-revalidate",
              "x-vercel-id": "sin1::sin1::gsvmw-1790553600027-aa378ac9fbd4",
              "x-vercel-cache": "MISS",
              "x-matched-path": "/api/bookings/public-checkout"
            },
            "vercel": {
              "regions": [
                "sin1",
                "sin1"
              ],
              "edgeRegion": "sin1",
              "functionRegion": "sin1",
              "embeddedMs": 1790553600027,
              "embeddedInterpretation": "UNDOCUMENTED"
            },
            "serverDateMs": 1790553609000,
            "serverTiming": null,
            "body": {
              "version": 1,
              "byteLength": 100,
              "contentKind": "json",
              "jsonType": "object",
              "shape": [
                {
                  "path": "$",
                  "type": "object"
                },
                {
                  "path": "error",
                  "type": "string",
                  "length": 72
                },
                {
                  "path": "success",
                  "type": "boolean"
                }
              ],
              "fields": {
                "success": false,
                "error": "This booking slot is no longer available (overlaps an existing booking)."
              },
              "shapeFingerprint": "[REDACTED]",
              "sanitizedFingerprint": "[REDACTED]"
            }
          }
        }
      },
      {
        "attemptId": "core-F-official-6",
        "candidateId": "9a0e7b37cb7df37170afa84d5efeb1706016659f468b2baa5f237296291e991c",
        "workerId": "F",
        "wave": "WAVE_1",
        "court": 2,
        "startTime": "19:00",
        "endTime": "22:00",
        "evidenceSeq": null,
        "selectedEvidenceSeq": null,
        "postOffsetMs": 8.6,
        "state": "REJECTED",
        "statusCode": 409,
        "providerTrace": true,
        "fallback": {
          "type": "response-fallback",
          "workerId": "F",
          "attemptId": "core-F-official-6",
          "candidateId": "9a0e7b37cb7df37170afa84d5efeb1706016659f468b2baa5f237296291e991c",
          "wave": "WAVE_1",
          "status": 409,
          "contentType": "application/json",
          "server": "Vercel",
          "cfRay": null,
          "vercelId": "sin1::sin1::vwkmg-1790553600030-e06a61aa6615",
          "requestId": null,
          "serverTiming": null,
          "responseReceivedMs": 10421.7,
          "responseCompletedMs": 10421.8,
          "evidence": {
            "version": 1,
            "status": 409,
            "headers": {
              "content-type": "application/json",
              "server": "Vercel",
              "date": "Mon, 28 Sep 2026 00:00:10 GMT",
              "cache-control": "public, max-age=0, must-revalidate",
              "x-vercel-id": "sin1::sin1::vwkmg-1790553600030-e06a61aa6615",
              "x-vercel-cache": "MISS",
              "x-matched-path": "/api/bookings/public-checkout"
            },
            "vercel": {
              "regions": [
                "sin1",
                "sin1"
              ],
              "edgeRegion": "sin1",
              "functionRegion": "sin1",
              "embeddedMs": 1790553600030,
              "embeddedInterpretation": "UNDOCUMENTED"
            },
            "serverDateMs": 1790553610000,
            "serverTiming": null,
            "body": {
              "version": 1,
              "byteLength": 100,
              "contentKind": "json",
              "jsonType": "object",
              "shape": [
                {
                  "path": "$",
                  "type": "object"
                },
                {
                  "path": "error",
                  "type": "string",
                  "length": 72
                },
                {
                  "path": "success",
                  "type": "boolean"
                }
              ],
              "fields": {
                "success": false,
                "error": "This booking slot is no longer available (overlaps an existing booking)."
              },
              "shapeFingerprint": "[REDACTED]",
              "sanitizedFingerprint": "[REDACTED]"
            }
          }
        }
      }
    ]
  },
  "targets": [
    {
      "workerId": "A",
      "court": 7,
      "startTime": "19:00",
      "endTime": "22:00",
      "attemptId": "core-A-official-1",
      "finalState": null,
      "finalCode": null,
      "post": {
        "offsetMs": -6.2,
        "source": "run-trace"
      },
      "response": {
        "statusCode": 409,
        "errorHint": "availability",
        "responseSource": "application",
        "completedOffsetMs": 10578.8,
        "networkDurationMs": 10588
      },
      "grid": {
        "hours": [
          "19:00",
          "20:00",
          "21:00"
        ],
        "firstPublished": {
          "observation": {
            "seq": 14,
            "requestOffsetMs": 6013.8,
            "responseOffsetMs": 6093.8
          },
          "state": "FULLY_OPEN",
          "hours": [
            {
              "hour": "19:00",
              "state": "OPEN",
              "price": 700
            },
            {
              "hour": "20:00",
              "state": "OPEN",
              "price": 700
            },
            {
              "hour": "21:00",
              "state": "OPEN",
              "price": 700
            }
          ]
        },
        "firstFullyOpen": {
          "seq": 14,
          "requestOffsetMs": 6013.8,
          "responseOffsetMs": 6093.8
        },
        "firstUnavailable": {
          "observation": {
            "seq": 24,
            "requestOffsetMs": 16009.8,
            "responseOffsetMs": 16098.8
          },
          "hours": [
            "19:00",
            "20:00",
            "21:00"
          ]
        },
        "firstRecord": {
          "observation": {
            "seq": 4,
            "requestOffsetMs": 30012.8,
            "responseOffsetMs": 30296.8
          },
          "hours": [
            "19:00",
            "20:00",
            "21:00"
          ]
        },
        "reopen": {
          "before": {
            "seq": 136,
            "requestOffsetMs": 605002.8,
            "responseOffsetMs": 605089.8
          },
          "after": {
            "seq": 137,
            "requestOffsetMs": 606014.8,
            "responseOffsetMs": 606090.8
          },
          "overlapping": false
        },
        "latest": {
          "observation": {
            "seq": 204,
            "requestOffsetMs": 900003.8,
            "responseOffsetMs": 900484.8
          },
          "state": "PARTIALLY_UNAVAILABLE"
        }
      },
      "provider": {
        "complete": true,
        "protocol": "h2",
        "reused": true,
        "headersOffsetMs": 10576.5,
        "bodyOffsetMs": 10576.9,
        "timingSource": "browser",
        "dnsMs": null,
        "connectMs": null,
        "tlsMs": null,
        "sendMs": 0.2,
        "waitMs": 10581.9,
        "server": "Vercel",
        "cfRay": null,
        "cfMitigated": null,
        "vercelId": "sin1::sin1::xmblb-1790553600017-a8cface69893",
        "requestId": null,
        "vercelCache": "MISS",
        "ageS": null,
        "serverTiming": null,
        "failure": null
      }
    },
    {
      "workerId": "B",
      "court": 6,
      "startTime": "19:00",
      "endTime": "22:00",
      "attemptId": "core-B-official-2",
      "finalState": null,
      "finalCode": null,
      "post": {
        "offsetMs": -21.2,
        "source": "run-trace"
      },
      "response": {
        "statusCode": 409,
        "errorHint": "availability",
        "responseSource": "application",
        "completedOffsetMs": 8065.8,
        "networkDurationMs": 8089
      },
      "grid": {
        "hours": [
          "19:00",
          "20:00",
          "21:00"
        ],
        "firstPublished": {
          "observation": {
            "seq": 14,
            "requestOffsetMs": 6013.8,
            "responseOffsetMs": 6093.8
          },
          "state": "PARTIALLY_UNAVAILABLE",
          "hours": [
            {
              "hour": "19:00",
              "state": "UNAVAILABLE",
              "price": 700
            },
            {
              "hour": "20:00",
              "state": "UNAVAILABLE",
              "price": 700
            },
            {
              "hour": "21:00",
              "state": "OPEN",
              "price": 700
            }
          ]
        },
        "firstFullyOpen": null,
        "firstUnavailable": {
          "observation": {
            "seq": 14,
            "requestOffsetMs": 6013.8,
            "responseOffsetMs": 6093.8
          },
          "hours": [
            "19:00",
            "20:00"
          ]
        },
        "firstRecord": {
          "observation": {
            "seq": 2,
            "requestOffsetMs": 2013.8,
            "responseOffsetMs": 2844.8
          },
          "hours": [
            "19:00",
            "20:00"
          ]
        },
        "reopen": null,
        "latest": {
          "observation": {
            "seq": 204,
            "requestOffsetMs": 900003.8,
            "responseOffsetMs": 900484.8
          },
          "state": "PARTIALLY_UNAVAILABLE"
        }
      },
      "provider": {
        "complete": true,
        "protocol": "h2",
        "reused": true,
        "headersOffsetMs": 8057.7,
        "bodyOffsetMs": 8059.1,
        "timingSource": "browser",
        "dnsMs": null,
        "connectMs": null,
        "tlsMs": null,
        "sendMs": 0.2,
        "waitMs": 8078.2,
        "server": "Vercel",
        "cfRay": null,
        "cfMitigated": null,
        "vercelId": "sin1::sin1::4vphp-1790553600005-eea3d5a81e4f",
        "requestId": null,
        "vercelCache": "MISS",
        "ageS": null,
        "serverTiming": null,
        "failure": null
      }
    },
    {
      "workerId": "C",
      "court": 5,
      "startTime": "19:00",
      "endTime": "22:00",
      "attemptId": "core-C-official-3",
      "finalState": null,
      "finalCode": null,
      "post": {
        "offsetMs": -45.8,
        "source": "run-trace"
      },
      "response": {
        "statusCode": 409,
        "errorHint": "availability",
        "responseSource": "application",
        "completedOffsetMs": 10328.2,
        "networkDurationMs": 10377
      },
      "grid": {
        "hours": [
          "19:00",
          "20:00",
          "21:00"
        ],
        "firstPublished": {
          "observation": {
            "seq": 14,
            "requestOffsetMs": 6013.8,
            "responseOffsetMs": 6093.8
          },
          "state": "FULLY_UNAVAILABLE",
          "hours": [
            {
              "hour": "19:00",
              "state": "UNAVAILABLE",
              "price": 700
            },
            {
              "hour": "20:00",
              "state": "UNAVAILABLE",
              "price": 700
            },
            {
              "hour": "21:00",
              "state": "UNAVAILABLE",
              "price": 700
            }
          ]
        },
        "firstFullyOpen": {
          "seq": 74,
          "requestOffsetMs": 90008.8,
          "responseOffsetMs": 90169.8
        },
        "firstUnavailable": {
          "observation": {
            "seq": 14,
            "requestOffsetMs": 6013.8,
            "responseOffsetMs": 6093.8
          },
          "hours": [
            "19:00",
            "20:00",
            "21:00"
          ]
        },
        "firstRecord": {
          "observation": {
            "seq": 2,
            "requestOffsetMs": 2013.8,
            "responseOffsetMs": 2844.8
          },
          "hours": [
            "20:00"
          ]
        },
        "reopen": {
          "before": {
            "seq": 73,
            "requestOffsetMs": 85016.8,
            "responseOffsetMs": 85185.8
          },
          "after": {
            "seq": 74,
            "requestOffsetMs": 90008.8,
            "responseOffsetMs": 90169.8
          },
          "overlapping": false
        },
        "latest": {
          "observation": {
            "seq": 204,
            "requestOffsetMs": 900003.8,
            "responseOffsetMs": 900484.8
          },
          "state": "FULLY_UNAVAILABLE"
        }
      },
      "provider": {
        "complete": true,
        "protocol": "h2",
        "reused": true,
        "headersOffsetMs": 10325.6,
        "bodyOffsetMs": 10326.1,
        "timingSource": "browser",
        "dnsMs": null,
        "connectMs": null,
        "tlsMs": null,
        "sendMs": 0.2,
        "waitMs": 10370.9,
        "server": "Vercel",
        "cfRay": null,
        "cfMitigated": null,
        "vercelId": "sin1::sin1::5hqz4-1790553599977-373e7e3a40f2",
        "requestId": null,
        "vercelCache": "MISS",
        "ageS": null,
        "serverTiming": null,
        "failure": null
      }
    },
    {
      "workerId": "D",
      "court": 4,
      "startTime": "19:00",
      "endTime": "22:00",
      "attemptId": "core-D-official-4",
      "finalState": null,
      "finalCode": null,
      "post": {
        "offsetMs": -1,
        "source": "run-trace"
      },
      "response": {
        "statusCode": 409,
        "errorHint": "availability",
        "responseSource": "application",
        "completedOffsetMs": 12088,
        "networkDurationMs": 12093
      },
      "grid": {
        "hours": [
          "19:00",
          "20:00",
          "21:00"
        ],
        "firstPublished": {
          "observation": {
            "seq": 14,
            "requestOffsetMs": 6013.8,
            "responseOffsetMs": 6093.8
          },
          "state": "PARTIALLY_UNAVAILABLE",
          "hours": [
            {
              "hour": "19:00",
              "state": "OPEN",
              "price": 700
            },
            {
              "hour": "20:00",
              "state": "UNAVAILABLE",
              "price": 700
            },
            {
              "hour": "21:00",
              "state": "OPEN",
              "price": 700
            }
          ]
        },
        "firstFullyOpen": {
          "seq": 74,
          "requestOffsetMs": 90008.8,
          "responseOffsetMs": 90169.8
        },
        "firstUnavailable": {
          "observation": {
            "seq": 14,
            "requestOffsetMs": 6013.8,
            "responseOffsetMs": 6093.8
          },
          "hours": [
            "20:00"
          ]
        },
        "firstRecord": {
          "observation": {
            "seq": 3,
            "requestOffsetMs": 10015.8,
            "responseOffsetMs": 10752.8
          },
          "hours": [
            "19:00",
            "20:00",
            "21:00"
          ]
        },
        "reopen": {
          "before": {
            "seq": 73,
            "requestOffsetMs": 85016.8,
            "responseOffsetMs": 85185.8
          },
          "after": {
            "seq": 74,
            "requestOffsetMs": 90008.8,
            "responseOffsetMs": 90169.8
          },
          "overlapping": false
        },
        "latest": {
          "observation": {
            "seq": 204,
            "requestOffsetMs": 900003.8,
            "responseOffsetMs": 900484.8
          },
          "state": "FULLY_UNAVAILABLE"
        }
      },
      "provider": {
        "complete": true,
        "protocol": "h2",
        "reused": true,
        "headersOffsetMs": 12085.9,
        "bodyOffsetMs": 12086.3,
        "timingSource": "browser",
        "dnsMs": null,
        "connectMs": null,
        "tlsMs": null,
        "sendMs": 0.3,
        "waitMs": 12086,
        "server": "Vercel",
        "cfRay": null,
        "cfMitigated": null,
        "vercelId": "sin1::sin1::t7sc7-1790553600025-c8c3f7635381",
        "requestId": null,
        "vercelCache": "MISS",
        "ageS": null,
        "serverTiming": null,
        "failure": null
      }
    },
    {
      "workerId": "E",
      "court": 3,
      "startTime": "19:00",
      "endTime": "22:00",
      "attemptId": "core-E-official-5",
      "finalState": null,
      "finalCode": null,
      "post": {
        "offsetMs": 8.5,
        "source": "run-trace"
      },
      "response": {
        "statusCode": 409,
        "errorHint": "availability",
        "responseSource": "application",
        "completedOffsetMs": 9846.5,
        "networkDurationMs": 9846
      },
      "grid": {
        "hours": [
          "19:00",
          "20:00",
          "21:00"
        ],
        "firstPublished": {
          "observation": {
            "seq": 14,
            "requestOffsetMs": 6013.8,
            "responseOffsetMs": 6093.8
          },
          "state": "PARTIALLY_UNAVAILABLE",
          "hours": [
            {
              "hour": "19:00",
              "state": "UNAVAILABLE",
              "price": 700
            },
            {
              "hour": "20:00",
              "state": "OPEN",
              "price": 700
            },
            {
              "hour": "21:00",
              "state": "UNAVAILABLE",
              "price": 700
            }
          ]
        },
        "firstFullyOpen": null,
        "firstUnavailable": {
          "observation": {
            "seq": 14,
            "requestOffsetMs": 6013.8,
            "responseOffsetMs": 6093.8
          },
          "hours": [
            "19:00",
            "21:00"
          ]
        },
        "firstRecord": {
          "observation": {
            "seq": 2,
            "requestOffsetMs": 2013.8,
            "responseOffsetMs": 2844.8
          },
          "hours": [
            "19:00",
            "21:00"
          ]
        },
        "reopen": null,
        "latest": {
          "observation": {
            "seq": 204,
            "requestOffsetMs": 900003.8,
            "responseOffsetMs": 900484.8
          },
          "state": "FULLY_UNAVAILABLE"
        }
      },
      "provider": {
        "complete": true,
        "protocol": "h2",
        "reused": true,
        "headersOffsetMs": 9845.5,
        "bodyOffsetMs": 9846.6,
        "timingSource": "browser",
        "dnsMs": null,
        "connectMs": null,
        "tlsMs": null,
        "sendMs": 0.1,
        "waitMs": 9836.4,
        "server": "Vercel",
        "cfRay": null,
        "cfMitigated": null,
        "vercelId": "sin1::sin1::gsvmw-1790553600027-aa378ac9fbd4",
        "requestId": null,
        "vercelCache": "MISS",
        "ageS": null,
        "serverTiming": null,
        "failure": null
      }
    },
    {
      "workerId": "F",
      "court": 2,
      "startTime": "19:00",
      "endTime": "22:00",
      "attemptId": "core-F-official-6",
      "finalState": null,
      "finalCode": null,
      "post": {
        "offsetMs": 8.6,
        "source": "run-trace"
      },
      "response": {
        "statusCode": 409,
        "errorHint": "availability",
        "responseSource": "application",
        "completedOffsetMs": 10425.6,
        "networkDurationMs": 10425
      },
      "grid": {
        "hours": [
          "19:00",
          "20:00",
          "21:00"
        ],
        "firstPublished": {
          "observation": {
            "seq": 14,
            "requestOffsetMs": 6013.8,
            "responseOffsetMs": 6093.8
          },
          "state": "PARTIALLY_UNAVAILABLE",
          "hours": [
            {
              "hour": "19:00",
              "state": "OPEN",
              "price": 700
            },
            {
              "hour": "20:00",
              "state": "UNAVAILABLE",
              "price": 700
            },
            {
              "hour": "21:00",
              "state": "UNAVAILABLE",
              "price": 700
            }
          ]
        },
        "firstFullyOpen": null,
        "firstUnavailable": {
          "observation": {
            "seq": 14,
            "requestOffsetMs": 6013.8,
            "responseOffsetMs": 6093.8
          },
          "hours": [
            "20:00",
            "21:00"
          ]
        },
        "firstRecord": {
          "observation": {
            "seq": 2,
            "requestOffsetMs": 2013.8,
            "responseOffsetMs": 2844.8
          },
          "hours": [
            "20:00"
          ]
        },
        "reopen": null,
        "latest": {
          "observation": {
            "seq": 204,
            "requestOffsetMs": 900003.8,
            "responseOffsetMs": 900484.8
          },
          "state": "FULLY_UNAVAILABLE"
        }
      },
      "provider": {
        "complete": true,
        "protocol": "h2",
        "reused": true,
        "headersOffsetMs": 10428.3,
        "bodyOffsetMs": 10428.7,
        "timingSource": "browser",
        "dnsMs": null,
        "connectMs": null,
        "tlsMs": null,
        "sendMs": 0.3,
        "waitMs": 10419.2,
        "server": "Vercel",
        "cfRay": null,
        "cfMitigated": null,
        "vercelId": "sin1::sin1::vwkmg-1790553600030-e06a61aa6615",
        "requestId": null,
        "vercelCache": "MISS",
        "ageS": null,
        "serverTiming": null,
        "failure": null
      }
    },
    {
      "workerId": "G",
      "court": 1,
      "startTime": "19:00",
      "endTime": "22:00",
      "attemptId": "core-G-official-7",
      "finalState": null,
      "finalCode": null,
      "post": {
        "offsetMs": 8,
        "source": "run-trace"
      },
      "response": {
        "statusCode": 409,
        "errorHint": "availability",
        "responseSource": "application",
        "completedOffsetMs": 12109,
        "networkDurationMs": 12108
      },
      "grid": {
        "hours": [
          "19:00",
          "20:00",
          "21:00"
        ],
        "firstPublished": {
          "observation": {
            "seq": 14,
            "requestOffsetMs": 6013.8,
            "responseOffsetMs": 6093.8
          },
          "state": "PARTIALLY_UNAVAILABLE",
          "hours": [
            {
              "hour": "19:00",
              "state": "UNAVAILABLE",
              "price": 700
            },
            {
              "hour": "20:00",
              "state": "OPEN",
              "price": 700
            },
            {
              "hour": "21:00",
              "state": "UNAVAILABLE",
              "price": 700
            }
          ]
        },
        "firstFullyOpen": null,
        "firstUnavailable": {
          "observation": {
            "seq": 14,
            "requestOffsetMs": 6013.8,
            "responseOffsetMs": 6093.8
          },
          "hours": [
            "19:00",
            "21:00"
          ]
        },
        "firstRecord": {
          "observation": {
            "seq": 2,
            "requestOffsetMs": 2013.8,
            "responseOffsetMs": 2844.8
          },
          "hours": [
            "19:00",
            "21:00"
          ]
        },
        "reopen": null,
        "latest": {
          "observation": {
            "seq": 204,
            "requestOffsetMs": 900003.8,
            "responseOffsetMs": 900484.8
          },
          "state": "FULLY_UNAVAILABLE"
        }
      },
      "provider": {
        "complete": true,
        "protocol": "h2",
        "reused": true,
        "headersOffsetMs": 12109.1,
        "bodyOffsetMs": 12109.8,
        "timingSource": "browser",
        "dnsMs": null,
        "connectMs": null,
        "tlsMs": null,
        "sendMs": 0.1,
        "waitMs": 12100.7,
        "server": "Vercel",
        "cfRay": null,
        "cfMitigated": null,
        "vercelId": "sin1::sin1::r6dd5-1790553600031-5bbbebb72c64",
        "requestId": null,
        "vercelCache": "MISS",
        "ageS": null,
        "serverTiming": null,
        "failure": null
      }
    }
  ],
  "limitations": [
    "An availability read shows Onda's state at an unknown moment between its request start and its response. No source here gives the provider-side moment of a change.",
    "Unavailable without a matching public booking record: the cause is not visible in Onda's public data.",
    "A public booking record shows that a booking record exists. It does not show who made it, whether it belongs to this bot, or why.",
    "POST initiation is the Playwright request event in the runner (trusted release clock). Header and body times are that instant plus Chrome intervals from its network request start (under 1 ms after the request event); they carry the few-ms delivery lag of that event.",
    "The provider trace enables DevTools Network only after each POST has left, so it never adds work at the release instant; a response that arrives before it is enabled (tens of ms) is not traced.",
    "Response timing and headers describe what arrived at this PC. They do not establish how Onda queued or ordered requests, or why a request was accepted or rejected.",
    "The observer and the dispatch clocks differ by -4.2 ms (observer minus dispatch); comparisons between grid reads and POST times carry that difference."
  ],
  "reportPath": "[REDACTED_LOCAL_PATH]\\Downloads\\Thirsty Pickle Bot\\.local\\release-forensics\\e3f7de87-d1d5-4949-9ddc-4cc49529cfa7\\report.txt",
  "summaryPath": "[REDACTED_LOCAL_PATH]\\Downloads\\Thirsty Pickle Bot\\.local\\release-forensics\\e3f7de87-d1d5-4949-9ddc-4cc49529cfa7\\summary.json"
}
```
