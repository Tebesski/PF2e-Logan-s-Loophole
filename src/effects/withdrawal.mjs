import { MODULE_ID, PHASE, STATE, SATIATION_KIND } from "../constants.mjs"
import {
   getCategory,
   addictionStageConfig,
   stageForAP,
   apThresholdForStage,
   maxAddictionStage,
} from "../registry/registry.mjs"
import { getState, patchState, toSeconds } from "../utils/state.mjs"
import { buildPhaseWrapper, removePhaseEffects } from "./factory.mjs"
import { playLifecycleSfx, SFX_KEYS } from "../utils/sfx.mjs"

export async function addAP(
   actor,
   categoryId,
   delta,
   { drug = null, silent = false } = {},
) {
   const category = getCategory(categoryId)
   if (!category) return { oldAP: 0, newAP: 0, oldStage: 0, newStage: 0 }

   const state = getState(actor, categoryId)
   const oldAP = Number(state[STATE.ADDICTION_POINTS]) || 0

   const oldStage = Number(state[STATE.ADDICTION_STAGE]) || 0
   const oldPeak = Number(state[STATE.PEAK_STAGE]) || 0

   const newAP = Math.max(0, oldAP + (Number(delta) || 0))
   const newStage = stageForAP(category, newAP)
   const newPeak = Math.max(oldPeak, newStage)

   let maxTol = 0
   if (newStage > 0) {
      maxTol = addictionStageConfig(category, newStage)?.maxTolerance ?? 0
   }
   if (game.settings.get(MODULE_ID, "useConTolerance")) {
      const conMod = actor.system?.abilities?.con?.mod ?? 0
      maxTol += Math.max(0, conMod)
   }
   const currentTol = Number(state[STATE.TOLERANCE]) || 0
   const clampedTol = Math.min(currentTol, maxTol)

   const patch = {
      [STATE.ADDICTION_POINTS]: newAP,
      [STATE.ADDICTION_STAGE]: newStage,
      [STATE.PEAK_STAGE]: newPeak,
      [STATE.CATEGORY_NAME]: category.name,
      [STATE.CATEGORY_IMG]: category.img,
      [STATE.TOLERANCE]: clampedTol,
   }
   await patchState(actor, categoryId, patch)

   if (newStage > oldStage) {
      await syncChronicWrapper(actor, categoryId, category, newStage)

      if (!silent) {
         ChatMessage.create({
            content: `<strong>${actor.name}</strong> sinks deeper into <strong>${category.name}</strong> addiction (${addictionStageConfig(category, newStage)?.label ?? `Stage ${newStage}`}).`,
            speaker: ChatMessage.getSpeaker({ actor }),
         })
         await playLifecycleSfx(SFX_KEYS.ADDICTION, drug)
      }
   } else if (newStage < oldStage) {
      if (newStage > 0) {
         await syncChronicWrapper(actor, categoryId, category, newStage)
         if (!silent) {
            ChatMessage.create({
               content: `<strong>${actor.name}</strong> recovers a step from <strong>${category.name}</strong> (now ${addictionStageConfig(category, newStage)?.label ?? `Stage ${newStage}`}).`,
               speaker: ChatMessage.getSpeaker({ actor }),
            })
         }
      }
      if (!silent) await playLifecycleSfx(SFX_KEYS.CURE, null)
   }

   if (newAP === 0 && oldAP > 0) {
      await _onFullCure(actor, categoryId, category, newPeak, silent)
   }

   return { oldAP, newAP, oldStage, newStage }
}

export async function refreshSatiation(
   actor,
   categoryId,
   { drug = null, silent = false } = {},
) {
   const category = getCategory(categoryId)
   if (!category) return
   const state = getState(actor, categoryId)
   const stageNum = Number(state[STATE.ADDICTION_STAGE]) || 0
   if (stageNum <= 0) return
   const stageCfg = addictionStageConfig(category, stageNum)
   if (!stageCfg) return
   const sec = toSeconds(stageCfg.satiation)
   if (sec <= 0) return

   const apDecaySec = toSeconds(stageCfg.apDecayPer)

   await patchState(actor, categoryId, {
      [STATE.SATIATION_END]: game.time.worldTime + sec,
      [STATE.SATIATION_KIND]: SATIATION_KIND.REAL,
      [STATE.AP_DECAY_PAUSE_END]: game.time.worldTime + apDecaySec,
      [STATE.AP_DECAY_NEXT]: game.time.worldTime + apDecaySec,
      [STATE.WITHDRAWAL_STAGE]: 0,
   })
   await removePhaseEffects(actor, categoryId, PHASE.WITHDRAWAL)

   if (!silent) await playLifecycleSfx(SFX_KEYS.SATIATION, drug)
}

export async function triggerWithdrawal(
   actor,
   categoryId,
   { silent = false } = {},
) {
   const category = getCategory(categoryId)
   if (!category) return
   const state = getState(actor, categoryId)
   const stageNum = Number(state[STATE.ADDICTION_STAGE]) || 0
   if (stageNum <= 0) return

   await patchState(actor, categoryId, {
      [STATE.WITHDRAWAL_STAGE]: stageNum,
   })
   await syncWithdrawalWrapper(actor, categoryId, category, stageNum)

   if (!silent) {
      await playLifecycleSfx(SFX_KEYS.WITHDRAWAL, null)
      ChatMessage.create({
         content: `<strong>${actor.name}</strong> enters withdrawal from <strong>${category.name}</strong>.`,
         speaker: ChatMessage.getSpeaker({ actor }),
      })
   }
}

export async function setAddictionStage(
   actor,
   categoryId,
   newStage,
   { silent = false } = {},
) {
   const category = getCategory(categoryId)
   if (!category) return
   const max = maxAddictionStage(category)
   const clamped = Math.max(0, Math.min(max, Number(newStage) || 0))
   if (clamped === 0) {
      const state = getState(actor, categoryId)
      const oldAP = Number(state[STATE.ADDICTION_POINTS]) || 0
      if (oldAP > 0) {
         await addAP(actor, categoryId, -oldAP, { silent })
      }
      return
   }
   const targetAP = apThresholdForStage(category, clamped) ?? 0
   const state = getState(actor, categoryId)
   const currentAP = Number(state[STATE.ADDICTION_POINTS]) || 0
   const delta = targetAP - currentAP
   if (delta !== 0) await addAP(actor, categoryId, delta, { silent })
}

export function getQuitPenalty(actor, categoryId) {
   const category = getCategory(categoryId)
   if (!category) return 0
   const state = getState(actor, categoryId)
   const peak = Number(state[STATE.PEAK_STAGE]) || 0
   const currentStage = Number(state[STATE.ADDICTION_STAGE]) || 0
   if (currentStage > 0 || peak <= 0) return 0
   const cfg = addictionStageConfig(category, peak)
   const raw = cfg ? Number(cfg.quitPenalty) || 0 : 0
   return Math.abs(raw)
}

async function _onFullCure(
   actor,
   categoryId,
   category,
   peakStage,
   silent = false,
) {
   await removePhaseEffects(actor, categoryId, PHASE.PERMANENT)
   await removePhaseEffects(actor, categoryId, PHASE.WITHDRAWAL)
   await patchState(actor, categoryId, {
      [STATE.ADDICTION_POINTS]: 0,
      [STATE.ADDICTION_STAGE]: 0,
      [STATE.WITHDRAWAL_STAGE]: 0,
      [STATE.SATIATION_END]: 0,
      [STATE.SATIATION_KIND]: "",
      [STATE.AP_DECAY_PAUSE_END]: 0,
      [STATE.AP_DECAY_NEXT]: 0,
   })

   if (!silent) {
      const cfg = addictionStageConfig(category, peakStage)
      const penalty = cfg ? Math.abs(Number(cfg.quitPenalty) || 0) : 0
      const penaltyText = penalty
         ? ` Their peak addiction (${cfg.label}) leaves a lingering +${penalty} DC to future Addiction saves vs ${category.name}.`
         : ""
      ChatMessage.create({
         content: `<strong>${actor.name}</strong> has fully cured their <strong>${category.name}</strong> addiction.${penaltyText}`,
         speaker: ChatMessage.getSpeaker({ actor }),
      })
   }
}

export async function syncChronicWrapper(
   actor,
   categoryId,
   category,
   stageNum,
) {
   await removePhaseEffects(actor, categoryId, PHASE.PERMANENT)
   const stageCfg = addictionStageConfig(category, stageNum)
   if (!stageCfg) return

   const effects = []
   for (let i = 1; i <= stageNum; i++) {
      const cfg = addictionStageConfig(category, i)
      if (cfg?.chronicEffects) effects.push(...cfg.chronicEffects)
   }
   if (!effects.length) return

   const wrapper = await buildPhaseWrapper({
      phase: PHASE.PERMANENT,
      categoryName: category.name,
      categoryId,
      label: game.i18n.format("LL.Phase.Permanent", {
         stageName: stageCfg.label,
      }),
      stageNum,
      effects,
      duration: null,
      img: category.img,
      description: stageCfg.description,
   })
   await actor.createEmbeddedDocuments("Item", [wrapper], {
      logansLoophole: true,
   })
}

export async function syncWithdrawalWrapper(
   actor,
   categoryId,
   category,
   stageNum,
) {
   await removePhaseEffects(actor, categoryId, PHASE.WITHDRAWAL)
   const stageCfg = addictionStageConfig(category, stageNum)
   if (!stageCfg) return

   const effects = []
   for (let i = 1; i <= stageNum; i++) {
      const cfg = addictionStageConfig(category, i)
      if (cfg?.withdrawalEffects) effects.push(...cfg.withdrawalEffects)
   }
   if (!effects.length) return

   const wrapper = await buildPhaseWrapper({
      phase: PHASE.WITHDRAWAL,
      categoryName: category.name,
      categoryId,
      label: game.i18n.format("LL.Phase.Withdrawal", {
         stageName: stageCfg.label,
      }),
      stageNum,
      effects,
      duration: null,
      img: category.img,
      description: stageCfg.description,
   })
   await actor.createEmbeddedDocuments("Item", [wrapper], {
      logansLoophole: true,
   })
}
