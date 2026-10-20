# Release day preflight

Booking Setup → **Review & Run** shows the saved release plan, a single preflight verdict and the main button. The execution console shows the same verdict, because both read one model (`src/release-preflight.ts`). That model restates the controller's checks. It never validates, saves or arms anything itself.

## Verdicts

| Verdict | Meaning |
| --- | --- |
| READY FOR OPERATOR AUTHORIZATION | Every current check passes. Only your Terms authorization and owner attestation remain. |
| NEEDS ACTION | Something must be refreshed or completed first, for example Prepare, the security check or the calibration. |
| BLOCKED | A required condition fails, for example a plan for a passed date, a failed check, an UNKNOWN result or a missing tab. |
| ARMED | The exact plan is armed. Emergency Stop cancels attempts that have not been sent. |

A READY verdict does not mean Onda will accept the checkout at 08:00. Live Shotgun acquires its own security verification about 53 s before the trigger. Provider acceptance at the release boundary has not been proven.

## Checks

| Row | Passes when | Recovery |
| --- | --- | --- |
| Saved release plan | A saved plan exists and the draft on screen matches it. Differences are listed field by field. | Review differences |
| Target date | The plan's booking date is the date the next release publishes. A plan for a passed date is never re-dated. | Review plan date |
| Dedicated browsers | Every assigned browser is connected, prepared for this plan, and has its exact tabs. | Prepare / Recheck browsers |
| Security check *(genuine; nothing submitted)* | One genuine Onda verification per browser passed within 60 minutes. It must be for this plan and booking date, and from the Chrome process running now. A restarted browser needs a new check. | Run security check |
| Timing calibration *(local only)* | A READY calibration exists from the last 24 hours. It must match this plan, installed build, Chrome version, machine and dispatcher runtime. A missing, expired, mismatched, failed or at-risk calibration blocks live Shotgun. | Run timing calibration |
| Preparation forecast | Every attempt is forecast to prepare in time. This is a forecast, not security evidence. | Review capacity |
| Trusted clock, Machine & build | The controller's clock and machine checks pass. | Refresh clock |
| Locks, holds & unknown results | No retained lock or UNKNOWN result is waiting. An UNKNOWN result is never retried or cleared automatically. | Review previous submission |
| Owner authorization | Always your final step. It never counts toward READY. | — |

The security row also gives two warnings. One appears when a check took longer than the measured duration the release lead was sized for. The other appears when Onda showed a verification frame. The forecast row states the retry window: with a 53 s lead and a 7 s retry cutoff, a first attempt that fails within about 46 s can be retried once. A longer stall fails closed and nothing is sent late. The lead is never increased automatically.

## Main button

Under the button, four lines state what it will do and what it will not do. They also say whether it changes the saved plan and whether live dispatch can follow. These lines come from the typed action (`SAVE_PLAN`, `PREPARE`, `AUTHORIZE_ARM`, `STOP`), never from the button text. Automation must check `#main-action[data-action]` before clicking.

Saving a plan that differs from the saved one opens a review first. It lists the exact before/after differences, including any booking date change. **Keep current saved plan** changes nothing.

## Shortest workflow for the next authorized release

1. In **Booking Setup**, if the date banner appears, press **Plan the next release**. This changes only the draft.
2. Check the courts, hours and required court count. Then press **Save release plan** and confirm the listed differences.
3. Press **Prepare**. It opens the assigned browsers and runs the genuine security check. Complete any VERIFY HERE window yourself.
4. If **Timing calibration** is not VERIFIED, press **Run timing calibration**. It runs locally and takes about 4 minutes on this machine.
5. If the clock row asks for it, press **Refresh clock**.
6. Wait for **READY FOR OPERATOR AUTHORIZATION**. Then tick Terms, press **Authorize and Arm**, and attest for the exact plan.
7. Stay at the computer until release. If a THIRSTY BOT window says VERIFY HERE, complete the check there.
