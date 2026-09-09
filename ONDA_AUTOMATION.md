# Engineering status and next steps

This repository is an evidence-first implementation checkpoint, not a production-ready reservation bot.

Completed: empty-root Git initialization on main; dedicated visible Chrome launcher; localhost listener and profile validation; one exact Onda tab; real schedule DOM inspection; authorized select/verify/deselect/clean practice; validated configuration and calendar preferences; one-pass DOM grid parser and strict row-date barrier; read-only release observer/dry engine; process ownership lock; abort/disconnect handling; offline tests; checkout validation/payment-boundary contract; documentation.

Blocked: actual 08:00 observation; real checkout DOM and adapter; production race; full fixture checkout E2E; GitHub authentication/private push. The CLI's live race refusal is unconditional and occurs before browser attachment. Adding --armed cannot override missing evidence. No guessed checkout selectors are stored.

## Architecture

`src/index.ts` owns the Playwright process, terminal abort controls and atomic `.local/automation.lock`. `browser.ts` verifies the CDP listener belongs to this project's profile, resolves exactly one exact-URL tab, and fails closed on disconnection, close/crash, rate-limit response or unexpected top-level navigation. `grid.ts` holds inspected selectors and one-pass parsing. `practice.ts` never calls Proceed. `release.ts` only reloads/navigates/reads, with at most two normal reloads. `checkout.ts` defines a tested adapter contract with no real DOM implementation.

The browser is left open. Ctrl+C/Q exits the process that owns Playwright, stopping its pending local action tasks. Already-dispatched events cannot be undone. No automatic deselection or recovery follows abort. A failed/aborted run leaves its lock as a signal that the browser must be checked manually.

## Second engineering pass

Where are we actually losing time? The measured repeated-locator grid read cost ~338 ms median versus ~7.93 ms for one-pass snapshot and validation. Keep the one-pass design. Cost is browser round trips; no raw clicks or alternate APIs are warranted.

| Candidate | Expected benefit | Reliability risk / decision |
|---|---|---|
| One-pass snapshot | Measured ~330 ms median versus intentionally repeated reads | Retained; dates, states and coverage checked together |
| Preselect release date | Would avoid navigation | Disabled by real UI; rejected |
| Copied date URL | Could avoid calendar actions | No public date URL observed; rejected |
| Pre-resolve next-day button | Potentially fewer post-release UI steps | Reload resets today; target is +2, so one click is insufficient. Calendar remains baseline pending release measurements. |
| MutationObserver on race path | Unknown | Observer used only for diagnostic transition recording; no demonstrated production benefit |
| DOM click / batched form fill | Unknown | Not implemented; actionability/application-state risk and checkout unverified |
| Scheduler lead | Unknown | Fixed at zero; early trigger rejected until evidence supports it |

No production latency or competitive success claim is made. A single non-release transition is not a release benchmark.

## Resume order

1. With page on today's date and no selection, run release observer before 07:59:45. Leave the user present and terminal/browser visible. Capture the actual 08:00 behavior, with bounded reloads only.
2. Obtain a separate checkout-inspection scope consistent with the user's latest no-Proceed practice instruction. Inspect summaries, fields, terms and final button through ordinary UI. Do not invent backend calls or enter payment information.
3. Implement verified production adapter, strong Review and Payment Summary checks, guarded sequential selection and safe deterministic fallback cleanup. Lock before any uncertain Proceed result to avoid duplicate paths. Keep final action gate sealed before dispatch even on an ambiguous failure.
4. Extend synthetic DOM to checkout, complete full offline E2E, test abort during pending action and browser transport failure; only then replace unconditional live-race evidence block.
5. Benchmark full phases, optimize measured bottlenecks, secret-scan, create PRIVATE `thirsty-autobook-web` and push main after GitHub CLI login.
