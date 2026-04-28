import { MODULE_ID, FLAG, STATE, DOS, INTENT, PHASE } from "../constants.mjs"
import { Settings } from "../settings.mjs"
import { getCategory, buildRollOptions } from "../registry/registry.mjs"
import { getState, actorLevelBasedDC } from "../utils/state.mjs"
import { rollSave, shiftDegree } from "../utils/saveRoller.mjs"
import { applyToxicity } from "../effects/engine.mjs"
import { activePhases } from "../effects/factory.mjs"
import {
   addAP,
   refreshSatiation,
   getQuitPenalty,
} from "../effects/withdrawal.mjs"
import { promptIntent } from "../apps/intentPrompt.mjs"
import { playLifecycleSfx, SFX_KEYS } from "../utils/sfx.mjs"

function _getDrugConfig(item) {
   const drug = item.getFlag?.(MODULE_ID, FLAG.DRUG)
   if (!drug || !drug.categoryId) return null
   return drug
}

export async function onConsumeItem(actor, item, message = null) {
   const drug = _getDrugConfig(item)
   if (!drug) return
   const category = getCategory(drug.categoryId)
   if (!category) return

   if (_hasActiveOverdose(actor, drug.categoryId)) {
      ui.notifications?.warn(
         game.i18n.format("LL.Chat.OverdoseBlock", {
            actorName: actor.name,
            categoryName: category.name,
         }),
      )
      return
   }

   let intent = INTENT.RESIST
   if (Settings.promptEmbrace) {
      intent = await promptIntent({
         itemName: item.name,
         categoryName: category.name,
      })
      if (!intent) return
   }

   const configuredFortDC =
      Number(drug.fortitudeDC) || Number(category.chronic?.baseWillDC) || 0
   const fortDC = configuredFortDC > 0 ? configuredFortDC : actorLevelBasedDC(actor)
   const itemTraits = item.system?.traits?.value ?? []
   const rollOptions = buildRollOptions(category, "intoxication", itemTraits)

   let embraceEffectId = null
   if (intent === INTENT.EMBRACE) {
      embraceEffectId = await _applyEmbraceAdjustment(actor)
   }

   let fortDegree
   try {
      fortDegree = await rollSave(
         actor,
         "fortitude",
         fortDC,
         game.i18n.format("LL.Chat.MetabolismSave", {
            itemName: item.name,
            dc: fortDC,
         }),
         null,
         rollOptions,
      )
   } finally {
      if (embraceEffectId) {
         await _removeEmbraceAdjustment(actor, embraceEffectId)
      }
   }

   await playLifecycleSfx(SFX_KEYS.CONSUME, drug)

   if (
      drug.potent &&
      (fortDegree === DOS.CRITICAL_SUCCESS || fortDegree === DOS.SUCCESS)
   ) {
      fortDegree = shiftDegree(fortDegree, 1)
   }

   const tv = _yieldedTV(drug.tv, fortDegree)
   const result = await applyToxicity(
      actor,
      drug.categoryId,
      item,
      drug,
      tv,
      itemTraits,
   )

   const localizedIntent = game.i18n.localize(
      intent === INTENT.RESIST ? "LL.Intent.Resist" : "LL.Intent.Embrace",
   )

   const toxLines = [
      game.i18n.format("LL.Chat.Consumed", {
         itemName: item.name,
         categoryName: category.name,
      }),
      game.i18n.format("LL.Chat.ToxResult", {
         intent: localizedIntent,
         fortitude: _dosLabel(fortDegree),
         tv,
      }),
      game.i18n.format("LL.Chat.ToleranceResult", {
         absorbed: result.absorbed,
         bled: result.bled,
      }),
   ]

   if (result.overdosed) {
      toxLines.push(game.i18n.localize("LL.Chat.OverdoseWarning"))
   }

   ChatMessage.create({
      content: toxLines.join("<br/>"),
      speaker: ChatMessage.getSpeaker({ actor }),
   })

   const stateAfterTox = getState(actor, drug.categoryId)
   const reachedStage1 = (Number(stateAfterTox[STATE.INTOX_STAGE]) ?? -1) >= 0

   if (drug.addictive) {
      await _runAddictionFlow(
         actor,
         item,
         category,
         drug,
         intent,
         reachedStage1,
      )
   }
}

async function _runAddictionFlow(
   actor,
   item,
   category,
   drug,
   intent,
   reachedStage1,
) {
   const state = getState(actor, drug.categoryId)
   const configuredWillDC = Number(category.chronic?.baseWillDC) || 0
   const willDC = configuredWillDC > 0 ? configuredWillDC : actorLevelBasedDC(actor)
   const quitPenalty = getQuitPenalty(actor, drug.categoryId)
   const itemTraits = item.system?.traits?.value ?? []
   const rollOptions = buildRollOptions(category, "addiction", itemTraits)

   const currentStage = Number(state[STATE.ADDICTION_STAGE]) || 0
   const stageCfg =
      currentStage > 0
         ? category.chronic?.addictionStages?.[currentStage - 1]
         : null
   const stageWillPenalty = Math.abs(Number(stageCfg?.willPenalty) || 0)

   const flavorParts = []
   let finalDC = willDC
   if (quitPenalty > 0) {
      finalDC += quitPenalty
      flavorParts.push(
         game.i18n.format("LL.Chat.GhostOfAddiction", { penalty: quitPenalty }),
      )
   }
   if (stageWillPenalty > 0) {
      finalDC += stageWillPenalty
      flavorParts.push(
         game.i18n.format("LL.Chat.AddictionStagePenalty", {
            penalty: stageWillPenalty,
            stage: stageCfg?.label ?? `Stage ${currentStage}`,
         }),
      )
   }

   const willDegree = await rollSave(
      actor,
      "will",
      finalDC,
      game.i18n.format("LL.Chat.AddictionSave", {
         itemName: item.name,
         dc: finalDC,
      }),
      null,
      rollOptions,
   )

   let apDelta = 0
   if (willDegree === DOS.CRITICAL_FAILURE)
      apDelta = Number(drug.apYieldCriticalFailure ?? 2)
   else if (willDegree === DOS.FAILURE)
      apDelta = Number(drug.apYieldFailure ?? 1)
   else if (willDegree === DOS.SUCCESS)
      apDelta = Number(drug.apYieldSuccess ?? 1)
   else if (willDegree === DOS.CRITICAL_SUCCESS)
      apDelta = Number(drug.apYieldCriticalSuccess ?? 0)

   if (isNaN(apDelta)) apDelta = 0

   if (apDelta !== 0) {
      await addAP(actor, drug.categoryId, apDelta, { drug })
   }

   const stateAfter = getState(actor, drug.categoryId)
   const stageAfter = Number(stateAfter[STATE.ADDICTION_STAGE]) || 0

   if (reachedStage1 && stageAfter > 0) {
      await refreshSatiation(actor, drug.categoryId, { drug, silent: true })
   }

   const flavorStr =
      flavorParts.length > 0 ? ` (${flavorParts.join(", ")})` : ""
   const content = await renderTemplate(
      `modules/${MODULE_ID}/templates/chat-addiction-check.hbs`,
      {
         categoryName: category.name,
         dosLabel: _dosLabel(willDegree),
         flavorStr,
         apDelta,
      },
   )

   ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
   })
}

function _yieldedTV(baseTV, fortDegree) {
   const tv = Number(baseTV) || 0
   if (tv <= 0) return 0
   switch (fortDegree) {
      case DOS.CRITICAL_SUCCESS:
         return 0
      case DOS.SUCCESS:
         return Math.max(1, Math.floor(tv / 2))
      case DOS.FAILURE:
         return tv
      case DOS.CRITICAL_FAILURE:
         return tv + Math.max(1, Math.floor(tv / 2))
      default:
         return tv
   }
}

function _dosLabel(degree) {
   return (
      {
         [DOS.CRITICAL_SUCCESS]: game.i18n.localize("LL.DOS.CritSuccess"),
         [DOS.SUCCESS]: game.i18n.localize("LL.DOS.Success"),
         [DOS.FAILURE]: game.i18n.localize("LL.DOS.Failure"),
         [DOS.CRITICAL_FAILURE]: game.i18n.localize("LL.DOS.CritFailure"),
      }[degree] || game.i18n.localize("LL.DOS.Unknown")
   )
}

function _hasActiveOverdose(actor, categoryId) {
   if (!actor?.items) return false
   return activePhases(actor, categoryId).includes(PHASE.OVERDOSE)
}

async function _applyEmbraceAdjustment(actor) {
   const effectData = {
      name: "Logan's Loophole — Embrace",
      type: "effect",
      img: "icons/svg/aura.svg",
      system: {
         slug: "ll-embrace-temp",
         description: { value: "" },
         tokenIcon: { show: false },
         duration: {
            value: -1,
            unit: "unlimited",
            sustained: false,
            expiry: null,
         },
         rules: [
            {
               key: "AdjustDegreeOfSuccess",
               selector: "fortitude",
               adjustment: { all: "one-degree-worse" },
            },
         ],
         traits: { value: [], rarity: "common" },
         level: { value: 1 },
      },
      flags: {
         [MODULE_ID]: { embraceTemp: true },
      },
   }
   try {
      const created = await actor.createEmbeddedDocuments("Item", [effectData], {
         logansLoophole: true,
         render: false,
      })
      return created?.[0]?.id ?? null
   } catch (err) {
      console.error(`${MODULE_ID} | failed to apply Embrace adjustment:`, err)
      return null
   }
}

async function _removeEmbraceAdjustment(actor, effectId) {
   if (!effectId || !actor?.items?.has(effectId)) return
   try {
      await actor.deleteEmbeddedDocuments("Item", [effectId], {
         logansLoophole: true,
         render: false,
      })
   } catch (err) {
      console.error(`${MODULE_ID} | failed to remove Embrace adjustment:`, err)
   }
}
