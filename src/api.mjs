import {
   MODULE_ID,
   STATE,
   DOS,
   PHASE,
   TIME_UNIT,
   IMMUNITY_ASPECTS,
   SATIATION_KIND,
} from "./constants.mjs"
import {
   getCategory,
   listCategories,
   intoxStageForToxicity,
   addictionStageConfig,
   buildRollOptions,
} from "./registry/registry.mjs"
import {
   getState,
   patchState,
   clearState,
   getStateMap,
   toSeconds,
   isFutureTimestamp,
} from "./utils/state.mjs"
import { rollSave, shiftDegree } from "./utils/saveRoller.mjs"
import { applyDamage } from "./utils/damage.mjs"
import {
   applyToxicity,
   refillTolerance,
   fireHangover,
   fireOverdose,
   syncIntoxWrapper,
} from "./effects/engine.mjs"
import {
   addAP,
   refreshSatiation,
   triggerWithdrawal,
   setAddictionStage,
   getQuitPenalty,
   syncChronicWrapper,
   syncWithdrawalWrapper,
} from "./effects/withdrawal.mjs"
import { removePhaseEffects } from "./effects/factory.mjs"
import { onConsumeItem } from "./hooks/consumeItem.mjs"

export const api = {
   listCategories,
   getCategory,
   getState,
   getStateMap,
   getQuitPenalty,
   rollSave,
   shiftDegree,
   patchState,
   removePhaseEffects,
   STATE,
   PHASE,
   DOS,
   SATIATION_KIND,

   async setToxicity(actor, categoryId, value) {
      const cat = getCategory(categoryId)
      if (!cat) return
      const state = getState(actor, categoryId)
      const oldTox = Number(state[STATE.TOXICITY]) || 0
      const oldStage =
         state[STATE.INTOX_STAGE] !== undefined &&
         state[STATE.INTOX_STAGE] !== null
            ? Number(state[STATE.INTOX_STAGE])
            : -1

      const odThreshold = cat.acute?.overdose?.threshold ?? 0
      let tox = Number(value) || 0
      if (odThreshold > 0 && tox > odThreshold) tox = odThreshold
      tox = Math.max(0, tox)

      const newStage = intoxStageForToxicity(cat, tox)

      const stageCfg = cat.acute?.intoxStages?.[newStage]
      const perSec = Math.max(
         60,
         toSeconds(stageCfg?.decay?.per || cat.acute?.decay?.per),
      )
      const rawDecay = state[STATE.DECAY_NEXT]
      const decayNext = Number(rawDecay) || 0

      let nextDecayTime = decayNext
      if (tox > 0 && !decayNext) {
         nextDecayTime = game.time.worldTime + perSec
      } else if (tox === 0) {
         nextDecayTime = 0
      }

      const hangThreshold = cat.acute?.hangover?.threshold ?? 0
      let hangoverPending = !!state[STATE.HANGOVER_PENDING]
      if (cat.acute?.hangover?.enabled && tox >= hangThreshold) {
         hangoverPending = true
      }

      await patchState(actor, categoryId, {
         [STATE.TOXICITY]: tox,
         [STATE.INTOX_STAGE]: newStage,
         [STATE.DECAY_NEXT]: nextDecayTime,
         [STATE.HANGOVER_PENDING]: hangoverPending,
      })

      if (newStage !== oldStage) {
         await syncIntoxWrapper(actor, categoryId, cat, newStage)
      }

      if (newStage > oldStage) {
         const stages = cat.acute?.intoxStages ?? []
         const intoxOptions = buildRollOptions(cat, "intoxication")
         const startIdx = oldStage < 0 ? newStage : oldStage + 1
         for (let i = startIdx; i <= newStage; i++) {
            const stg = stages[i]
            if (stg?.payload?.formula && String(stg.payload.formula).trim()) {
               await applyDamage(
                  actor,
                  stg.payload.formula,
                  stg.payload.damageType,
                  `${cat.name} – ${stg.label} damage`,
                  intoxOptions,
               )
            }
         }
      }

      const addictionStage = Number(state[STATE.ADDICTION_STAGE]) || 0
      if (tox > oldTox && newStage >= 0 && addictionStage > 0) {
         await refreshSatiation(actor, categoryId, { silent: true })
      }

      if (odThreshold > 0) {
         if (oldTox < odThreshold && tox >= odThreshold) {
            await fireOverdose(actor, categoryId, cat)
         } else if (oldTox >= odThreshold && tox < odThreshold) {
            await removePhaseEffects(actor, categoryId, PHASE.OVERDOSE)
         }
      }

      if (tox === 0 && oldTox > 0 && hangoverPending) {
         await fireHangover(actor, categoryId)
      }
   },

   async setTolerance(actor, categoryId, value) {
      const cat = getCategory(categoryId)
      if (!cat) return
      const state = getState(actor, categoryId)
      const stage = Number(state[STATE.ADDICTION_STAGE]) || 0
      const cfg = addictionStageConfig(cat, stage)

      let max = cfg?.maxTolerance ?? 0
      if (game.settings.get(MODULE_ID, "useConTolerance")) {
         const onlyAddicted = game.settings.get(
            MODULE_ID,
            "conToleranceAddictedOnly",
         )
         if (!onlyAddicted || stage > 0) {
            const conMod =
               actor.system?.abilities?.con?.mod ??
               actor.system?.attributes?.constitution?.modifier ??
               0
            if (conMod > 0) max += conMod
         }
      }

      const clamped = Math.min(max, Math.max(0, Number(value) || 0))
      await patchState(actor, categoryId, { [STATE.TOLERANCE]: clamped })
   },

   refillTolerance,
   fireHangover,
   addAP,

   async setAP(actor, categoryId, value) {
      const cat = getCategory(categoryId)
      if (!cat) return
      const stages = cat.chronic?.addictionStages ?? []
      const maxAP =
         stages.length > 0
            ? Number(stages[stages.length - 1].apThreshold)
            : Infinity

      const state = getState(actor, categoryId)
      const current = Number(state[STATE.ADDICTION_POINTS]) || 0

      const target = Math.max(0, Math.min(Number(value) || 0, maxAP))
      const delta = target - current
      if (delta !== 0) {
         const { oldStage, newStage } = await addAP(actor, categoryId, delta, {
            silent: true,
         })
         const stateAfter = getState(actor, categoryId)
         const now = game.time.worldTime

         const rawSat = stateAfter[STATE.SATIATION_END]
         const isSatiated = isFutureTimestamp(rawSat, now)
         const withdrawalStage = Number(stateAfter[STATE.WITHDRAWAL_STAGE]) || 0
         const rawApDecay = stateAfter[STATE.AP_DECAY_NEXT]

         if (target > 0) {
            if (
               newStage > 0 &&
               !isSatiated &&
               (newStage !== oldStage || withdrawalStage !== newStage)
            ) {
               await triggerWithdrawal(actor, categoryId, { silent: true })
            } else if (newStage === 0 && oldStage > 0) {
               await patchState(actor, categoryId, {
                  [STATE.WITHDRAWAL_STAGE]: 0,
               })
               await removePhaseEffects(actor, categoryId, PHASE.WITHDRAWAL)
            }

            if (!isSatiated && !(Number(rawApDecay) || 0)) {
               const effectiveStage = Math.max(1, newStage)
               const stgCfg = addictionStageConfig(cat, effectiveStage)
               if (stgCfg) {
                  const perSec = Math.max(60, toSeconds(stgCfg?.apDecayPer))
                  await patchState(actor, categoryId, {
                     [STATE.AP_DECAY_NEXT]: now + perSec,
                  })
               }
            }
         } else {
            await patchState(actor, categoryId, {
               [STATE.AP_DECAY_NEXT]: 0,
               [STATE.WITHDRAWAL_STAGE]: 0,
            })
            await removePhaseEffects(actor, categoryId, PHASE.WITHDRAWAL)
         }
      }
   },

   forceStage: (actor, categoryId, stage) =>
      setAddictionStage(actor, categoryId, stage, { silent: true }),
   forceSatiate: (actor, categoryId) =>
      refreshSatiation(actor, categoryId, { silent: true }),
   async fakeSatiate(actor, categoryId, seconds) {
      const sec = Math.max(0, Number(seconds) || 0)
      if (sec <= 0) return
      await patchState(actor, categoryId, {
         [STATE.SATIATION_END]: game.time.worldTime + sec,
         [STATE.SATIATION_KIND]: SATIATION_KIND.FAKE,
         [STATE.WITHDRAWAL_STAGE]: 0,
      })
      await removePhaseEffects(actor, categoryId, PHASE.WITHDRAWAL)
   },
   async forceUnsatiate(actor, categoryId) {
      await patchState(actor, categoryId, {
         [STATE.SATIATION_END]: 0,
         [STATE.SATIATION_KIND]: "",
         [STATE.AP_DECAY_PAUSE_END]: 0,
      })
      await triggerWithdrawal(actor, categoryId, { silent: true })
   },

   async injectTV(actor, categoryId, tv, drugConfig = {}) {
      const fakeItem = { name: drugConfig.name ?? "Manual Injection" }
      return applyToxicity(
         actor,
         categoryId,
         fakeItem,
         drugConfig,
         Number(tv) || 0,
      )
   },

   async cure(actor, categoryId) {
      await removePhaseEffects(actor, categoryId, null)
      await clearState(actor, categoryId)
   },

   async curePenalty(actor, categoryId) {
      await patchState(actor, categoryId, { [STATE.PEAK_STAGE]: 0 })
   },

   async cureHangover(actor, categoryId) {
      await patchState(actor, categoryId, { [STATE.HANGOVER_PENDING]: false })
      await removePhaseEffects(actor, categoryId, PHASE.HANGOVER)
   },

   async cureOverdose(actor, categoryId) {
      await removePhaseEffects(actor, categoryId, PHASE.OVERDOSE)
      const cat = getCategory(categoryId)
      const state = getState(actor, categoryId)
      const current = Number(state[STATE.TOXICITY]) || 0
      const odThreshold = cat?.acute?.overdose?.threshold ?? 0

      let newTox = Math.max(0, current - 1)
      if (odThreshold > 0 && newTox >= odThreshold) {
         newTox = odThreshold - 1
      }
      await this.setToxicity(actor, categoryId, newTox)
   },

   async cleanseAddictions(actor) {
      if (!actor) return
      const wrapperIds = new Set(
         actor.items
            .filter((i) => i.flags?.[MODULE_ID]?.managed)
            .map((i) => i.id),
      )
      const map = getStateMap(actor)
      const categoryIds = Object.keys(map ?? {})
      for (const categoryId of categoryIds)
         await removePhaseEffects(actor, categoryId, null)

      const orphanGrants = actor.items
         .filter((i) => {
            const grantedBy = i.flags?.pf2e?.grantedBy
            if (!grantedBy) return false
            const granterId =
               typeof grantedBy === "string" ? grantedBy : grantedBy.id
            return wrapperIds.has(granterId)
         })
         .map((i) => i.id)
         .filter((id) => actor.items.has(id))
      if (orphanGrants.length)
         await actor.deleteEmbeddedDocuments("Item", orphanGrants, {
            logansLoophole: true,
         })

      const remainingManaged = actor.items
         .filter((i) => i.flags?.[MODULE_ID]?.managed)
         .map((i) => i.id)
         .filter((id) => actor.items.has(id))
      if (remainingManaged.length)
         await actor.deleteEmbeddedDocuments("Item", remainingManaged, {
            logansLoophole: true,
         })

      for (const categoryId of categoryIds) await clearState(actor, categoryId)
      await actor.update({
         [`flags.${MODULE_ID}`]: new foundry.data.operators.ForcedDeletion(),
      })

      ChatMessage.create({
         content: `<strong>${actor.name}</strong> has been cleansed of all addictions.`,
         speaker: ChatMessage.getSpeaker({ actor }),
      })
   },

   async syncEffects(actor, categoryId) {
      const cat = getCategory(categoryId)
      if (!cat) return
      const state = getState(actor, categoryId)

      await removePhaseEffects(actor, categoryId, null)

      const stage = Number(state[STATE.ADDICTION_STAGE]) || 0
      if (stage > 0) await syncChronicWrapper(actor, categoryId, cat, stage)

      const withdrawalStage = Number(state[STATE.WITHDRAWAL_STAGE]) || 0
      if (withdrawalStage > 0)
         await syncWithdrawalWrapper(actor, categoryId, cat, withdrawalStage)

      const intoxStage =
         state[STATE.INTOX_STAGE] !== undefined
            ? Number(state[STATE.INTOX_STAGE])
            : -1
      if (intoxStage >= 0)
         await syncIntoxWrapper(actor, categoryId, cat, intoxStage)

      const tox = Number(state[STATE.TOXICITY]) || 0
      const odThreshold = cat.acute?.overdose?.threshold ?? 0
      if (odThreshold > 0 && tox >= odThreshold) {
         await fireOverdose(actor, categoryId, cat)
      }
   },

   consumeItem: onConsumeItem,

   async manageImmunitiesDialog(actor, categoryId) {
      const cat = getCategory(categoryId)
      if (!cat) return

      const allImmunities = actor.getFlag(MODULE_ID, "immunity") || {}
      const isSeparate = game.settings.get(
         MODULE_ID,
         "separateAddictionImmunities",
      )

      const catImm = {}
      if (isSeparate) {
         Object.assign(catImm, allImmunities[categoryId] || {})
      } else {
         for (const catObj of Object.values(allImmunities)) {
            for (const [asp, expireTime] of Object.entries(catObj || {})) {
               if (typeof expireTime === "number") {
                  if (catImm[asp] === undefined || expireTime > catImm[asp]) {
                     catImm[asp] = expireTime
                  }
               }
            }
         }
      }

      const now = game.time.worldTime

      const generalAspects = IMMUNITY_ASPECTS.filter(
         (asp) => !game.settings.get(MODULE_ID, `immunityToggle_${asp}`),
      )
      const specificAspects = IMMUNITY_ASPECTS.filter((asp) =>
         game.settings.get(MODULE_ID, `immunityToggle_${asp}`),
      )

      const instructionStr = game.i18n.localize("LL.Immunity.Instruction")
      let content = `<form id="ll-manage-imm-form" style="margin-bottom: 0.5em;"><p>${instructionStr}</p>`

      if (generalAspects.length > 0) {
         let maxExpire = -Infinity
         generalAspects.forEach((asp) => {
            const expire = catImm[asp]
            if (typeof expire === "number" && expire > maxExpire) {
               maxExpire = expire
            }
         })

         const isImmune = maxExpire > now
         const noneStr = game.i18n.localize("LL.Immunity.NoneState")

         let status = isImmune
            ? `<span style="color: green;">${game.i18n.format("LL.Immunity.ExpiresIn", { hours: Math.ceil((maxExpire - now) / 3600) })}</span>`
            : `<span style="color: gray;">${noneStr}</span>`

         const genLabel = game.i18n.localize("LL.Immunity.General")
         content += `
            <div class="form-group" style="display:flex; align-items:center; gap: 0.5em; margin-bottom: 0.4em; padding-bottom: 0.4em; border-bottom: 1px solid var(--color-border-light-tertiary);">
               <input type="checkbox" id="imm-general" name="general" ${isImmune ? "checked" : ""} />
               <label for="imm-general"><strong>${genLabel}</strong> ${status}</label>
            </div>
         `
      }

      specificAspects.forEach((asp) => {
         const aspectCap = asp.charAt(0).toUpperCase() + asp.slice(1)
         const label =
            game.i18n.localize(`LL.Immunity.Aspect${aspectCap}`) || aspectCap

         const expire = catImm[asp]
         const isImmune = typeof expire === "number" && expire > now
         const noneStr = game.i18n.localize("LL.Immunity.NoneState")

         let status = isImmune
            ? `<span style="color: green;">${game.i18n.format("LL.Immunity.ExpiresIn", { hours: Math.ceil((expire - now) / 3600) })}</span>`
            : `<span style="color: gray;">${noneStr}</span>`

         content += `
            <div class="form-group" style="display:flex; align-items:center; gap: 0.5em; margin-bottom: 0.4em;">
               <input type="checkbox" id="imm-${asp}" name="${asp}" ${isImmune ? "checked" : ""} />
               <label for="imm-${asp}"><strong>${label}</strong> ${status}</label>
            </div>
         `
      })

      content += `</form>`

      const titleStr = game.i18n.format("LL.Immunity.DialogTitle", {
         actorName: actor.name,
         categoryName: cat.name,
      })
      const saveLabel = game.i18n.localize("LL.Immunity.Save")

      foundry.applications.api.DialogV2.wait({
         window: { title: titleStr },
         classes: ["logans-loophole", "dialog"],
         content,
         buttons: [
            {
               action: "save",
               label: saveLabel,
               icon: "fas fa-save",
               default: true,
               callback: async (event, button, dialog) => {
                  const html = $(dialog.element)
                  const baseHours =
                     game.settings.get(MODULE_ID, "treatmentImmunityHours") ||
                     24
                  const updateData = {}
                  const toSet = {}

                  if (
                     generalAspects.length > 0 &&
                     html.find(`#imm-general`).is(":checked")
                  ) {
                     generalAspects.forEach(
                        (asp) => (toSet[asp] = now + baseHours * 3600),
                     )
                  }

                  specificAspects.forEach((asp) => {
                     if (html.find(`#imm-${asp}`).is(":checked")) {
                        const specHours =
                           game.settings.get(
                              MODULE_ID,
                              `immunityHours_${asp}`,
                           ) || 24
                        toSet[asp] = now + specHours * 3600
                     }
                  })

                  const targetIds = isSeparate
                     ? [categoryId]
                     : Object.keys(getStateMap(actor))

                  targetIds.forEach((tId) => {
                     IMMUNITY_ASPECTS.forEach((asp) => {
                        if (typeof toSet[asp] === "number") {
                           updateData[
                              `flags.${MODULE_ID}.immunity.${tId}.${asp}`
                           ] = toSet[asp]
                        } else {
                           updateData[
                              `flags.${MODULE_ID}.immunity.${tId}.${asp}`
                           ] = new foundry.data.operators.ForcedDeletion()
                        }
                     })

                     const catImmForTarget = allImmunities[tId] || {}
                     for (const [key, val] of Object.entries(catImmForTarget)) {
                        if (typeof val !== "number") {
                           updateData[
                              `flags.${MODULE_ID}.immunity.${tId}.${key}`
                           ] = new foundry.data.operators.ForcedDeletion()
                        }
                     }
                  })

                  await actor.update(updateData)
               },
            },
         ],
      })
   },

   async openTreatmentDialog(medic, patient) {
      if (!medic || !patient) {
         ui.notifications?.warn(
            "You must select a medic token and target a patient token.",
         )
         return
      }
      if (!medic.skills?.medicine) {
         ui.notifications?.warn(`${medic.name} lacks the Medicine skill.`)
         return
      }

      const kitReq =
         game.settings.get(MODULE_ID, "treatmentKitRequirement") || "none"
      let kitItem = null
      if (kitReq !== "none") {
         const infUuid =
            "Compendium.pf2e-logans-loophole.logans-loophole-items.Item.AcLY4Y5S1ZNADc1m"
         const consUuid =
            "Compendium.pf2e-logans-loophole.logans-loophole-items.Item.I9ce7GNdTPfpoRJZ"

         kitItem = medic.items.find(
            (i) =>
               i.sourceId === infUuid ||
               i.sourceId === consUuid ||
               i.flags?.core?.sourceId === infUuid ||
               i.flags?.core?.sourceId === consUuid,
         )

         if (!kitItem) {
            ui.notifications?.warn(
               `${medic.name} requires an Addiction Treatment Kit in their inventory to perform this action.`,
            )
            return
         }

         if (
            kitReq === "consumable" &&
            (kitItem.system?.uses?.value || 0) <= 0
         ) {
            ui.notifications?.warn(
               `${medic.name}'s Addiction Treatment Kit is out of charges.`,
            )
            return
         }
      }

      const map = getStateMap(patient)
      const categories = Object.keys(map)
         .map((id) => ({ id, cat: getCategory(id) }))
         .filter((c) => c.cat)
      if (!categories.length) {
         ui.notifications?.info(
            `${patient.name} has no tracked addictions to treat.`,
         )
         return
      }

      const timeUnitsHTML = Object.keys(TIME_UNIT)
         .map((u) => `<option value="${u}">${u}</option>`)
         .join("")

      const content = `
         <style>
            #ll-treat-form .form-group { margin-bottom: 0.8em; }
            #ll-treat-form select, #ll-treat-form input { width: 100%; box-sizing: border-box; }
            #ll-treat-dynamic { padding: 0.5em; background: rgba(0,0,0,0.05); border-radius: 4px; border: 1px solid var(--color-border-light-primary); }
         </style>
         <form id="ll-treat-form">
            <div class="form-group">
               <label><strong>Target Addiction:</strong></label>
               <select id="ll-treat-cat">
                  ${categories.map((c) => `<option value="${c.id}">${c.cat.name}</option>`).join("")}
               </select>
            </div>
            <div class="form-group">
               <label><strong>Condition to Treat:</strong></label>
               <select id="ll-treat-type">
                  <option value="addiction">Addiction (AP Reduction)</option>
                  <option value="withdrawal">Withdrawal (Forced Satiation)</option>
                  <option value="hangover">Hangover</option>
                  <option value="intoxication">Intoxication</option>
                  <option value="overdose">Overdose</option>
               </select>
            </div>
            <div class="form-group">
               <label><strong>Medicine Check DC:</strong></label>
               <input type="number" id="ll-treat-dc" value="15" />
            </div>
            <div id="ll-treat-dynamic"></div>
         </form>
      `

      const TreatmentDialog = class extends foundry.applications.api.DialogV2 {
         _onRender(context, options) {
            super._onRender(context, options)
            const html = $(this.element)
            const catSelect = html.find("#ll-treat-cat")
            const typeSelect = html.find("#ll-treat-type")
            const dcInput = html.find("#ll-treat-dc")
            const dynDiv = html.find("#ll-treat-dynamic")

            const getCat = () =>
               categories.find((c) => c.id === catSelect.val())?.cat

            const updateUI = () => {
               const cat = getCat()
               const type = typeSelect.val()
               if (!cat) return

               let dc = 15
               let dynHTML = ""

               if (type === "addiction") {
                  dc = cat.chronic?.baseWillDC ?? 15
                  dynHTML = `<label>Reduce AP by:</label><input type="number" id="ll-ap-drop" value="1" min="1"/>`
               } else if (type === "withdrawal" || type === "intoxication") {
                  dc = cat.chronic?.baseWillDC ?? 15
                  if (type === "withdrawal") {
                     dynHTML = `
                        <label>Satiate for:</label>
                        <div style="display:flex; gap:0.25em;">
                           <input type="number" id="ll-with-time" value="1" min="1"/>
                           <select id="ll-with-unit">${timeUnitsHTML}</select>
                        </div>`
                  } else {
                     dynHTML = `
                        <div style="display: flex; gap: 1em; align-items: center; margin-bottom: 0.6em;">
                           <label style="display: flex; align-items: center; gap: 0.3em; cursor: pointer;">
                              <input type="radio" name="ll-intox-method" value="time" checked> Reduce Decay Time
                           </label>
                           <label style="display: flex; align-items: center; gap: 0.3em; cursor: pointer;">
                              <input type="radio" name="ll-intox-method" value="stage"> Reduce Stage
                           </label>
                        </div>
                        <div id="ll-intox-time-opts" style="display:flex; gap:0.25em;">
                           <input type="number" id="ll-intox-time" value="1" min="1"/>
                           <select id="ll-intox-unit">${timeUnitsHTML}</select>
                        </div>`
                  }
               } else if (type === "hangover") {
                  dc = cat.acute?.hangover?.dc ?? 15
                  dynHTML = `
                     <label>Reduce Hangover duration by:</label>
                     <div style="display:flex; gap:0.25em;">
                        <input type="number" id="ll-hang-time" value="1" min="1"/>
                        <select id="ll-hang-unit">${timeUnitsHTML}</select>
                     </div>`
               } else if (type === "overdose") {
                  dc = cat.acute?.overdose?.dc ?? 15
                  dynHTML = `<em>On success, the overdose phase wrapper and its immediate lockdown are removed.</em>`
               }

               dcInput.val(dc)
               dynDiv.html(dynHTML)

               html
                  .find("input[name='ll-intox-method']")
                  .on("change", function () {
                     if ($(this).val() === "stage")
                        html.find("#ll-intox-time-opts").hide()
                     else html.find("#ll-intox-time-opts").show()
                  })
            }

            catSelect.on("change", updateUI)
            typeSelect.on("change", updateUI)
            updateUI()
         }
      }

      new TreatmentDialog({
         window: { title: `Treat Patient: ${patient.name}` },
         classes: ["logans-loophole", "dialog"],
         content,
         buttons: [
            {
               action: "treat",
               label: "Administer Treatment",
               icon: "fas fa-medkit",
               default: true,
               callback: async (event, button, dialog) => {
                  const html = $(dialog.element)
                  const catId = html.find("#ll-treat-cat").val()
                  const type = html.find("#ll-treat-type").val()
                  const dc = Number(html.find("#ll-treat-dc").val()) || 15
                  const cat = getCategory(catId)

                  const isSeparate = game.settings.get(
                     MODULE_ID,
                     "separateAddictionImmunities",
                  )
                  const immunities =
                     patient.getFlag(MODULE_ID, "immunity") || {}
                  let immuneUntil = immunities[catId]?.[type]

                  if (!isSeparate) {
                     for (const c of categories) {
                        const t = immunities[c.id]?.[type]
                        if (
                           typeof t === "number" &&
                           (immuneUntil === undefined || t > immuneUntil)
                        ) {
                           immuneUntil = t
                        }
                     }
                  }

                  if (
                     typeof immuneUntil === "number" &&
                     immuneUntil > game.time.worldTime
                  ) {
                     const hoursLeft = Math.ceil(
                        (immuneUntil - game.time.worldTime) / 3600,
                     )
                     const catLabel = isSeparate ? cat.name : "ALL addictions"
                     ui.notifications?.warn(
                        `${patient.name} is immune to ${type} treatments for ${catLabel} for another ${hoursLeft} hour(s).`,
                     )
                     return
                  }

                  const treatOptions = buildRollOptions(cat, "treatment")
                  const result = await medic.skills.medicine.roll({
                     dc: { value: dc },
                     extraRollOptions: treatOptions,
                     flavor: `Treating <strong>${patient.name}</strong> for ${cat.name} (${type.toUpperCase()})`,
                  })
                  if (!result) return

                  const outcome = result.flags?.pf2e?.context?.outcome
                  let degree = DOS.FAILURE
                  if (outcome === "criticalSuccess")
                     degree = DOS.CRITICAL_SUCCESS
                  else if (outcome === "success") degree = DOS.SUCCESS
                  else if (outcome === "failure") degree = DOS.FAILURE
                  else if (outcome === "criticalFailure")
                     degree = DOS.CRITICAL_FAILURE
                  else {
                     const rollObj = Array.isArray(result)
                        ? result[0]
                        : (result.rolls?.[0] ?? result)
                     if (typeof rollObj?.degreeOfSuccess === "number") {
                        degree = [
                           DOS.CRITICAL_FAILURE,
                           DOS.FAILURE,
                           DOS.SUCCESS,
                           DOS.CRITICAL_SUCCESS,
                        ][rollObj.degreeOfSuccess]
                     }
                  }

                  if (
                     degree === DOS.FAILURE ||
                     degree === DOS.CRITICAL_FAILURE
                  ) {
                     ChatMessage.create({
                        content: `Treatment failed. <strong>${patient.name}</strong> receives no benefit.`,
                        speaker: ChatMessage.getSpeaker({ actor: medic }),
                     })
                  } else {
                     const isCrit = degree === DOS.CRITICAL_SUCCESS
                     const mult = isCrit ? 2 : 1

                     if (type === "addiction") {
                        const apToDrop =
                           (Number(html.find("#ll-ap-drop").val()) || 0) * mult
                        await addAP(patient, catId, -apToDrop)
                        ChatMessage.create({
                           content: `Reduced AP by ${apToDrop}.`,
                           speaker: ChatMessage.getSpeaker({ actor: medic }),
                        })
                     } else if (type === "withdrawal") {
                        const val =
                           Number(html.find("#ll-with-time").val()) || 0
                        const unit = html.find("#ll-with-unit").val()
                        const seconds = toSeconds({ value: val, unit }) * mult
                        await patchState(patient, catId, {
                           [STATE.SATIATION_END]: game.time.worldTime + seconds,
                           [STATE.WITHDRAWAL_STAGE]: 0,
                        })
                        await removePhaseEffects(
                           patient,
                           catId,
                           PHASE.WITHDRAWAL,
                        )
                        ChatMessage.create({
                           content: `Imitated satiation for ${val * mult} ${unit}.`,
                           speaker: ChatMessage.getSpeaker({ actor: medic }),
                        })
                     } else if (type === "hangover") {
                        const val =
                           Number(html.find("#ll-hang-time").val()) || 0
                        const unit = html.find("#ll-hang-unit").val()
                        const reduceSec = toSeconds({ value: val, unit }) * mult
                        const wrappers = patient.items.filter(
                           (i) =>
                              i.flags?.[MODULE_ID]?.phase === PHASE.HANGOVER &&
                              i.flags?.[MODULE_ID]?.category === catId,
                        )
                        const toDelete = []
                        for (const w of wrappers) {
                           const dur = w.system?.duration
                           const curSec = toSeconds({
                              value: Number(dur?.value) || 0,
                              unit: dur?.unit,
                           })
                           const newSec = Math.max(0, curSec - reduceSec)
                           const start = Number(w.system?.start?.value) || 0
                           if (
                              newSec === 0 ||
                              start + newSec <= game.time.worldTime
                           ) {
                              toDelete.push(w.id)
                           } else {
                              const ratio = curSec > 0 ? newSec / curSec : 0
                              await w.update({
                                 "system.duration.value":
                                    (Number(dur?.value) || 0) * ratio,
                              })
                           }
                        }
                        if (toDelete.length) {
                           await patient.deleteEmbeddedDocuments(
                              "Item",
                              toDelete,
                              { logansLoophole: true },
                           )
                        }
                        ChatMessage.create({
                           content: `Reduced hangover duration by ${val * mult} ${unit}.`,
                           speaker: ChatMessage.getSpeaker({ actor: medic }),
                        })
                     } else if (type === "intoxication") {
                        const method = html
                           .find("input[name='ll-intox-method']:checked")
                           .val()
                        if (method === "time") {
                           const val =
                              Number(html.find("#ll-intox-time").val()) || 0
                           const unit = html.find("#ll-intox-unit").val()
                           const seconds =
                              toSeconds({ value: val, unit }) * mult
                           const state = getState(patient, catId)
                           const currentTox = Number(state[STATE.TOXICITY]) || 0
                           const stageIdx =
                              Number(state[STATE.INTOX_STAGE]) ?? -1
                           const stageCfg =
                              cat.acute?.intoxStages?.[stageIdx] ||
                              cat.acute?.intoxStages?.[0]
                           const amt =
                              Number(stageCfg?.decay?.amount) ||
                              cat.acute?.decay?.amount ||
                              0
                           const perSec = Math.max(
                              60,
                              toSeconds(
                                 stageCfg?.decay?.per || cat.acute?.decay?.per,
                              ),
                           )

                           if (amt > 0) {
                              const ticks = Math.floor(seconds / perSec)
                              const dropped = ticks * amt
                              const targetTox = Math.max(
                                 0,
                                 currentTox - dropped,
                              )
                              await this.setToxicity(patient, catId, targetTox)
                              ChatMessage.create({
                                 content: `Accelerated toxicity decay by ${val * mult} ${unit} (dropped ${dropped} TV).`,
                                 speaker: ChatMessage.getSpeaker({
                                    actor: medic,
                                 }),
                              })
                           } else {
                              ChatMessage.create({
                                 content: `Toxicity decay acceleration had no effect (decay rate is 0).`,
                                 speaker: ChatMessage.getSpeaker({
                                    actor: medic,
                                 }),
                              })
                           }
                        } else {
                           const state = getState(patient, catId)
                           const currentTox = Number(state[STATE.TOXICITY]) || 0
                           const stages = cat.acute?.intoxStages ?? []
                           let targetTox = currentTox
                           let drops = mult
                           while (drops > 0) {
                              let prev = 0
                              for (let i = stages.length - 1; i >= 0; i--) {
                                 if (stages[i].tox < targetTox) {
                                    prev = stages[i].tox
                                    break
                                 }
                              }
                              targetTox = prev
                              drops--
                           }
                           await this.setToxicity(patient, catId, targetTox)
                           ChatMessage.create({
                              content: `Reduced toxicity to ${targetTox} (Dropped ${mult} stages).`,
                              speaker: ChatMessage.getSpeaker({ actor: medic }),
                           })
                        }
                     } else if (type === "overdose") {
                        await this.cureOverdose(patient, catId)
                        ChatMessage.create({
                           content: `Successfully cured Overdose.`,
                           speaker: ChatMessage.getSpeaker({ actor: medic }),
                        })
                     }
                  }

                  if (kitReq === "consumable" && kitItem) {
                     await kitItem.update({
                        "system.uses.value": Math.max(
                           0,
                           kitItem.system.uses.value - 1,
                        ),
                     })
                  }

                  const baseImmHours =
                     game.settings.get(MODULE_ID, "treatmentImmunityHours") || 0
                  const updateData = {}
                  const targetIds = isSeparate
                     ? [catId]
                     : categories.map((c) => c.id)

                  for (const asp of IMMUNITY_ASPECTS) {
                     const useSpecific = game.settings.get(
                        MODULE_ID,
                        `immunityToggle_${asp}`,
                     )
                     const specificHours =
                        game.settings.get(MODULE_ID, `immunityHours_${asp}`) ||
                        0

                     if (asp === type) {
                        const hours = useSpecific ? specificHours : baseImmHours
                        if (hours > 0) {
                           for (const tId of targetIds)
                              updateData[
                                 `flags.${MODULE_ID}.immunity.${tId}.${asp}`
                              ] = game.time.worldTime + hours * 3600
                        }
                     } else {
                        if (!useSpecific && baseImmHours > 0) {
                           for (const tId of targetIds)
                              updateData[
                                 `flags.${MODULE_ID}.immunity.${tId}.${asp}`
                              ] = game.time.worldTime + baseImmHours * 3600
                        }
                     }
                  }

                  if (Object.keys(updateData).length > 0) {
                     await patient.update(updateData)
                  }
               },
            },
         ],
      }).render(true)
   },
}
