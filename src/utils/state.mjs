import { MODULE_ID, FLAG, STATE, TIME_UNIT } from "../constants.mjs"

const FRESH_STATE = () => ({
   [STATE.TOXICITY]: 0,
   [STATE.TOLERANCE]: 0,
   [STATE.ADDICTION_POINTS]: 0,
   [STATE.ADDICTION_STAGE]: 0,
   [STATE.PEAK_STAGE]: 0,
   [STATE.WITHDRAWAL_STAGE]: 0,
   [STATE.INTOX_STAGE]: -1,
   [STATE.SATIATION_END]: 0,
   [STATE.SATIATION_KIND]: "",
   [STATE.AP_DECAY_PAUSE_END]: 0,
   [STATE.AP_DECAY_NEXT]: 0,
   [STATE.DECAY_NEXT]: 0,
   [STATE.HANGOVER_PENDING]: false,
   [STATE.CATEGORY_NAME]: "",
   [STATE.CATEGORY_IMG]: "",
})

export function getStateMap(actor) {
   return actor.getFlag(MODULE_ID, FLAG.STATE) ?? {}
}

export function getState(actor, categoryId) {
   const map = getStateMap(actor)
   return foundry.utils.mergeObject(FRESH_STATE(), map[categoryId] ?? {}, {
      inplace: false,
   })
}

export async function patchState(actor, categoryId, patch) {
   const current = getState(actor, categoryId)
   const merged = foundry.utils.mergeObject(current, patch, { inplace: false })
   await actor.setFlag(MODULE_ID, `${FLAG.STATE}.${categoryId}`, merged)
}

export async function clearState(actor, categoryId) {
   await actor.unsetFlag(MODULE_ID, `${FLAG.STATE}.${categoryId}`)
   try {
      await actor.unsetFlag(MODULE_ID, `immunity.${categoryId}`)
   } catch (e) {}
}

export function toSeconds(duration) {
   if (!duration) return 0
   const mult = TIME_UNIT[duration.unit] ?? 1
   return Math.max(0, Math.floor((Number(duration.value) || 0) * mult))
}

export function isFutureTimestamp(raw, now) {
   if (raw === 0 || raw === null || raw === undefined) return false
   const n = Number(raw)
   if (!Number.isFinite(n)) return false
   return now < n
}

const LEVEL_BASED_DC_TABLE = {
   "-1": 13, "0": 14, "1": 15, "2": 16, "3": 18, "4": 19, "5": 20,
   "6": 22, "7": 23, "8": 24, "9": 26, "10": 27, "11": 28, "12": 30,
   "13": 31, "14": 32, "15": 34, "16": 35, "17": 36, "18": 38, "19": 39,
   "20": 40, "21": 42, "22": 44, "23": 46, "24": 48, "25": 50,
}

export function levelBasedDC(level) {
   const lvl = Math.max(-1, Math.min(25, Math.floor(Number(level) || 0)))
   return LEVEL_BASED_DC_TABLE[String(lvl)] ?? 15
}

export function actorLevelBasedDC(actor) {
   const lvl =
      actor?.system?.details?.level?.value ??
      actor?.level ??
      actor?.system?.level?.value ??
      0
   return levelBasedDC(lvl)
}
