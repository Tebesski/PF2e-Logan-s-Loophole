import { MODULE_ID, DOS, DOS_ORDER } from "../constants.mjs"

export async function rollSave(
   actor,
   saveType,
   dc,
   flavor,
   dosAdjustments = null,
   extraOptions = [],
) {
   const save = actor.saves?.[saveType]
   if (!save) {
      console.warn(
         `${MODULE_ID} | Actor "${actor?.name}" has no ${saveType} save.`,
      )
      return DOS.FAILURE
   }
   try {
      const rollOptions = { dc: { value: dc }, flavor }
      if (dosAdjustments && dosAdjustments.length > 0)
         rollOptions.dosAdjustments = dosAdjustments
      if (extraOptions && extraOptions.length > 0) {
         rollOptions.options = extraOptions
         rollOptions.extraRollOptions = extraOptions
      }
      const result = await save.roll(rollOptions)
      if (!result) return DOS.FAILURE
      const outcome = result.flags?.pf2e?.context?.outcome
      if (outcome && DOS_ORDER.includes(outcome)) return outcome
      const roll = Array.isArray(result)
         ? result[0]
         : (result.rolls?.[0] ?? result)
      if (typeof roll?.degreeOfSuccess === "number") {
         const mapped = [
            DOS.CRITICAL_FAILURE,
            DOS.FAILURE,
            DOS.SUCCESS,
            DOS.CRITICAL_SUCCESS,
         ][roll.degreeOfSuccess]
         if (mapped) return mapped
      }
      if (typeof roll?.total === "number") {
         const total = roll.total
         const natural = roll.dice?.[0]?.results?.[0]?.result
         let degree
         if (total >= dc + 10) degree = DOS.CRITICAL_SUCCESS
         else if (total >= dc) degree = DOS.SUCCESS
         else if (total <= dc - 10) degree = DOS.CRITICAL_FAILURE
         else degree = DOS.FAILURE
         if (natural === 20) degree = shiftDegree(degree, -1)
         else if (natural === 1) degree = shiftDegree(degree, 1)
         return degree
      }
      return DOS.FAILURE
   } catch (err) {
      console.error(`${MODULE_ID} | Save roll error:`, err)
      return DOS.FAILURE
   }
}

export function shiftDegree(degree, steps) {
   const idx = DOS_ORDER.indexOf(degree)
   if (idx < 0) return degree
   const next = Math.max(0, Math.min(DOS_ORDER.length - 1, idx + steps))
   return DOS_ORDER[next]
}
