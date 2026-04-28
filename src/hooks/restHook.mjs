import { MODULE_ID, STATE, PHASE } from "../constants.mjs"
import { Settings } from "../settings.mjs"
import { getStateMap, getState, patchState } from "../utils/state.mjs"
import { refillTolerance, fireHangover } from "../effects/engine.mjs"
import { removePhaseEffects } from "../effects/factory.mjs"

export function registerRestHook() {
   const handler = async (actor) => {
      try {
         await _processRest(actor)
      } catch (err) {
         console.error(`${MODULE_ID} | Rest handler error:`, err)
      }
   }

   Hooks.on("pf2e.restForTheNight", handler)
   Hooks.on("pf2e.restCompleted", handler)
}

async function _processRest(actor) {
   if (!actor) return
   const map = getStateMap(actor)
   if (!map || !Object.keys(map).length) return

   for (const categoryId of Object.keys(map)) {
      const state = getState(actor, categoryId)

      if (Settings.longRestClearsToxicity) {
         await patchState(actor, categoryId, {
            [STATE.TOXICITY]: 0,
            [STATE.INTOX_STAGE]: -1,
            [STATE.DECAY_NEXT]: 0,
         })
         await removePhaseEffects(actor, categoryId, PHASE.INTOXICATION)
      }

      if (state[STATE.HANGOVER_PENDING]) {
         await fireHangover(actor, categoryId)
      }

      if (Settings.longRestRestoresTolerance) {
         await refillTolerance(actor, categoryId)
      }
   }
}
