import { MODULE_ID, PHASE, STATE, DOS } from "../constants.mjs"
import {
   getCategory,
   intoxStageForToxicity,
   addictionStageConfig,
   buildRollOptions,
} from "../registry/registry.mjs"
import {
   getState,
   patchState,
   toSeconds,
   actorLevelBasedDC,
} from "../utils/state.mjs"
import { applyDamage } from "../utils/damage.mjs"
import { rollSave } from "../utils/saveRoller.mjs"
import { buildPhaseWrapper, removePhaseEffects } from "./factory.mjs"
import { playLifecycleSfx, SFX_KEYS } from "../utils/sfx.mjs"

export async function applyToxicity(
   actor,
   categoryId,
   item,
   drug,
   tvIn,
   itemTraits = [],
) {
   const category = getCategory(categoryId)
   if (!category) return
   const state = getState(actor, categoryId)
   const startTox = Number(state[STATE.TOXICITY]) || 0
   const startTol = Number(state[STATE.TOLERANCE]) || 0

   const absorbed = Math.min(tvIn, startTol)
   const bled = tvIn - absorbed
   const endTol = startTol - absorbed
   let endTox = startTox + bled

   const odThreshold = category.acute?.overdose?.threshold ?? 0
   const stages = category.acute?.intoxStages ?? []
   const maxStageTox = stages.length ? Math.max(...stages.map((s) => s.tox)) : 0
   const absoluteMax = odThreshold > 0 ? odThreshold : Math.max(1, maxStageTox)

   if (endTox > absoluteMax) endTox = absoluteMax

   let payloads = []
   const newStage = intoxStageForToxicity(category, endTox)
   const oldStage = Number(state[STATE.INTOX_STAGE]) ?? -1

   if (newStage > oldStage && oldStage !== -1) {
      for (let i = oldStage + 1; i <= newStage; i++) {
         if (stages[i]?.payload?.formula) {
            payloads.push({
               label: stages[i].label,
               payload: stages[i].payload,
            })
         }
      }
   } else if (newStage > -1 && oldStage === -1) {
      if (stages[newStage]?.payload?.formula) {
         payloads.push({
            label: stages[newStage].label,
            payload: stages[newStage].payload,
         })
      }
   }

   const overdosed =
      odThreshold > 0 && startTox < odThreshold && endTox >= odThreshold
   const hangThreshold = category.acute?.hangover?.threshold ?? 0
   let hangoverPending = !!state[STATE.HANGOVER_PENDING]
   if (category.acute?.hangover?.enabled && endTox >= hangThreshold)
      hangoverPending = true

   const nextStageCfg = newStage >= 0 ? stages[newStage] : null
   await patchState(actor, categoryId, {
      [STATE.TOXICITY]: endTox,
      [STATE.TOLERANCE]: endTol,
      [STATE.INTOX_STAGE]: newStage,
      [STATE.DECAY_NEXT]:
         endTox > 0 ? _scheduleNextDecay(nextStageCfg, game.time.worldTime) : 0,
      [STATE.HANGOVER_PENDING]: hangoverPending,
   })

   const intoxOptions = buildRollOptions(category, "intoxication", itemTraits)

   if (bled > 0 && drug.damagePerTv?.formula) {
      await applyDamage(
         actor,
         `${bled} * (${drug.damagePerTv.formula})`,
         drug.damagePerTv.damageType,
         `Direct damage (${bled} TV bled through)`,
         intoxOptions,
      )
   }

   for (const p of payloads) {
      await applyDamage(
         actor,
         p.payload.formula,
         p.payload.damageType,
         `${category.name} – ${p.label} damage`,
         intoxOptions,
      )
   }

   if (newStage !== oldStage) {
      await syncIntoxWrapper(actor, categoryId, category, newStage)
      await playLifecycleSfx(SFX_KEYS.INTOXICATION, drug)
   }

   if (overdosed) {
      await fireOverdose(actor, categoryId, category)
   }

   return { absorbed, bled, payloads, overdosed }
}

export async function refillTolerance(actor, categoryId) {
   const cat = getCategory(categoryId)
   if (!cat) return
   const state = getState(actor, categoryId)
   const stageNum = Number(state[STATE.ADDICTION_STAGE]) || 0
   const stageCfg = addictionStageConfig(cat, stageNum)

   let max = stageCfg?.maxTolerance ?? 0
   if (game.settings.get(MODULE_ID, "useConTolerance")) {
      const onlyAddicted = game.settings.get(
         MODULE_ID,
         "conToleranceAddictedOnly",
      )
      if (!onlyAddicted || stageNum > 0) {
         const conMod =
            actor.system?.abilities?.con?.mod ??
            actor.system?.attributes?.constitution?.modifier ??
            0
         if (conMod > 0) max += conMod
      }
   }

   await patchState(actor, categoryId, { [STATE.TOLERANCE]: max })
}

export async function fireHangover(actor, categoryId, category) {
   category = category || getCategory(categoryId)
   const hang = category?.acute?.hangover
   if (!hang?.enabled) return

   const dc = Number(hang.dc) > 0 ? Number(hang.dc) : actorLevelBasedDC(actor)
   const hangOptions = buildRollOptions(category, "hangover")

   const degree = await rollSave(
      actor,
      "fortitude",
      dc,
      `${category.name}: Hangover Save (DC ${dc})`,
      null,
      hangOptions,
   )

   await removePhaseEffects(actor, categoryId, PHASE.HANGOVER)

   if (degree === DOS.SUCCESS || degree === DOS.CRITICAL_SUCCESS) {
      ChatMessage.create({
         content: `<strong>${actor.name}</strong> successfully resisted the ${category.name} hangover.`,
         speaker: ChatMessage.getSpeaker({ actor }),
      })
      await patchState(actor, categoryId, { [STATE.HANGOVER_PENDING]: false })
      return
   }

   let branch = hang.failure
   if (degree === DOS.CRITICAL_FAILURE) branch = hang.criticalFailure

   const effects = branch?.effects ?? []
   if (effects.length > 0) {
      const severityStr =
         degree === DOS.CRITICAL_FAILURE
            ? game.i18n.localize("LL.DOS.CritFailure")
            : game.i18n.localize("LL.DOS.Failure")

      const wrapper = await buildPhaseWrapper({
         phase: PHASE.HANGOVER,
         categoryName: category.name,
         categoryId,
         label: game.i18n.format("LL.Phase.Hangover", {
            severity: severityStr,
         }),
         stageNum: 0,
         effects: effects,
         duration: hang.duration,
         img: category.img,
         description: hang.description,
      })
      await actor.createEmbeddedDocuments("Item", [wrapper], {
         logansLoophole: true,
      })
   }

   await patchState(actor, categoryId, { [STATE.HANGOVER_PENDING]: false })

   ChatMessage.create({
      content: `<strong>${actor.name}</strong> is suffering a ${category.name} hangover! (Fortitude: ${degree === DOS.CRITICAL_FAILURE ? "Crit Failure" : "Failure"})`,
      speaker: ChatMessage.getSpeaker({ actor }),
   })
}

export async function fireOverdose(actor, categoryId, category) {
   const od = category.acute?.overdose
   if (!od) return

   const dc = Number(od.dc) > 0 ? Number(od.dc) : actorLevelBasedDC(actor)
   const odOptions = buildRollOptions(category, "overdose")

   const degree = await rollSave(
      actor,
      "fortitude",
      dc,
      `${category.name}: Overdose Save (DC ${dc})`,
      null,
      odOptions,
   )

   const dosLabelMap = {
      [DOS.CRITICAL_SUCCESS]: "Crit Success",
      [DOS.SUCCESS]: "Success",
      [DOS.FAILURE]: "Failure",
      [DOS.CRITICAL_FAILURE]: "Crit Failure",
   }
   const label = dosLabelMap[degree] ?? "Unknown"

   let branch = od.criticalFailure
   if (degree === DOS.CRITICAL_SUCCESS) branch = od.criticalSuccess
   else if (degree === DOS.SUCCESS) branch = od.success
   else if (degree === DOS.FAILURE) branch = od.failure

   await removePhaseEffects(actor, categoryId, PHASE.OVERDOSE)

   if (
      (degree === DOS.SUCCESS || degree === DOS.CRITICAL_SUCCESS) &&
      branch?.reduceToxicity
   ) {
      const reduceAmt = Number(branch.reduceAmount) || 0
      if (reduceAmt > 0) {
         const state = getState(actor, categoryId)
         const currentTox = Number(state[STATE.TOXICITY]) || 0
         const newTox = Math.max(0, currentTox - reduceAmt)
         await patchState(actor, categoryId, { [STATE.TOXICITY]: newTox })
         ChatMessage.create({
            content: `<strong>${actor.name}</strong> recovered slightly, shedding ${reduceAmt} Toxicity.`,
            speaker: ChatMessage.getSpeaker({ actor }),
         })
      }
   }

   const effects = branch?.effects ?? []
   if (effects.length > 0) {
      const wrapper = await buildPhaseWrapper({
         phase: PHASE.OVERDOSE,
         categoryName: category.name,
         categoryId,
         label: game.i18n.localize("LL.Phase.Overdose"),
         stageNum: 0,
         effects: effects,
         duration: od.duration,
         img: category.img,
         description: od.description,
      })
      await actor.createEmbeddedDocuments("Item", [wrapper], {
         logansLoophole: true,
      })
   }

   if (branch?.payload?.formula && String(branch.payload.formula).trim()) {
      await applyDamage(
         actor,
         branch.payload.formula,
         branch.payload.damageType,
         `${category.name} – ${game.i18n.localize("LL.Chat.OverdoseDamage")}`,
         odOptions,
      )
   }

   const content = await renderTemplate(
      `modules/${MODULE_ID}/templates/chat-overdose.hbs`,
      {
         actorName: actor.name,
         categoryName: category.name,
         label,
      },
   )

   ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
   })
}

export async function syncIntoxWrapper(actor, categoryId, category, stageIdx) {
   await removePhaseEffects(actor, categoryId, PHASE.INTOXICATION)
   if (stageIdx < 0) return
   const stage = category.acute?.intoxStages?.[stageIdx]
   if (!stage) return
   const wrapper = await buildPhaseWrapper({
      phase: PHASE.INTOXICATION,
      categoryName: category.name,
      categoryId,
      label: game.i18n.format("LL.Phase.Intoxication", {
         stageName: stage.label,
      }),
      stageNum: stageIdx + 1,
      effects: stage.effects ?? [],
      duration: null,
      img: category.img,
      description: stage.description,
   })
   await actor.createEmbeddedDocuments("Item", [wrapper], {
      logansLoophole: true,
   })
}

function _scheduleNextDecay(stageCfg, now) {
   if (!stageCfg) return 0
   const per = stageCfg.decay?.per || { value: 1, unit: "hours" }
   const sec = toSeconds(per)
   return now + Math.max(60, sec)
}
