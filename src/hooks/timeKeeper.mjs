import { MODULE_ID, PHASE, STATE, SATIATION_KIND } from "../constants.mjs"
import {
   getCategory,
   intoxStageForToxicity,
   addictionStageConfig,
} from "../registry/registry.mjs"
import {
   getStateMap,
   getState,
   patchState,
   toSeconds,
   isFutureTimestamp,
} from "../utils/state.mjs"
import { removePhaseEffects } from "../effects/factory.mjs"
import { fireHangover, syncIntoxWrapper } from "../effects/engine.mjs"
import { addAP, triggerWithdrawal } from "../effects/withdrawal.mjs"

export function registerTimeKeeper() {
   Hooks.on("updateWorldTime", async (worldTime, _dt, _options, _userId) => {
      if (!game.user.isGM) return
      try {
         await _runLifecycle(worldTime)
      } catch (err) {
         console.error(`${MODULE_ID} | TimeKeeper error:`, err)
      }
   })
}

async function _runLifecycle(now) {
   for (const actor of game.actors.contents) {
      const map = getStateMap(actor)
      if (!map || !Object.keys(map).length) continue
      for (const categoryId of Object.keys(map)) {
         await _processCategory(actor, categoryId, now)
      }
   }
}

async function _processCategory(actor, categoryId, now) {
   const category = getCategory(categoryId)
   if (!category) return
   const state = getState(actor, categoryId)
   await _tickToxicity(actor, categoryId, category, state, now)
   await _tickAddiction(actor, categoryId, category, state, now)
}

async function _tickToxicity(actor, categoryId, category, state, now) {
   const toxicity = Number(state[STATE.TOXICITY]) || 0
   const decayNext = Number(state[STATE.DECAY_NEXT]) || 0

   if (toxicity <= 0 || !decayNext) return

   const currentStageIdx = Number(state[STATE.INTOX_STAGE]) ?? -1
   const stages = category.acute?.intoxStages ?? []
   let stageCfg = stages[currentStageIdx]

   if (!stageCfg && stages.length > 0) {
      stageCfg = stages[0]
   }

   const decayAmt = Math.max(0, Number(stageCfg?.decay?.amount) || 0)
   const periodSec = Math.max(60, toSeconds(stageCfg?.decay?.per))

   if (decayAmt <= 0) return

   if (isFutureTimestamp(decayNext, now)) {
      if (decayNext - now > periodSec * 2) {
         await patchState(actor, categoryId, {
            [STATE.DECAY_NEXT]: now + periodSec,
         })
      }
      return
   }

   const elapsedTicks = Math.max(
      1,
      Math.floor((now - decayNext) / periodSec) + 1,
   )
   const totalDecay = decayAmt * elapsedTicks
   const newTox = Math.max(0, toxicity - totalDecay)
   const newStage = intoxStageForToxicity(category, newTox)

   let nextDecayTime = 0
   if (newTox > 0) {
      let nextStageCfg = stages[newStage]
      if (!nextStageCfg && stages.length > 0) nextStageCfg = stages[0]
      const nextPeriodSec = Math.max(60, toSeconds(nextStageCfg?.decay?.per))
      const actualLastTick = decayNext + (elapsedTicks - 1) * periodSec
      nextDecayTime = actualLastTick + nextPeriodSec
   }

   await patchState(actor, categoryId, {
      [STATE.TOXICITY]: newTox,
      [STATE.INTOX_STAGE]: newStage,
      [STATE.DECAY_NEXT]: nextDecayTime,
   })

   if (newStage !== currentStageIdx) {
      await syncIntoxWrapper(actor, categoryId, category, newStage)
   }

   if (newTox === 0) {
      const fresh = getState(actor, categoryId)
      if (fresh[STATE.HANGOVER_PENDING]) {
         await fireHangover(actor, categoryId)
      }
   }
}

async function _tickAddiction(actor, categoryId, category, state, now) {
   const stageNum = Number(state[STATE.ADDICTION_STAGE]) || 0
   const ap = Number(state[STATE.ADDICTION_POINTS]) || 0

   if (ap <= 0) return

   const rawSat = state[STATE.SATIATION_END]
   const satEnd = Number(rawSat) || 0
   const isSatiated = isFutureTimestamp(rawSat, now)
   const satKind = state[STATE.SATIATION_KIND]
   const isFakeSatiated = isSatiated && satKind === SATIATION_KIND.FAKE

   if (isSatiated && !isFakeSatiated) {
      const effectiveStage = Math.max(1, stageNum)
      const stgCfg = addictionStageConfig(category, effectiveStage)
      if (stgCfg) {
         const perSec = Math.max(60, toSeconds(stgCfg?.apDecayPer))
         await patchState(actor, categoryId, {
            [STATE.AP_DECAY_PAUSE_END]: now + perSec,
            [STATE.AP_DECAY_NEXT]: now + perSec,
         })
      }

      const withdrawalStage = Number(state[STATE.WITHDRAWAL_STAGE]) || 0
      if (withdrawalStage > 0) {
         await patchState(actor, categoryId, { [STATE.WITHDRAWAL_STAGE]: 0 })
         await removePhaseEffects(actor, categoryId, PHASE.WITHDRAWAL)
      }
      return
   }

   if (isFakeSatiated) {
      const withdrawalStage = Number(state[STATE.WITHDRAWAL_STAGE]) || 0
      if (withdrawalStage > 0) {
         await patchState(actor, categoryId, { [STATE.WITHDRAWAL_STAGE]: 0 })
         await removePhaseEffects(actor, categoryId, PHASE.WITHDRAWAL)
      }
   }

   const withdrawalStage = Number(state[STATE.WITHDRAWAL_STAGE]) || 0
   if (stageNum > 0 && withdrawalStage === 0 && !isFakeSatiated) {
      await triggerWithdrawal(actor, categoryId)
   }

   const rawPause = state[STATE.AP_DECAY_PAUSE_END]
   const pauseEnd = Number(rawPause) || 0
   const isPaused = isFutureTimestamp(rawPause, now)

   if (isPaused) {
      await patchState(actor, categoryId, {
         [STATE.AP_DECAY_NEXT]: pauseEnd,
      })
      return
   }

   let apDecayNext = Number(state[STATE.AP_DECAY_NEXT]) || 0

   if (ap > 0 && !apDecayNext) {
      const effectiveStage = Math.max(1, stageNum)
      const stgCfg = addictionStageConfig(category, effectiveStage)
      if (stgCfg) {
         const perSec = Math.max(60, toSeconds(stgCfg?.apDecayPer))
         apDecayNext = now + perSec
         await patchState(actor, categoryId, {
            [STATE.AP_DECAY_NEXT]: apDecayNext,
         })
      }
   }

   if (apDecayNext !== 0 && now >= apDecayNext) {
      const effectiveStage = Math.max(1, stageNum)
      const stgCfg = addictionStageConfig(category, effectiveStage)
      if (!stgCfg) return

      const periodSec = Math.max(60, toSeconds(stgCfg?.apDecayPer))
      if (apDecayNext - now > periodSec * 2) {
         await patchState(actor, categoryId, {
            [STATE.AP_DECAY_NEXT]: now + periodSec,
         })
         return
      }

      const amt = Number(stgCfg.apDecayAmount) || 0

      if (amt > 0) {
         const elapsedTicks = Math.max(
            1,
            Math.floor((now - apDecayNext) / periodSec) + 1,
         )
         const { newStage, oldStage } = await addAP(
            actor,
            categoryId,
            -(amt * elapsedTicks),
         )

         const stateAfter = getState(actor, categoryId)
         const newAp = Number(stateAfter[STATE.ADDICTION_POINTS]) || 0

         if (newAp > 0) {
            const actualLastTick = apDecayNext + (elapsedTicks - 1) * periodSec
            await patchState(actor, categoryId, {
               [STATE.AP_DECAY_NEXT]: actualLastTick + periodSec,
            })
            if (newStage > 0 && newStage !== oldStage) {
               await triggerWithdrawal(actor, categoryId)
            } else if (newStage === 0 && oldStage > 0) {
               await patchState(actor, categoryId, {
                  [STATE.WITHDRAWAL_STAGE]: 0,
               })
               await removePhaseEffects(actor, categoryId, PHASE.WITHDRAWAL)
            }
         } else {
            await patchState(actor, categoryId, {
               [STATE.AP_DECAY_NEXT]: 0,
               [STATE.WITHDRAWAL_STAGE]: 0,
            })
            await removePhaseEffects(actor, categoryId, PHASE.WITHDRAWAL)
         }
      }
   }
}
