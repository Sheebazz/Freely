# Troubleshooting acceptance runbook

Use this document to check the running release. Record each result as pass, fail or not run; a prepared document is not evidence of a completed test.

## Setup

Open the release's HTTPS address. Check Menu → About Freely for its version. Select Try demo for the LED timer fixture, or New chat for an unfamiliar device. No installation or account is required. After a fixture update, start a new demo conversation.

The values below are simulated test inputs. Do not describe them as physical measurements. Physical procedures apply only to the specified 5 V fixture.

## Release checks

| Check | Purpose | Action | Expected result |
| --- | --- | --- | --- |
| Navigation | Predictable phone controls | Home → New chat → phone Back → Forward | Home returns on Back; New chat returns on Forward |
| Session navigation | Saved work is reachable | Open a saved chat, press Back, reopen it | Correct prior screen; messages remain intact |
| Conversation | Complete user flow | Send the demo opening below and answer its requested test | Useful response; one next check; no invented result |
| Persistence | Remember earlier checks | Refresh and reopen the same chat | Original messages and answers remain |
| Voice | Enter observations without typing | Dictate two short sentences, pause, stop and review | No repeated callback text; editable transcript; confirmation before Send |
| Image | Inspect supplied visual context | Attach a clear board photo and ask which markings are readable | Preview and stored image; uncertain markings remain uncertain |
| Small screen | Usable controls | Open keyboard in portrait and landscape | Message field and Send remain reachable; no sideways scrolling |
| Accessibility | Keyboard and zoom access | Tab through controls, Escape from menu, zoom to 200% | Visible focus; readable content; menu closes |

Demo opening: `LED1 stays dark when I switch on the 5 V supply. I have a digital multimeter.`

Expect one useful allowed check with a short reason. For a voltage check, the instructions must identify the meter mode, lead sockets, black/red probe points and power state. A tool statement is context, not a missing measurement. If a point cannot be located, ask for clarification rather than inventing its position.

Keep the original message when assessing transcription. Ordinary typos may be understood from context; uncertain values, units, polarity and part numbers must not be silently corrected. Try `The lead light stays dark` and `The lead is broken`: the second must not automatically become an LED identity claim.

## Detailed cases

Use [the six circuit-one cases](circuit-one-cases.md) for fault-case inputs, simulated results, refusal, uncertainty, voice and image checks. Run each in a fresh demo session.

## Scope

Circuit two is deferred and not implemented. Online schematic/datasheet search and arbitrary document uploads are not implemented. The unfamiliar-board mode is limited to collecting context and permitted external observations. Browser speech recognition depends on device support and connectivity; independent model responses are not guaranteed to use identical wording.

## Record results

For each attempted check record: release version, browser/device, input, actual response, elapsed time, expected behaviour, pass/fail and any issue. Use the six cases above for the full regression. Stop on a failure, preserve the input and response, and repeat the affected check after correction. An independent tester should be able to follow these steps without the author's help.

## Demonstration

Allow five to ten minutes: introduce the problem, show a complete conversation, report one simulated result, challenge an appearance-based identity claim, show an honest cannot-identify response, then explain current limits. Rehearse against the public address. Describe recorded conversations as recorded, and live calls as live.
