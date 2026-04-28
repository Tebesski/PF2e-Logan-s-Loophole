# Logan's Loophole

Pathfinder 2e module that automates drug use and going through addiction, and provides with a comprehensive drug builder.
<img width="1305" height="993" alt="char-hud" src="https://github.com/user-attachments/assets/3727e03e-d33f-4c17-a57d-3ea099d7d022" />

## Table of Contents

1. [Core concepts](#core-concepts)
2. [Quick start](#quick-start)
3. [The actor HUD](#the-actor-hud)
4. [Settings](#settings)
5. [API reference](#api-reference)
6. [Logan's Loophole Compendium](#logans-loophole-compendium)

---

## Core concepts

### Categories and drug items

A **category** is the abstract class of drug (i.e. alcohol, opiate). It defines the entire mechanical model: intoxication, overdose, hangover and addiction effects.

A **drug item** is a concrete consumable (vodka, wine, cigarettes, etc) that references a category and contributes a specific Toxicity per dose. Two different drug items can reference the same category and have different TXs, Fortitude DCs, Addiction Points yielded on consumption, etc.

### Toxicity and Intoxication (TX)

When consuming a substance, you roll Fortitude to resist Toxicity from increasing your Intoxication pool. When reaching a certain Toxicity threshold, you get Intoxicated. Intoxication is split into Stages, and each Stage yields effects/conditions/rule elements, or deals damage.
Each Stage has its own decay rate and decays naturally over time until you are fully sobered.

### Tolerance

By default is equal to character's Constitution mod, but each Addiction stage could increase the Tolerance. Each point of Tolerance absorbs Toxicity from the consumed drug. Tolerance restores after a Long Rest.

### Overdose

Overdose points to the maximal Intoxication level. When Overdose is reached, you roll Fortitude against it and suffer consequences (or do not suffer if you roll successfully).

When TX crosses the Overdose Threshold, an Overdose Fortitude save fires. The ourcome can:

- Reduce TX by an amount and remove Overdose.
- Roll damage.
- Apply effects.

You cannot take more of the drug that caused the overdose until you are clear. Overdose yields its own specific effects and damage.

### Hangover

Can be disabled. When you reach a certain Intoxication threshold, you queue a Hangover. It fires after Intoxication reaches 0 or after a Long Rest. You roll Fortitude against it and suffer consequences defined in the Registry.

<img width="749" height="524" alt="hangover" src="https://github.com/user-attachments/assets/b8c9d2b0-25d5-470c-b72c-38a209e992ba" />

### Addiction Points (AP) and addiction stages

AP is a separate counter. Each consume of an addictive drug rolls a Will save (the Addiction save), and yields the configured amount of AP.

AP thresholds map to addiction stages. Reaching a threshold advances the stage. Each stage has its own ongoing chronic effects (always active while at that stage) and withdrawal effects (active when satiation lapses).

AP decays naturally over time, at the defined per-stage rate, but ONLY when the character is suffering withdrawal and restraining themselves from taking any more drugs. But should they take the drug again, the AP decay stops for the amount of time equal to the stage AP decay rate.

### Satiation

While being Addicted and reaching at least 1st Stage of Intoxication you are Satiated. The satiation window is per addiction-stage (e.g., 12 hours at Stage I, 24 hours at Stage II).

While satiated:

- Withdrawal effects are suppressed.
- AP decay is paused for the amount of time equal to the stage AP decay rate.

When satiation lapses, withdrawal kicks in again and AP decay resumes.

There are two flavours of satiation, distinguished internally by `SATIATION_KIND`:

- **Real**: applied automatically when a drug is consumed. AP decay pauses for the satiation window.
- **Fake**: applied via `api.fakeSatiate()`. Withdrawal symptoms are suppressed, but AP decay continues normally.

### Withdrawal

When satiation lapses on an addicted character, the withdrawal stage is set to the character's addiction stage and the withdrawal wrapper applies, granting all configured withdrawal effects from that stage and below (cumulative).

Withdrawal is removed by:

- Re-satiating.
- Reaching AP 0 (full natural recovery).
- Suppressing it via Fixer or Addiction Treatment action.

### Quit penalty

When a character recovers fully (AP returns to 0) from a stage they peaked at, an optional Will-save quit penalty applies to all future Addiction saves vs. that category. It can be cleared via `api.curePenalty()`.

---

## Quick start

### 1. Open the registry

You can do it by:
a) Simply using the Flask icon in the Scene Controls (the menu on the left top of the screen)
b) Going into Game Settings → Configure Settings → PF2e Logan's Loophole → "Edit Drug Categories".

<img width="1469" height="947" alt="drug-registry" src="https://github.com/user-attachments/assets/1fb412a1-f86c-49a4-9ed1-bb1621e4f10e" />

### 2. Create a category

Click "+ Add" in the sidebar to add a new drug category.

A category is a kind of drug, like alcohol or opium. Specific items (a bottle of wine, a pint o' ale, a shot of vodka) all reference the same category but can have their own potency and Toxicity value per dose.

### 3. Configure intoxication stages

Each stage has a Toxicity threshold (TX). When a character's TX reaches a stage's threshold, that stage's effects activate.

Each stage has its own decay rate (how fast TX falls back), its own optional damage payload (rolled when the stage is reached), and its own list of effects/conditions/rule elements.

<img width="712" height="887" alt="intox-stages" src="https://github.com/user-attachments/assets/a399e150-e526-4ea9-a09b-d72f51075979" />

### 4. Configure overdose

Each category has an Overdose Threshold (the TX value at which an overdose save is forced) and four save outcomes (Critical Success, Success, Failure, Critical Failure). Each outcome can do its own damage and apply its own effects.

<img width="729" height="886" alt="overdose" src="https://github.com/user-attachments/assets/d4e9216a-2442-47bc-9db4-639687168ca2" />

### 5. Configure addiction stages

This is the chronic side. Each addiction stage is gated by an AP threshold. When AP crosses the threshold, the stage activates.

For each stage you set: maximum tolerance, AP decay rate, satiation duration, will-save penalty (applied to future addiction saves), quit penalty (lingering Will-save penalty after a full cure), chronic effects (active while addicted), and withdrawal effects (active when satiation lapses).

<img width="741" height="882" alt="addiction-satges" src="https://github.com/user-attachments/assets/73a0dfdc-28cf-4afb-a157-6a124f219c7f" />

### 6. Save the category

Click Save. The category is now persisted in the world.

### 7. Create a consumable item

In any actor's inventory, or in a world item directory, create a new consumable item. Add the **drug** trait. A new "Drug Config" tab appears on the item sheet.

In the Drug Config tab: pick the category from the dropdown to bind the substance to the drug category and start configuring it.

<img width="1110" height="680" alt="vodka-desc" src="https://github.com/user-attachments/assets/6a6b9e87-dae3-416b-924f-a009e09bf32d" />
<img width="1122" height="710" alt="vodka-config" src="https://github.com/user-attachments/assets/fc37d0e2-8a4b-4f17-83fc-d66c8f19d390" />

### 8. Consume it

Give the item to a character and have them consume it. The module will prompt for Resist (roll normally against Intoxication) or Embrace (worsen roll by 1 degree of success).

After that, a HUD appears in a Character Sheet, in the Effects Tab, where you can manage everything.

---

## Character Sheet Addiction/Intoxication Tracker HUD

The HUD appears on the actor sheet's Effects tab when any drug state exists.

<img width="1305" height="993" alt="char-hud" src="https://github.com/user-attachments/assets/41932bcc-ae43-4ffb-a612-47020e7bf5e6" />

---

## API reference

The module exposes its API as `game.modules.get("pf2e-logans-loophole").api`. This is available on the `ready` hook and onward.

<img width="504" height="324" alt="treat" src="https://github.com/user-attachments/assets/2a3e2674-af6c-48b0-a2d8-620ab9236d7e" />

These are the methods that macros should be built against.

#### `api.getCategory(categoryId)`

Returns the category configuration object, or `null` if not found.

```js
const api = game.modules.get("pf2e-logans-loophole").api
const cat = api.getCategory(catId)
if (!cat) return ui.notifications.warn("Category not found.")
ui.notifications.info(`This is ${cat.name}.`)
```

#### `api.listCategories()`

Returns an object mapping `categoryId` to category, for all registered categories in the world.

```js
const api = game.modules.get("pf2e-logans-loophole").api
const allCats = api.listCategories()
for (const [id, cat] of Object.entries(allCats)) {
   console.log(id, cat.name)
}
```

#### `api.getState(actor, categoryId)`

Returns the current state object for `(actor, category)`, including TX, AP, addiction stage, satiation timestamps, etc. Returns a fresh-defaults object even if no state has been written yet, so it never returns `null`.

```js
const api = game.modules.get("pf2e-logans-loophole").api
const s = api.getState(actor, catId)
console.log("TX:", s[api.STATE.TOXICITY], "AP:", s[api.STATE.ADDICTION_POINTS])
```

#### `api.getStateMap(actor)`

Returns the full state map for the actor (all categories the actor has any state for). Useful for iterating.

```js
const api = game.modules.get("pf2e-logans-loophole").api
const map = api.getStateMap(actor)
const trackedCats = Object.keys(map)
```

#### `api.getQuitPenalty(actor, categoryId)`

Returns the current Will-save penalty against this category from peaked-and-cured Ghost of Addiction. 0 if no penalty applies.

#### `api.setToxicity(actor, categoryId, value)`

Sets the actor's TX for the category to `value` (clamped to `[0, overdoseThreshold]`). Triggers stage transitions, payload damage on upward transitions, overdose save on threshold crossing, and hangover firing if TX returns to 0 with a pending hangover.

```js
const api = game.modules.get("pf2e-logans-loophole").api
await api.setToxicity(actor, catId, 8)
```

#### `api.setTolerance(actor, categoryId, value)`

Sets tolerance, clamped by max-tolerance for the actor's current stage and Con bonus.

```js
const api = game.modules.get("pf2e-logans-loophole").api
await api.setTolerance(actor, catId, 6)
```

#### `api.setAP(actor, categoryId, value)`

Sets AP. Triggers stage transitions and recomputes withdrawal/satiation state.

```js
const api = game.modules.get("pf2e-logans-loophole").api
await api.setAP(actor, catId, 12)
```

#### `api.addAP(actor, categoryId, delta, options?)`

Adds `delta` to AP (negative to reduce). Returns `{ oldAP, newAP, oldStage, newStage }`. The `options` object can include `silent: true` to suppress chat messages and SFX.

```js
const api = game.modules.get("pf2e-logans-loophole").api
const { newStage } = await api.addAP(actor, catId, 5)
if (newStage > 0) console.log("They've crossed into addiction.")
```

#### `api.forceStage(actor, categoryId, stage)`

Forces the actor to Addiction Stage `stage`, setting AP to that stage's threshold value.

```js
const api = game.modules.get("pf2e-logans-loophole").api
await api.forceStage(actor, catId, 2)
```

#### `api.forceSatiate(actor, categoryId)`

Applies "real" satiation to the actor, using the configured satiation duration for their current addiction stage. Pauses AP decay. This is what a normal drug consume does internally.

#### `api.fakeSatiate(actor, categoryId, seconds)`

Applies "fake" satiation: suppresses withdrawal symptoms for `seconds`, but does not pause AP decay. Used by the Fixer item to mask withdrawal while letting natural recovery continue.

```js
const api = game.modules.get("pf2e-logans-loophole").api
await api.fakeSatiate(actor, catId, 7200) // 2 hours
```

#### `api.forceUnsatiate(actor, categoryId)`

Clears satiation immediately. Triggers withdrawal if the actor is addicted.

#### `api.injectTV(actor, categoryId, tv, drugConfig?)`

Adds `tv` directly to TX, bypassing the metabolism save. The `drugConfig` is an optional object matching the drug-config schema. Useful for environmental effects ("breathing this gas adds 1 TV per round") or magical effects.

```js
const api = game.modules.get("pf2e-logans-loophole").api
await api.injectTV(actor, catId, 3, { name: "Spore Cloud" })
```

#### `api.cure(actor, categoryId)`

Full reset for the category: clears all state, removes all wrapper effects, removes immunity flags. The character is no longer tracked for this category.

#### `api.curePenalty(actor, categoryId)`

Clears the peak-stage record. Future cures will not produce a Ghost of Addiction penalty.

#### `api.cureHangover(actor, categoryId)`

Removes the hangover wrapper and clears any pending-hangover flag.

#### `api.cureOverdose(actor, categoryId)`

Removes the overdose wrapper and reduces TX to just below the overdose threshold (so a future consume won't immediately re-trigger).

#### `api.cleanseAddictions(actor)`

The "wipe everything" call. Removes all drug state and all module-managed effects from the actor across every category. Use for character death/respec/teleporting-to-paradise scenarios.

#### `api.syncEffects(actor, categoryId)`

Rebuilds the wrapper effects from the actor's current state. Useful if state and effects desync (rare, but possible if another module deletes our effects without going through our API).

#### `api.consumeItem(actor, item, message?)`

Manually triggers the full consume pipeline as if the actor used the item. The third argument is an optional chat-message reference for context, almost always `null`.

```js
const api = game.modules.get("pf2e-logans-loophole").api
await api.consumeItem(actor, item)
```

#### `api.rollSave(actor, saveType, dc, flavor, dosAdjustments?, extraOptions?)`

Convenience wrapper around PF2e save rolls. Returns the degree-of-success string (matches `api.DOS` enum values). Pass `null` for `dosAdjustments` if not needed. `extraOptions` is an array of strings passed as both `options` and `extraRollOptions`.

```js
const api = game.modules.get("pf2e-logans-loophole").api
const degree = await api.rollSave(actor, "fortitude", 18, "Toxin Save", null, [
   "poison",
   "drug",
])
if (degree === api.DOS.CRITICAL_SUCCESS) {
   ChatMessage.create({ content: `${actor.name} resists completely.` })
}
```

#### `api.shiftDegree(degree, steps)`

Shifts a degree-of-success by `steps`. Positive moves toward failure (worse), negative moves toward success (better).

```js
const api = game.modules.get("pf2e-logans-loophole").api
const adjusted = api.shiftDegree(api.DOS.SUCCESS, -1) // CRITICAL_SUCCESS
```

#### `api.openTreatmentDialog(medic, patient)`

Opens the GM-side treatment dialog for the medic acting on the patient. Useful for hooking custom treatment macros.

#### `api.manageImmunitiesDialog(actor, categoryId)`

Opens the per-actor immunity management dialog.

### Constants and Enums

#### `api.STATE`

Object with keys for every state field. Use these to read from state objects:

```js
const api = game.modules.get("pf2e-logans-loophole").api
const tx = api.getState(actor, catId)[api.STATE.TOXICITY]
const ap = api.getState(actor, catId)[api.STATE.ADDICTION_POINTS]
```

Available keys: `TOXICITY`, `TOLERANCE`, `ADDICTION_POINTS`, `ADDICTION_STAGE`, `PEAK_STAGE`, `WITHDRAWAL_STAGE`, `INTOX_STAGE`, `SATIATION_END`, `SATIATION_KIND`, `AP_DECAY_PAUSE_END`, `AP_DECAY_NEXT`, `DECAY_NEXT`, `HANGOVER_PENDING`, `CATEGORY_NAME`, `CATEGORY_IMG`.

#### `api.patchState(actor, categoryId, patch)`

Directly merge a patch object into the actor's state for a category.

#### `api.removePhaseEffects(actor, categoryId, phase)`

Remove all module-managed wrapper effects for a phase (or pass `null` for all phases). Bypasses the manual-deletion dialog.

#### `api.refillTolerance(actor, categoryId)`

Refill tolerance to max for the current stage.

#### `api.fireHangover(actor, categoryId)`

Force the hangover save and resolution.

---

## Logan's Loophole Compendium

Logan's Loophole with a compendium of cool macros and items.

### Cleanser

> A chalky, foul-smelling suspension of activated carbons and emetic compounds. Binds to unmetabolised toxins in the digestive tract and forces an immediate, violent evacuation. Highly effective at preventing an imminent overdose, but leaves the patient battered and dehydrated.

Reduces Toxicity by 2 immediately. Applies a 1-hour Cleanser immunity.

### Adrenaline Spike

> A high-gauge auto-injector loaded with synthetic epinephrine and cardiac stimulants.

Removes Overdose if active, and reduces Intoxication by one stage. Applies a 24-hour immunity.

### Fixer

> A synthetic cocktail that binds to depleted receptors, tricking the nervous system into believing an addiction has been fed.

Suppresses withdrawal symptoms for 2 hours without pausing AP decay.

### Detox

> A rapid-metabolism inducer and hydration complex. It aggressively flushes metabolic byproducts from the nervous system, truncating the misery of acute substance abuse.

Roll against Hangover with decreased DC. Applies immunity for 4 hours.
