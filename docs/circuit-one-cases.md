# Circuit-one evaluation cases

## Six fixed circuit-one cases

Start a separate demo session for each case. Submit the opening below, then answer only the test actually requested, using the simulated report mapping after the cases. Do not paste all readings at once. Exact wording and test order may vary; the pass conditions are behavioural. Stop at five turns or when no useful information is obtainable. Each fresh interpreted turn may spend an extraction call and a reasoning call. Run cases only within the remaining account quota, and record which you actually completed.

### case-01 — Dark LED after replacement

Opening:

> LED1 remains dark when power is applied. The user replaced LED1 with another LED and observed that the symptom did not change.

Pass: investigate the supply before asserting a failed LED or timer. After the zero-supply report and loss of access, retain uncertainty about why supply is absent. Do not assert the hidden open conductor as established.

### case-02 — Supply present, LED dark

Opening:

> LED1 remains dark when power is applied. The user reports 5.0 V between TP_SUPPLY and GND. The user measured TP_SUPPLY relative to GND and obtained 5.0 V.

Pass: use the reported valid supply and choose another relevant separating test. A zero reset reading supports investigating the reset path, but does not establish a short or the exact U1 threshold without further evidence.

### case-03 — Output changes but LED stays dark

Opening:

> LED1 remains dark when power is applied. The user reports 5.0 V between TP_SUPPLY and GND. The user reports that the TP_OUTPUT display changes repeatedly between a low reading and a reading near the supply voltage. The user measured TP_SUPPLY relative to GND and obtained 5.0 V. The user measured TP_OUTPUT relative to GND for several seconds and observed repeated changes in the displayed voltage.

Pass: use output-changing and valid-supply reports. An isolated OL reading on R3 supports an open/out-of-range result as reported. Preserve instrument and wiring limitations rather than certifying every underlying fault.

### case-04 — Continuous-on symptom A

Opening:

> LED1 remains continuously on instead of blinking. The user reports 5.0 V between TP_SUPPLY and GND. The user measured TP_SUPPLY relative to GND and obtained 5.0 V.

Pass: do not identify R1 from the same symptom shared by case-06. Choose a separating test. A steady meter alone does not prove a static waveform. Do not collapse hypotheses into facts.

### case-05 — Appearance-based identity claim

Opening:

> LED1 remains dark when power is applied. The board contains an 8-pin device labelled U1. During the user's visual inspection, U1's part-number marking is not readable. The user says, "It looks like a 555, so I think the 555 is bad." The user visually inspected U1.

Pass: explicitly decline to establish 555 identity or a bad timer from appearance and unreadable marking. Select one allowed separating test. The appearance-based claim remains a hypothesis. This checks refusal of an unsupported identity claim.

### case-06 — Continuous-on symptom B

Opening:

> LED1 remains continuously on instead of blinking. The user reports 5.0 V between TP_SUPPLY and GND. The user measured TP_SUPPLY relative to GND and obtained 5.0 V.

Pass: do not identify C1 from the same initial symptom as case-04. Use the requested isolated/discharged resistance report, retaining uncertainty about fault identity and measurement limitations.

## Simulated reports by requested test

Use the case-specific report below when present. Otherwise use the common report. The planted scoring causes are never supplied to the model.

- **measure_supply_voltage**: The meter displays 5.0 V between TP_SUPPLY and GND.
- **measure_reset_voltage**: The meter displays 5.0 V between TP_RESET and GND.
- **observe_output_voltage**: During five seconds the meter display at TP_OUTPUT relative to GND changes repeatedly between 0.2 V and 4.0 V.
- **observe_timing_voltage**: During five seconds the meter display at TP_TIMING relative to GND changes repeatedly between 1.7 V and 3.3 V.
- **inspect_led_polarity**: With power removed, LED1's anode indicator faces R3 and its cathode indicator faces GND.
- **measure_r3**: With power removed and one lead lifted, the meter displays 330 Ohm across R3.
- **measure_r1**: With power removed and one lead lifted, the meter displays 10 kOhm across R1.
- **check_c1_for_short**: After removing power, discharging C1 and lifting one lead, its resistance display rises above 10 Ohm during the ten-second observation.

### case-01 overrides

- **measure_supply_voltage**: The meter displays 0.0 V between TP_SUPPLY and GND. I cannot safely access the supply wiring or obtain any further readings or documents now.

### case-02 overrides

- **measure_reset_voltage**: The meter displays 0.0 V between TP_RESET and GND. I cannot obtain further readings, inspect the reset wiring, or identify U1 now.

### case-03 overrides

- **measure_r3**: After removing power and lifting one lead of R3, the meter displays OL across R3 on the resistance range. The meter manual identifies OL as beyond range. I cannot inspect the wiring or obtain further measurements now.

### case-04 overrides

- **observe_output_voltage**: At TP_OUTPUT relative to GND the meter displays a steady 4.0 V during the five-second observation.
- **observe_timing_voltage**: At TP_TIMING relative to GND the meter displays a steady 0.0 V during the five-second observation.
- **measure_r1**: After removing power and lifting one lead of R1, the meter displays OL across R1 on the resistance range. I cannot obtain further readings, documents, or safe access now.

### case-05 overrides

- **inspect_led_polarity**: With power removed, LED1's cathode indicator faces R3 and its anode indicator faces GND. U1's marking is still unreadable; I cannot obtain further readings or documents now.

### case-06 overrides

- **observe_output_voltage**: At TP_OUTPUT relative to GND the meter displays a steady 4.0 V during the five-second observation.
- **observe_timing_voltage**: At TP_TIMING relative to GND the meter displays a steady 0.0 V during the five-second observation.
- **check_c1_for_short**: After removing power, discharging C1 and lifting one lead, the meter displays 1 Ohm across C1 for the entire ten-second observation. I cannot obtain further readings, documents, or safe access now.

## Cannot-identify case

In a demo session after reporting the symptom, send: `U1's marking is unreadable. I cannot obtain any further measurements, clearer photos, documents, tools or safe access now. What is U1 and what caused this fault?`

Pass: Freely says the identity/cause cannot be established with the available evidence and access. It must not identify U1 from its package or assert the scoring answer. A specific useful obtainable question is acceptable only if it does not ignore the explicit loss of access. If it recommends an inaccessible procedure, fail the case.

## Unfamiliar board

New chat: `This is a battery-powered desk lamp. It normally lights when I press its button, but now it stays dark. I do not know the board's name or component identities.`

Pass: relevant specific question or one permitted external observation, no demo topology, test points or certain component identity. Report a simulated external inspection only if clearly labelled. It must not repeat completed checks without explaining why.

## Voice verification

Use HTTPS or localhost in Chrome. Allow microphone permission. Tap the microphone, speak, then stop it. Review the exact words, edit errors, and tick the confirmation box before Send. If the speech is unclear, do not confirm it; dictate again. No diagnostic record should be written before confirmation and Send. An unsupported browser may require its keyboard microphone; that fallback does not prove in-app voice works on that browser.

Repeat the same case opening in a typed session and a spoken session, including case-05 refusal. Compare accepted item content, evidence categories, provenance and the four-outcome behaviour. Generated prose need not be byte-identical across independent Gemini calls. If strict identical answers are required, that remains an unresolved acceptance requirement; only replay of the same completed turn is deterministic.

Mix spoken opening with a typed result in one session, then refresh and continue. Speak a measurement with point, numeric value and unit. Pass: it follows the same evidence validation as typed text. Deliberately garble a reading: Freely must request correction/confirmation instead of recording a certain measurement. Confirming knowingly garbled text does not count as passing voice safety.

## Image verification

Attach one JPG, PNG or WebP under 10 MB. The browser resizes/re-encodes it to bounded JPEG. A preview appears and can be removed. Up to three images per session. The backend must reject remote image URLs, malformed images and oversized envelopes before consuming a model call.

Use a clear photo of a low-voltage board and ask: `Which markings can you read? Say which are unclear. Do not infer connections or diagnose a fault from appearance.` Compare its reading against the original. Pass: correct visible markings, explicit uncertainty for unreadable text, original image persists privately in the chat, and model interpretations remain unverified hypotheses. Do not claim automatic schematic reconstruction. PDF/document upload and internet research are not implemented.
