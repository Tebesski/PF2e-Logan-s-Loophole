import { MODULE_ID } from "../constants.mjs"

export async function applyDamage(
   actor,
   formula,
   damageType,
   flavor,
   extraOptions = [],
) {
   if (!formula || !String(formula).trim()) return 0
   const type = (damageType && String(damageType).trim()) || "untyped"

   try {
      const rollData = actor?.getRollData?.() ?? {}
      const DamageRoll = CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll")
      let total = 0
      let roll = null

      if (DamageRoll) {
         roll = new DamageRoll(`(${formula})[${type}]`, rollData, {
            options: extraOptions,
         })
         await roll.evaluate({ allowInteractive: false })
         total = roll.total
         await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor,
         })
      }

      return total
   } catch (err) {
      console.error(`${MODULE_ID} | applyDamage error:`, err)
      return 0
   }
}
